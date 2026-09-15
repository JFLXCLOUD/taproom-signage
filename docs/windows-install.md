# Install the Windows server

Quit any running portable Taproom tray app before installation, and disable its
sign-in startup toggle. Download **TaproomSignage-Setup-win-x64.exe** from the GitHub release. Run it as a
Windows administrator, keep the default install folder, choose a password, and
leave the port at **8099** unless Setup reports it is unavailable. Setup checks
that the server responds before completing. Node is included; no separate
runtime, terminal, Windows account password, or internet connection is needed
on the destination PC.

The target is **64-bit Windows 11, Windows 10 editions still receiving Microsoft
support, and Windows Server 2016 or newer with Desktop Experience**. Windows 7/8,
32-bit Windows, ARM-native packages, S mode, and Server Core are not supported by
this installer. This follows the bundled [Node 24 platform requirements](https://github.com/nodejs/node/blob/v24.16.0/BUILDING.md#platform-list).
Domain policy and third-party security software can override local installation
or firewall permissions; those environments need their administrator's help.

## Connect your phone and TVs

1. Open the **Taproom Signage** desktop or Start menu shortcut on the server PC.
   It shows the service status, hostname, and addresses for connected adapters.
2. On your phone, open the address for the adapter connected to the venue network,
   for example `http://192.168.10.20:8099/`. Sign in using your Setup password.
3. Open the Fire TV app. If discovery does not find the server, press **MENU >
   Enter address** and enter that same address, including the port. The address
   stays saved through temporary outages. **Search again** clears the manual choice.
4. Enter the TV's pairing code under **TVs** in the control app, then choose its
   content and orientation.
5. Reserve the server's IPv4 address in the router's DHCP settings. A hostname
   works only when the TV's network can resolve it through DNS.

For a TV browser, use `http://SERVER-IP:PORT/display`. Automatic UDP discovery
normally reaches only the local subnet. Different Wi-Fi names can be on the same
subnet, or on isolated networks; the Wi-Fi name alone does not determine access.

### Separate Wi-Fi networks or VLANs at the same venue

Give your network administrator these requirements:

| Purpose | Required route / rule |
| --- | --- |
| TV playback and phone controls | TV and phone subnets can reach the server IPv4 address on TCP **8099** (or your chosen port), with return traffic allowed |
| Automatic discovery on the same subnet | UDP **41234** to the server; replies return to the client's source port |
| Manual address across VLANs | Same TCP rule; UDP broadcast forwarding is unnecessary |
| Stable address | DHCP reservation, or a stable DNS name resolvable from all client networks |

Setup binds the server to all IPv4 adapters. Its Windows Firewall rules are
restricted to the bundled Node program and the two required ports, enabled on
**Domain, Private, and Public** profiles. Allowed client ranges are LocalSubnet,
10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, and 100.64.0.0/10 (routed VPN addresses).
No PC-specific IP address is baked into the installer. Setup does not disable
the firewall, change router settings, or expose the app through internet port
forwarding. Guest Wi-Fi isolation, blocked inter-VLAN routes, and centrally
enforced firewall rules must be adjusted by your network administrator.

An administrator can narrow or extend the trusted client ranges after Setup:

```powershell
# Replace these example ranges with the venue's TV and phone subnets.
& 'C:\Program Files\Taproom Signage\Setup-Server.ps1' -RemoteAddress '192.168.10.0/24','192.168.20.0/24'
```

This restarts the service and replaces only Taproom's two named rules. Running
Setup again restores its default ranges, so reapply custom ranges after an update.
Windows policy can block local allow rules; see [Microsoft's firewall guidance](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/configure-with-command-line).

Test from a Windows PC on the **TV's subnet**, not just the server itself:

```powershell
Test-NetConnection 192.168.10.20 -Port 8099
Invoke-RestMethod http://192.168.10.20:8099/api/health
```

The first should report `TcpTestSucceeded: True`; the second should report
`app: taproom-signage`. A successful localhost check proves only the server is
running. It does not prove that the router allows the TV's network to reach it.

Separate physical sites require a routed VPN or another managed secure network.
The app serves HTTP and should remain on trusted networks; do not forward its
port to the public internet.

## Reboots, settings, upgrades, and backups

- The **Taproom Signage Server** Windows service uses the restricted LocalService
  account and automatic delayed startup. It starts without anybody signing in,
  retries a crashed Node process, and Windows restarts a failed service host.
- Closing the connection window does not stop playback. Keep the PC powered on,
  awake, and connected; the installer does not change your sleep policy.
- Installed servers keep a fixed port. If the port becomes unavailable, they log
  the error and retry; they do not silently change the address saved on your TVs.
- Run Setup again to change the port/password or upgrade. A blank password on
  an existing installation keeps it. Data is retained through upgrades and uninstall.
- App files live in `C:\Program Files\Taproom Signage`. Mutable files are under
  `C:\ProgramData\TaproomSignage`: `data` (SQLite + uploads), `logs`, and protected
  `settings\taproom.config`. The data and password are not shipped in downloads.
- Back up `data` with the service stopped, or use a SQLite-aware backup plus the
  uploads folder. In-app JSON backups do not include uploaded image files.
- To migrate a portable copy, quit its tray app, disable its sign-in startup,
  stop the installed service in Services, back up both data folders, and copy the
  portable **entire data folder** into ProgramData's `data` folder. Restart the
  service. Keep the old copy until you verify menus, images, and TV assignments.
  Setup does not automatically import another folder or delete portable copies.

## Portable download

`TaproomSignage-win-x64.zip` remains available for trials. Extract the whole folder
somewhere your account can write and run `TaproomSignage.exe`. Its optional tray
startup starts **at sign-in**, and it requires manual firewall setup. Use the
Setup EXE for an unattended venue server. Do not run both copies on the same data.

## Building and verification

Build on x64 Windows with Node 24.16.0 and Inno Setup 6:

```powershell
$env:ISCC = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
node scripts/build-windows.mjs --setup --release-only
```

`--release-only` leaves a running portable copy untouched. The release workflow
tests fresh installation, service recovery, upgrade, and uninstall on its Windows
runner. Browser tests cover menu/poster workflows, expiry, orientation, and all
three transitions. Those tests do not replace a reboot and TV connectivity check
at the destination venue, or visual playback testing on physical Fire TV hardware.
