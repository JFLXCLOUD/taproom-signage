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
  cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'TaproomSignage');

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

// ---------------------------------------------------------------- clean

rmSync(OUT, { recursive: true, force: true });
mkdirSync(path.join(OUT, 'app'), { recursive: true });
step('cleaned ' + path.relative(ROOT, OUT));

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

3. Right-click the tray icon -> tick "Start with Windows" so it comes back
   after a reboot.

CHANGE THE PASSWORD before any screen goes up somewhere public: right-click
the tray icon -> Settings, edit password=, save, then Restart server.

Your menus, images and settings live in the data folder. Back that folder up,
or use Settings -> Download backup in the control app.

Nothing needs to be installed. To move it to another machine, copy this whole
folder, including the data folder if you want to keep your menus.

Fire TV screens find this server by themselves - no address to type.
`.replace(/\n/g, '\r\n'));
step('wrote READ ME FIRST.txt');

// ------------------------------------------------------------------ zip

const zipPath = path.join(DIST, 'TaproomSignage-win-x64.zip');
rmSync(zipPath, { force: true });
execFileSync('powershell', [
  '-NoProfile', '-Command',
  `Compress-Archive -Path '${OUT}' -DestinationPath '${zipPath}' -CompressionLevel Optimal`
], { stdio: 'inherit' });
step('zipped -> ' + path.relative(ROOT, zipPath) +
  ' (' + Math.round(statSync(zipPath).size / 1048576) + ' MB)');

console.log('\nDone. Run dist/TaproomSignage/TaproomSignage.exe');
