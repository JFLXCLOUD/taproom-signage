// Build the portable Windows package.
//
//   node scripts/build-windows.mjs
//   -> dist/TaproomSignage/          runnable folder
//   -> dist/TaproomSignage-win-x64.zip
//
// Compiles the tray launcher with the .NET Framework compiler that ships with
// Windows, so there is no toolchain to install, and copies the running node.exe
// in beside it. The result needs nothing preinstalled on the target machine.

import { execFileSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, lstatSync, realpathSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const INSTALL = path.join(DIST, 'TaproomSignage');
const releaseOnly = process.argv.includes('--release-only');
const buildSetup = process.argv.includes('--setup');

const CSC = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';

const step = (msg) => console.log('  ' + msg);

if (process.platform !== 'win32') {
  console.error('This packager only runs on Windows (it needs csc.exe and node.exe).');
  process.exit(1);
}
if (!existsSync(CSC)) {
  console.error('Cannot find the C# compiler at ' + CSC);
  process.exit(1);
}

// Build separately: a failed compile must never delete the working installation,
// and the downloadable ZIP must never include a user's database or password.
mkdirSync(DIST, { recursive: true });
if (realpathSync(DIST).toLowerCase() !== DIST.toLowerCase()) {
  throw new Error('Refusing to build through a redirected dist folder.');
}
const staging = mkdtempSync(path.join(DIST, '.windows-build-'));
const OUT = path.join(staging, 'TaproomSignage');
try {
mkdirSync(path.join(OUT, 'app'), { recursive: true });
step('building in ' + path.relative(ROOT, OUT));

// ----------------------------------------------------------------- icon

// Wrap the existing PWA icon as a Windows .ico. Vista and later accept a PNG
// payload inside an ICO container, so no image library is needed.
const png = readFileSync(path.join(ROOT, 'public/icons/icon-192.png'));
const ico = Buffer.alloc(22 + png.length);
ico.writeUInt16LE(0, 0);            // reserved
ico.writeUInt16LE(1, 2);            // type: icon
ico.writeUInt16LE(1, 4);            // one image
ico.writeUInt8(0, 6);               // width 0 means 256; 192 fits in a byte but
ico.writeUInt8(0, 7);               // 0/0 is the safe "read it from the PNG" form
ico.writeUInt8(0, 8);               // palette
ico.writeUInt8(0, 9);               // reserved
ico.writeUInt16LE(1, 10);           // colour planes
ico.writeUInt16LE(32, 12);          // bits per pixel
ico.writeUInt32LE(png.length, 14);  // payload size
ico.writeUInt32LE(22, 18);          // payload offset
png.copy(ico, 22);
const icoPath = path.join(DIST, 'taproom.ico');
writeFileSync(icoPath, ico);
step('icon: ' + png.length + ' byte png wrapped as .ico');

// -------------------------------------------------------------- compile

const exePath = path.join(OUT, 'TaproomSignage.exe');
execFileSync(CSC, [
  '/nologo',
  '/target:winexe',
  '/optimize+',
  '/platform:anycpu',
  '/out:' + exePath,
  '/win32icon:' + icoPath,
  '/reference:System.dll',
  '/reference:System.Drawing.dll',
  '/reference:System.Windows.Forms.dll',
  path.join(ROOT, 'windows/TaproomSignage.cs')
], { stdio: 'inherit' });
step('compiled TaproomSignage.exe (' + statSync(exePath).size + ' bytes)');
execFileSync(CSC, ['/nologo', '/target:winexe', '/optimize+', '/platform:x64',
  '/main:Taproom.ServiceProgram', '/out:' + path.join(OUT, 'TaproomServer.exe'),
  '/win32icon:' + icoPath, '/reference:System.dll', '/reference:System.Drawing.dll',
  '/reference:System.Windows.Forms.dll', '/reference:System.ServiceProcess.dll',
  path.join(ROOT, 'windows/TaproomSignage.cs'), path.join(ROOT, 'windows/TaproomServer.cs')
], { stdio: 'inherit' });
cpSync(path.join(ROOT, 'windows/Setup-Server.ps1'), path.join(OUT, 'Setup-Server.ps1'));
cpSync(path.join(ROOT, 'docs/windows-install.md'), path.join(OUT, 'Windows install guide.md'));
// Node's redistribution license includes its bundled third-party notices.
cpSync(path.join(ROOT, 'windows/node-LICENSE.txt'), path.join(OUT, 'node-LICENSE.txt'));

// ----------------------------------------------------------------- copy

cpSync(path.join(ROOT, 'src'), path.join(OUT, 'app/src'), { recursive: true });
cpSync(path.join(ROOT, 'public'), path.join(OUT, 'app/public'), { recursive: true });
cpSync(path.join(ROOT, 'package.json'), path.join(OUT, 'app/package.json'));
step('copied app sources');

// The node that is running this script — guaranteed to match what we tested.
cpSync(process.execPath, path.join(OUT, 'node.exe'));
step('bundled node ' + process.version + ' (' +
  Math.round(statSync(process.execPath).size / 1048576) + ' MB)');

writeFileSync(path.join(OUT, 'READ ME FIRST.txt'), `Taproom Signage
===============

1. Double-click TaproomSignage.exe.
   A tray icon appears near the clock. The server is now running.

2. Right-click the tray icon -> Open control app.
   Sign in with the password from taproom.config (it starts as "changeme").

3. Keep this whole folder in a permanent location. Right-click the tray icon
   -> tick "Start when I sign in to Windows".
   The server returns after a reboot once you sign in to this Windows account.
   If you move the folder, run the EXE there and tick the option again.
   Windows Settings -> Apps -> Startup must also allow TaproomSignage.

CHANGE THE PASSWORD before any screen goes up somewhere public: right-click
the tray icon -> Settings, edit password=, save, then Restart server.

Your menus, images and settings live in the data folder. Back that folder up,
or use the venue button -> App tools & backups -> Download backup in the control app.
An optional data_dir= line in taproom.config can point to an existing data folder.

Nothing needs to be installed. To move it to another machine, copy this whole
folder, including the data folder if you want to keep your menus.

For automatic startup before sign-in and Windows firewall setup, use the Setup EXE.
On another Wi-Fi/VLAN, press MENU on the Fire TV remote and enter the server URL.
The router must allow TCP access between networks. See Windows install guide.md.
`.replace(/\n/g, '\r\n'));
step('wrote READ ME FIRST.txt');

// ------------------------------------------------------------------ zip

const zipPath = path.join(DIST, 'TaproomSignage-win-x64.zip');
rmSync(zipPath, { force: true });
execFileSync('powershell', [
  '-NoProfile', '-Command',
  `Compress-Archive -LiteralPath '${OUT.replaceAll("'", "''")}' -DestinationPath '${zipPath.replaceAll("'", "''")}' -CompressionLevel Optimal`
], { stdio: 'inherit' });
step('zipped -> ' + path.relative(ROOT, zipPath) +
  ' (' + Math.round(statSync(zipPath).size / 1048576) + ' MB)');

// Copy only shipped files. Preserve data/, logs/, and taproom.config in an
// existing installation. Copy the EXE first so a running/locked launcher fails
// before any of its app files are changed.
function rejectLinks(target) {
  let current = target;
  while (current !== DIST) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error('Refusing to update a redirected path: ' + current);
    }
    current = path.dirname(current);
  }
}
if (!releaseOnly) {
rejectLinks(INSTALL);
mkdirSync(INSTALL, { recursive: true });
for (const name of ['TaproomSignage.exe', 'TaproomServer.exe', 'Setup-Server.ps1', 'Windows install guide.md', 'node-LICENSE.txt', 'node.exe', 'app', 'READ ME FIRST.txt']) {
  cpSync(path.join(OUT, name), path.join(INSTALL, name), {
    recursive: true,
    filter: (source, destination) => { rejectLinks(destination); return true; }
  });
}
step('updated runnable folder; existing data and settings preserved');
console.log('\nDone. Run dist/TaproomSignage/TaproomSignage.exe');
}
if (buildSetup) {
  const iscc = process.env.ISCC || 'C:/Program Files (x86)/Inno Setup 6/ISCC.exe';
  execFileSync(iscc, ['/DPackageDir=' + OUT, '/DAppVersion=' + JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
    path.join(ROOT, 'windows/TaproomSignage.iss')], { stdio: 'inherit' });
  step('built the Windows Setup EXE');
}
} finally {
  // Only remove the freshly created staging directory inside the real dist.
  const resolved = realpathSync(staging);
  if (path.dirname(resolved).toLowerCase() !== DIST.toLowerCase() ||
      !path.basename(resolved).startsWith('.windows-build-')) {
    throw new Error('Refusing to remove an unexpected staging directory: ' + resolved);
  }
  rmSync(resolved, { recursive: true, force: true });
}
