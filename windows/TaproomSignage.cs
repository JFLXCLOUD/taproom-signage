// Windows launcher for the Taproom Signage server.
//
// Keeps a node.exe child alive in the background, puts a tray icon in the
// notification area, and can add itself to the per-user Run key so the server
// comes back after a reboot without anyone opening a terminal.
//
// Built with the .NET Framework compiler that ships with Windows, so there is
// nothing to install to compile it. That compiler is C# 5, which is why there is
// no string interpolation or null-conditional syntax below.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Taproom
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            foreach (string a in args)
            {
                if (a == "--install-startup") { Startup.Enable(); return; }
                if (a == "--uninstall-startup") { Startup.Disable(); return; }
            }

            // One instance only: two servers would fight over the port and the database.
            bool isNew;
            using (System.Threading.Mutex mutex = new System.Threading.Mutex(true, "TaproomSignageSingleton", out isNew))
            {
                if (!isNew)
                {
                    MessageBox.Show("Taproom Signage is already running. Look for the tray icon.",
                        "Taproom Signage", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new TrayApp());
            }
        }
    }

    /// <summary>Plain key=value file next to the exe, created on first run.</summary>
    class Config
    {
        public int Port = 8099;
        public string Password = "changeme";

        private readonly string path;

        public Config(string baseDir)
        {
            path = Path.Combine(baseDir, "taproom.config");
            if (File.Exists(path)) Load(); else Save();
        }

        public string Path_ { get { return path; } }
        public bool IsDefaultPassword { get { return Password == "changeme"; } }

        private void Load()
        {
            foreach (string raw in File.ReadAllLines(path))
            {
                string line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#")) continue;
                int eq = line.IndexOf('=');
                if (eq < 1) continue;
                string key = line.Substring(0, eq).Trim().ToLowerInvariant();
                string value = line.Substring(eq + 1).Trim();
                if (key == "port")
                {
                    int p;
                    if (int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out p) && p > 0)
                        Port = p;
                }
                else if (key == "password" && value.Length > 0)
                {
                    Password = value;
                }
            }
        }

        private void Save()
        {
            StringBuilder sb = new StringBuilder();
            sb.AppendLine("# Taproom Signage settings. Restart from the tray icon after editing.");
            sb.AppendLine("");
            sb.AppendLine("# Port the control app and displays are served on.");
            sb.AppendLine("port=" + Port.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("");
            sb.AppendLine("# CHANGE THIS before the screens go up anywhere public.");
            sb.AppendLine("password=" + Password);
            File.WriteAllText(path, sb.ToString());
        }
    }

    static class Startup
    {
        private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string ValueName = "TaproomSignage";

        public static bool IsEnabled()
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKey, false))
            {
                if (key == null) return false;
                object value = key.GetValue(ValueName);
                return value != null;
            }
        }

        public static void Enable()
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(RunKey))
            {
                key.SetValue(ValueName, "\"" + Application.ExecutablePath + "\"");
            }
        }

        public static void Disable()
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKey, true))
            {
                if (key != null && key.GetValue(ValueName) != null) key.DeleteValue(ValueName);
            }
        }
    }

    class TrayApp : ApplicationContext
    {
        private readonly NotifyIcon tray;
        private readonly string baseDir;
        private readonly string logPath;
        private readonly Config config;

        private Process server;
        private bool stopping;
        private int restarts;
        private readonly Timer restartTimer;

        // Process.Exited fires on a thread-pool thread, and a WinForms Timer only
        // works on the thread with the message pump. Handing Process this control
        // as its SynchronizingObject marshals its events onto the UI thread, so
        // the restart timer actually runs.
        private readonly Control ui;

        private ToolStripMenuItem statusItem;
        private ToolStripMenuItem startupItem;

        // The port the server actually bound. It can differ from the requested
        // one: Windows reserves port ranges, so the server steps to the next
        // free port and writes the result to data\port.
        private int actualPort;
        private readonly Timer portWatch;

        public TrayApp()
        {
            ui = new Control();
            IntPtr forceHandleCreation = ui.Handle;
            GC.KeepAlive(forceHandleCreation);

            baseDir = AppDomain.CurrentDomain.BaseDirectory;
            Directory.CreateDirectory(Path.Combine(baseDir, "logs"));
            logPath = Path.Combine(baseDir, "logs", "server.log");
            config = new Config(baseDir);

            restartTimer = new Timer();
            restartTimer.Interval = 3000;
            restartTimer.Tick += RestartTick;

            portWatch = new Timer();
            portWatch.Interval = 500;
            portWatch.Tick += PortWatchTick;

            tray = new NotifyIcon();
            tray.Icon = LoadIcon();
            tray.Visible = true;
            tray.Text = "Taproom Signage";
            tray.ContextMenuStrip = BuildMenu();
            tray.DoubleClick += delegate { OpenUrl("/"); };

            StartServer();

            if (config.IsDefaultPassword)
            {
                tray.ShowBalloonTip(9000, "Taproom Signage",
                    "Running on port " + config.Port + ". The password is still 'changeme' - " +
                    "open Settings from the tray icon to change it.", ToolTipIcon.Warning);
            }
        }

        private Icon LoadIcon()
        {
            try { return Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
            catch { return SystemIcons.Application; }
        }

        // ------------------------------------------------------------ menu

        private ContextMenuStrip BuildMenu()
        {
            ContextMenuStrip menu = new ContextMenuStrip();

            statusItem = new ToolStripMenuItem("Starting...");
            statusItem.Enabled = false;
            menu.Items.Add(statusItem);
            menu.Items.Add(new ToolStripSeparator());

            menu.Items.Add(Item("Open control app", delegate { OpenUrl("/"); }));
            menu.Items.Add(Item("Open display", delegate { OpenUrl("/display"); }));
            menu.Items.Add(new ToolStripSeparator());

            startupItem = new ToolStripMenuItem("Start with Windows");
            startupItem.CheckOnClick = true;
            startupItem.Checked = Startup.IsEnabled();
            startupItem.Click += delegate
            {
                if (startupItem.Checked) Startup.Enable(); else Startup.Disable();
            };
            menu.Items.Add(startupItem);

            menu.Items.Add(Item("Settings", delegate { Open(config.Path_); }));
            menu.Items.Add(Item("Data folder", delegate { Open(Path.Combine(baseDir, "data")); }));
            menu.Items.Add(Item("Log", delegate { Open(logPath); }));
            menu.Items.Add(new ToolStripSeparator());

            menu.Items.Add(Item("Restart server", delegate { Restart(); }));
            menu.Items.Add(Item("Quit", delegate { Quit(); }));
            return menu;
        }

        private static ToolStripMenuItem Item(string text, EventHandler onClick)
        {
            ToolStripMenuItem item = new ToolStripMenuItem(text);
            item.Click += onClick;
            return item;
        }

        // ---------------------------------------------------------- server

        private void StartServer()
        {
            string node = Path.Combine(baseDir, "node.exe");
            if (!File.Exists(node)) node = "node";     // fall back to a system install

            string entry = Path.Combine(baseDir, Path.Combine("app", Path.Combine("src", "server.js")));
            if (!File.Exists(entry))
            {
                SetStatus("app\\src\\server.js is missing");
                MessageBox.Show("Cannot find app\\src\\server.js next to the executable.\n\n" +
                    "Unzip the whole folder and run it from there.",
                    "Taproom Signage", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            ProcessStartInfo psi = new ProcessStartInfo(node, "\"" + entry + "\"");
            psi.WorkingDirectory = baseDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            // node writes UTF-8; without this the log fills with mojibake.
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            psi.EnvironmentVariables["PORT"] = config.Port.ToString(CultureInfo.InvariantCulture);
            psi.EnvironmentVariables["ADMIN_PASSWORD"] = config.Password;
            psi.EnvironmentVariables["DATA_DIR"] = Path.Combine(baseDir, "data");

            RollLog();

            server = new Process();
            server.StartInfo = psi;
            server.EnableRaisingEvents = true;
            server.SynchronizingObject = ui;
            server.OutputDataReceived += LogLine;
            server.ErrorDataReceived += LogLine;
            server.Exited += ServerExited;

            try
            {
                stopping = false;
                actualPort = 0;
                try { File.Delete(PortFile()); } catch { }
                server.Start();
                server.BeginOutputReadLine();
                server.BeginErrorReadLine();
                SetStatus("Starting...");
                portWatch.Start();
            }
            catch (Exception ex)
            {
                SetStatus("Could not start");
                Log("launcher: " + ex.Message);
                MessageBox.Show("Could not start the server:\n\n" + ex.Message,
                    "Taproom Signage", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private string PortFile()
        {
            return Path.Combine(Path.Combine(baseDir, "data"), "port");
        }

        /// <summary>Waits for the server to report the port it managed to bind.</summary>
        private void PortWatchTick(object sender, EventArgs e)
        {
            try
            {
                if (!File.Exists(PortFile())) return;
                int p;
                if (!int.TryParse(File.ReadAllText(PortFile()).Trim(),
                        NumberStyles.Integer, CultureInfo.InvariantCulture, out p) || p <= 0) return;

                portWatch.Stop();
                actualPort = p;
                SetStatus("Running on port " + p);
                if (p != config.Port)
                {
                    Log("launcher: port " + config.Port + " was unavailable; using " + p);
                    tray.ShowBalloonTip(7000, "Taproom Signage",
                        "Port " + config.Port + " was not available, so the server is on port " +
                        p + " instead. Screens find it automatically.", ToolTipIcon.Info);
                }
            }
            catch { /* try again on the next tick */ }
        }

        private void ServerExited(object sender, EventArgs e)
        {
            portWatch.Stop();
            if (stopping) return;
            // A crash here is usually the port being taken. Keep trying, but back
            // off so a permanent problem does not spin the CPU all night.
            restarts++;
            Log("launcher: server exited unexpectedly (restart " + restarts + ")");
            restartTimer.Interval = Math.Min(60000, 3000 * restarts);
            SetStatus("Restarting in " + (restartTimer.Interval / 1000) + "s");
            restartTimer.Start();
        }

        private void RestartTick(object sender, EventArgs e)
        {
            restartTimer.Stop();
            StartServer();
        }

        private void Restart()
        {
            StopServer();
            restarts = 0;
            StartServer();
        }

        private void StopServer()
        {
            stopping = true;
            restartTimer.Stop();
            portWatch.Stop();
            if (server == null) return;
            try { if (!server.HasExited) server.Kill(); }
            catch (Exception ex) { Log("launcher: could not stop server - " + ex.Message); }
            server = null;
        }

        private void Quit()
        {
            StopServer();
            tray.Visible = false;
            ExitThread();
        }

        // ------------------------------------------------------------- bits

        private void SetStatus(string text)
        {
            if (statusItem != null) statusItem.Text = text;
            tray.Text = ("Taproom Signage - " + text).Substring(0,
                Math.Min(63, ("Taproom Signage - " + text).Length));   // tooltip caps at 63
        }

        private void LogLine(object sender, DataReceivedEventArgs e)
        {
            if (e.Data != null) Log(e.Data);
        }

        private void Log(string line)
        {
            try
            {
                File.AppendAllText(logPath,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) +
                    "  " + line + Environment.NewLine);
            }
            catch { /* logging must never take the server down */ }
        }

        private void RollLog()
        {
            try
            {
                FileInfo info = new FileInfo(logPath);
                if (info.Exists && info.Length > 5 * 1024 * 1024)
                {
                    string old = logPath + ".1";
                    if (File.Exists(old)) File.Delete(old);
                    File.Move(logPath, old);
                }
            }
            catch { }
        }

        private void OpenUrl(string path)
        {
            int port = actualPort > 0 ? actualPort : config.Port;
            Open("http://localhost:" + port.ToString(CultureInfo.InvariantCulture) + path);
        }

        private void Open(string target)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(target);
                psi.UseShellExecute = true;
                Process.Start(psi);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Could not open " + target + "\n\n" + ex.Message,
                    "Taproom Signage", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && tray != null) tray.Dispose();
            base.Dispose(disposing);
        }
    }
}
