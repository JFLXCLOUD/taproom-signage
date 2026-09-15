// Installed Windows service and a small connection window. C# 5 / .NET Framework.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace Taproom
{
    static class ServiceProgram
    {
        public static readonly string Home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "TaproomSignage");
        [STAThread]
        static void Main(string[] args)
        {
            if (Array.IndexOf(args, "--service") >= 0) { ServiceBase.Run(new MenuService(Home)); return; }
            // Used by the package verification harness without registering a system service.
            if (args.Length == 2 && args[0] == "--console") {
                using (MenuService service = new MenuService(Path.GetFullPath(args[1]))) {
                    service.StartHost();
                    Console.ReadLine();
                    service.StopHost();
                }
                return;
            }
            Application.EnableVisualStyles();
            Form form = new Form { Text = "Taproom Signage - Connect your TVs", Size = new Size(710, 480), MinimumSize = new Size(570, 420), StartPosition = FormStartPosition.CenterScreen };
            TextBox info = new TextBox { Multiline = true, ReadOnly = true, Dock = DockStyle.Fill, ScrollBars = ScrollBars.Vertical, Font = new Font("Segoe UI", 11), BackColor = Color.White };
            FlowLayoutPanel buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 48, Padding = new Padding(8) };
            Func<int> port = delegate { int p; return File.Exists(Path.Combine(Home, "port")) && int.TryParse(File.ReadAllText(Path.Combine(Home, "port")).Trim(), out p) ? p : 8099; };
            Action refresh = delegate {
                StringBuilder text = new StringBuilder();
                try { using (ServiceController service = new ServiceController("TaproomSignage")) text.AppendLine("Server: " + service.Status); }
                catch { text.AppendLine("Server service is not installed. Run the Setup download first."); }
                text.AppendLine("\r\nOpen one of these addresses on a phone or TV:");
                text.AppendLine("http://" + Environment.MachineName + ":" + port() + "/  (if your network resolves this PC name)");
                foreach (NetworkInterface adapter in NetworkInterface.GetAllNetworkInterfaces()) {
                    if (adapter.OperationalStatus != OperationalStatus.Up || adapter.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                    foreach (UnicastIPAddressInformation address in adapter.GetIPProperties().UnicastAddresses)
                        if (address.Address.AddressFamily == AddressFamily.InterNetwork && !address.Address.ToString().StartsWith("169.254."))
                            text.AppendLine("http://" + address.Address + ":" + port() + "/  - " + adapter.Name);
                }
                text.AppendLine("\r\nFire TV: press MENU > Enter address. Choose the adapter reachable from the TV's network. Reserve that IP in your router so it stays the same.");
                text.AppendLine("\r\nSeparate Wi-Fi / VLAN: your router must allow the TV to reach this PC on TCP " + port() + ". Automatic discovery uses UDP 41234 on the same subnet. Separate sites need a routed VPN.");
                text.AppendLine("\r\nThe service runs before sign-in. Keep this PC awake and connected. To change the password or port, run Setup again. Logs and data: " + Home);
                info.Text = text.ToString();
            };
            Button open = new Button { Text = "Open control app", AutoSize = true };
            open.Click += delegate { Process.Start(new ProcessStartInfo("http://localhost:" + port() + "/") { UseShellExecute = true }); };
            Button copy = new Button { Text = "Copy connection details", AutoSize = true };
            copy.Click += delegate { Clipboard.SetText(info.Text); };
            Button update = new Button { Text = "Refresh", AutoSize = true };
            update.Click += delegate { refresh(); };
            buttons.Controls.AddRange(new Control[] { open, copy, update });
            form.Controls.Add(info); form.Controls.Add(buttons); refresh();
            Application.Run(form);
        }
    }

    class MenuService : ServiceBase
    {
        readonly string home;
        readonly object gate = new object();
        Process child;
        System.Threading.Timer timer;
        IntPtr job;
        bool stopping;
        public MenuService(string home) { this.home = home; ServiceName = "TaproomSignage"; CanShutdown = true; AutoLog = true; }
        protected override void OnStart(string[] args) { StartHost(); }
        protected override void OnStop() { StopHost(); }
        protected override void OnShutdown() { StopHost(); }
        public void StartHost() {
            Directory.CreateDirectory(Path.Combine(home, "logs"));
            if (!File.Exists(Path.Combine(home, "settings", "taproom.config"))) throw new IOException("Run Setup to create the server settings.");
            job = ChildJob.Create();
            stopping = false;
            timer = new System.Threading.Timer(delegate { lock (gate) { if (!stopping) Supervise(); } }, null, 0, 5000);
        }
        void Supervise() {
            try {
                if (child != null && !child.HasExited) return;
                if (child != null) { Log("Node exited with code " + child.ExitCode + "; restarting."); child.Dispose(); child = null; }
                Config config = new Config(Path.Combine(home, "settings"));
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                ProcessStartInfo start = new ProcessStartInfo(Path.Combine(baseDir, "node.exe"), "\"" + Path.Combine(baseDir, "app", "src", "server.js") + "\"") {
                    WorkingDirectory = baseDir, UseShellExecute = false, CreateNoWindow = true,
                    RedirectStandardOutput = true, RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
                };
                start.EnvironmentVariables["PORT"] = config.Port.ToString();
                start.EnvironmentVariables["HOST"] = "0.0.0.0";
                start.EnvironmentVariables["PORT_FALLBACK"] = "0";
                start.EnvironmentVariables["ADMIN_PASSWORD"] = config.Password;
                start.EnvironmentVariables["DATA_DIR"] = config.DataDir;
                start.EnvironmentVariables["DISCOVERY"] = "1";
                start.EnvironmentVariables["DISCOVERY_PORT"] = "41234";
                start.EnvironmentVariables["CAPTIVE_PORTAL"] = "0";
                start.EnvironmentVariables["SEED_DEMO"] = "0";
                File.WriteAllText(Path.Combine(home, "port"), config.Port.ToString());
                child = new Process { StartInfo = start };
                child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) Log(e.Data); };
                child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) Log(e.Data); };
                child.Start();
                if (!ChildJob.AssignProcessToJobObject(job, child.Handle)) {
                    child.Kill(); throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "Cannot supervise server process");
                }
                child.BeginOutputReadLine(); child.BeginErrorReadLine();
                Log("Started server on configured port " + config.Port);
            } catch (Exception ex) { Log("Start failed; retrying in 5 seconds: " + ex.Message); }
        }
        public void StopHost() {
            lock (gate) {
                stopping = true;
                if (timer != null) { timer.Dispose(); timer = null; }
                if (job != IntPtr.Zero) { ChildJob.CloseHandle(job); job = IntPtr.Zero; }
                if (child != null) { try { child.WaitForExit(5000); } catch { } child.Dispose(); child = null; }
            }
        }
        readonly object logGate = new object();
        void Log(string message) {
            lock (logGate) { try {
                string log = Path.Combine(home, "logs", "server.log");
                if (File.Exists(log) && new FileInfo(log).Length > 5 * 1024 * 1024) {
                    if (File.Exists(log + ".1")) File.Delete(log + ".1");
                    File.Move(log, log + ".1");
                }
                File.AppendAllText(log, DateTime.Now.ToString("s") + " " + message + Environment.NewLine);
            } catch { } }
        }
    }

    // Kill the Node child even if the service host itself crashes. Prevents orphaned
    // listeners/database writers from fighting the recovery instance after reboot.
    static class ChildJob {
        [StructLayout(LayoutKind.Sequential)] struct Basic { public long PerProcess, PerJob; public uint Flags; public UIntPtr Min, Max; public uint Active; public UIntPtr Affinity; public uint Priority, Scheduling; }
        [StructLayout(LayoutKind.Sequential)] struct Io { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
        [StructLayout(LayoutKind.Sequential)] struct Extended { public Basic Basic; public Io Io; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob; }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int type, IntPtr data, uint length);
        [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
        public static IntPtr Create() {
            IntPtr handle = CreateJobObject(IntPtr.Zero, null);
            if (handle == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
            Extended limits = new Extended(); limits.Basic.Flags = 0x2000;
            IntPtr memory = Marshal.AllocHGlobal(Marshal.SizeOf(limits));
            try {
                Marshal.StructureToPtr(limits, memory, false);
                if (!SetInformationJobObject(handle, 9, memory, (uint)Marshal.SizeOf(limits))) { CloseHandle(handle); throw new System.ComponentModel.Win32Exception(); }
                return handle;
            } finally { Marshal.FreeHGlobal(memory); }
        }
    }
}
