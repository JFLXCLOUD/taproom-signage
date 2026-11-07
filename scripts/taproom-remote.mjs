// Manage the installed menu server over the SSH "direct line"
// (set up once with scripts/serve-direct-line-setup.mjs).
//
//   node scripts/taproom-remote.mjs status
//   node scripts/taproom-remote.mjs password [--raw]
//   node scripts/taproom-remote.mjs deploy [--dry-run]
//   node scripts/taproom-remote.mjs logs [lines]
//
// deploy pushes this folder's src/, public/ and package.json into the installed
// app, keeping the server's data, password, port and TV pairings. Before swapping
// files it copies the current app and database to ProgramData\TaproomSignage\updates,
// and it restores them automatically if the server does not come back healthy.
// Changes to the Windows tray/service program or installer still need Setup.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const HOST = opt('--host', 'taproom-server');
const command = args[0] || 'status';
// Test harness only: run the "remote" PowerShell on this PC after a prelude that
// stubs the Windows service. Never set when managing the real server.
const TEST_PRELUDE = process.env.TAPROOM_REMOTE_TEST_PRELUDE ? readFileSync(process.env.TAPROOM_REMOTE_TEST_PRELUDE, 'utf8') : null;

/** Run a PowerShell script on the server. -EncodedCommand sidesteps all quoting. */
function remote(script, { input, capture = true } = {}) {
  const encoded = Buffer.from(`${TEST_PRELUDE || ''}\n$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'\n${script}`, 'utf16le').toString('base64');
  const options = { input, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', maxBuffer: 64 * 1024 * 1024 };
  const result = TEST_PRELUDE
    ? spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], options)
    : spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new', HOST,
      `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`], options);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || '').replace(/#< CLIXML[\s\S]*/, '').trim();
    throw Error(`Server command failed (exit ${result.status}). ${detail || 'Run "ssh ' + HOST + ' hostname" to check the connection.'}`);
  }
  return (result.stdout || '').trim();
}
const remoteJson = script => {
  const out = remote(script);
  const line = out.split(/\r?\n/).reverse().find(l => l.startsWith('{'));
  if (!line) throw Error('Unexpected server reply: ' + out.slice(0, 400));
  return JSON.parse(line);
};

// Shared PowerShell: locate the installed service, app folder and port.
const LOCATE = String.raw`
$svc = Get-CimInstance Win32_Service -Filter "Name='TaproomSignage'"
if (-not $svc) { throw 'The TaproomSignage service is not installed on this PC.' }
$exe = if ($svc.PathName -match '^"([^"]+)"') { $matches[1] } else { ($svc.PathName -split ' ')[0] }
$installDir = Split-Path -Parent $exe
$appDir = Join-Path $installDir 'app'
$taproomHome = Join-Path $env:ProgramData 'TaproomSignage'
$config = @{}
foreach ($line in Get-Content -LiteralPath (Join-Path $taproomHome 'settings\taproom.config') -Encoding UTF8) { if ($line -match '^\uFEFF?([a-z_]+)=(.*)$') { $config[$matches[1]] = $matches[2] } }
$port = [int]$config.port
$dataDir = [IO.Path]::GetFullPath((Join-Path (Join-Path $taproomHome 'settings') $(if ($config.data_dir) { $config.data_dir } else { '..\data' })))
$appVersion = try { (Get-Content -Raw (Join-Path $appDir 'package.json') | ConvertFrom-Json).version } catch { 'unknown' }
function Test-Health { try { (Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 3).app -eq 'taproom-signage' } catch { $false } }
`;

const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const localVersion = () => JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

async function status() {
  const s = remoteJson(LOCATE + String.raw`
@{ computer = $env:COMPUTERNAME; service = "$((Get-Service TaproomSignage).Status)"; installDir = $installDir; appVersion = $appVersion; port = $port; dataDir = $dataDir; healthy = (Test-Health) } | ConvertTo-Json -Compress`);
  console.log(`Server ${s.computer}: service ${s.service}, ${s.healthy ? 'healthy' : 'NOT responding'} on port ${s.port}`);
  console.log(`Installed app ${s.appVersion} in ${s.installDir}; data in ${s.dataDir}`);
  console.log(`This laptop's app: ${localVersion()}`);
  return s;
}

function password() {
  const value = remote(LOCATE + 'Write-Output $config.password');
  if (!value) throw Error('No password found in the server settings.');
  console.log(args.includes('--raw') ? value : `Control app password: ${value}`);
}

function logs() {
  const lines = Number(args[1]) || 60;
  console.log(remote(`Get-Content -Tail ${lines} -LiteralPath (Join-Path $env:ProgramData 'TaproomSignage\\logs\\server.log')`));
}

async function deploy() {
  const version = localVersion();
  const work = mkdtempSync(path.join(tmpdir(), 'taproom-deploy-'));
  try {
    const bundle = path.join(work, `app-${version}.tgz`);
    // System tar (bsdtar) exists on both this laptop and the server.
    execFileSync(process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar',
      ['-czf', bundle, '-C', ROOT, 'src', 'public', 'package.json']);
    const hash = sha256(bundle);
    console.log(`Bundle: app ${version}, ${(statSync(bundle).size / 1024).toFixed(0)} KB, sha256 ${hash.slice(0, 12)}…`);
    const before = await status();
    if (args.includes('--dry-run')) { console.log('Dry run: nothing was sent.'); return; }

    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
    const UPDATES = remote(`$u = Join-Path $env:ProgramData 'TaproomSignage\\updates'; New-Item -ItemType Directory -Force -Path $u | Out-Null; Write-Output $u`);
    if (!/^[A-Za-z]:\\[^'"\r\n]+$/.test(UPDATES)) throw Error('Unexpected updates folder on the server: ' + UPDATES);
    const remoteBundle = `${UPDATES}\\app-${version}-${stamp}.tgz`;
    if (TEST_PRELUDE) copyFileSync(bundle, remoteBundle);
    else {
      const scp = spawnSync('scp', ['-q', '-o', 'BatchMode=yes', bundle, `${HOST}:/${remoteBundle.replace(/\\/g, '/')}`], { stdio: 'inherit' });
      if (scp.status !== 0) throw Error('Upload failed.');
    }

    console.log('Installing on the server (TVs keep showing the current menu and reconnect in a few seconds)…');
    const result = remoteJson(LOCATE + String.raw`
$bundle = '${remoteBundle}'
if ((Get-FileHash -Algorithm SHA256 $bundle).Hash.ToLower() -ne '${hash}') { throw 'Upload was corrupted; nothing was changed.' }
$stage = Join-Path '${UPDATES}' 'staging-${stamp}'
New-Item -ItemType Directory -Force -Path $stage | Out-Null
& "$env:SystemRoot\System32\tar.exe" -xzf $bundle -C $stage
if ($LASTEXITCODE -ne 0) { throw 'Could not unpack the update; nothing was changed.' }
if (-not (Test-Path (Join-Path $stage 'src\server.js')) -or (Get-Content -Raw (Join-Path $stage 'package.json') | ConvertFrom-Json).version -ne '${version}') { throw 'Update bundle is incomplete; nothing was changed.' }

# Safety copies: current app files, and the database while the service is stopped.
$backup = Join-Path '${UPDATES}' "backup-$appVersion-${stamp}"
New-Item -ItemType Directory -Force -Path $backup | Out-Null
Copy-Item -Recurse -LiteralPath $appDir -Destination (Join-Path $backup 'app')

function Stop-Menu {
  Stop-Service TaproomSignage -Force
  (Get-Service TaproomSignage).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
  # The service's job object ends node.exe; wait until it has released the files.
  for ($i = 0; $i -lt 40; $i++) {
    $running = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installDir, [StringComparison]::OrdinalIgnoreCase) })
    if (-not $running.Count) { return }
    Start-Sleep -Milliseconds 250
  }
  throw 'The menu server did not stop.'
}
function Start-Menu {
  Start-Service TaproomSignage
  # Time-boxed: a refused connection on Windows can itself take a few seconds.
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) { if (Test-Health) { return $true }; Start-Sleep -Milliseconds 500 }
  return $false
}
function Set-App([string]$from) {
  foreach ($name in 'src', 'public', 'package.json') {
    $target = Join-Path $appDir $name
    if (Test-Path -LiteralPath $target) { Remove-Item -Recurse -Force -LiteralPath $target }
    Copy-Item -Recurse -LiteralPath (Join-Path $from $name) -Destination $target
  }
}

Stop-Menu
New-Item -ItemType Directory -Force -Path (Join-Path $backup 'data') | Out-Null
foreach ($f in 'signage.db', 'signage.db-wal', 'signage.db-shm') { $p = Join-Path $dataDir $f; if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination (Join-Path $backup 'data') } }
$rolledBack = $false
try {
  Set-App $stage
  $healthy = Start-Menu
} catch { $healthy = $false; $failure = $_.Exception.Message }
if (-not $healthy) {
  try { Stop-Menu } catch { }
  Set-App (Join-Path $backup 'app')
  foreach ($f in 'signage.db', 'signage.db-wal', 'signage.db-shm') {
    $saved = Join-Path (Join-Path $backup 'data') $f; $live = Join-Path $dataDir $f
    if (Test-Path -LiteralPath $saved) { Copy-Item -Force -LiteralPath $saved -Destination $live } elseif (Test-Path -LiteralPath $live) { Remove-Item -Force -LiteralPath $live }
  }
  $rolledBack = $true
  $healthy = Start-Menu
}
Remove-Item -Recurse -Force -LiteralPath $stage
# Keep the five most recent backups and bundles.
Get-ChildItem '${UPDATES}' -Directory -Filter 'backup-*' | Sort-Object Name -Descending | Select-Object -Skip 5 | Remove-Item -Recurse -Force
Get-ChildItem '${UPDATES}' -File -Filter 'app-*.tgz' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 5 | Remove-Item -Force
$now = try { (Get-Content -Raw (Join-Path $appDir 'package.json') | ConvertFrom-Json).version } catch { 'unknown' }
@{ previous = $appVersion; installed = $now; healthy = $healthy; rolledBack = $rolledBack; failure = "$failure"; backup = $backup } | ConvertTo-Json -Compress`);

    if (result.rolledBack) throw Error(`The update did not start (${result.failure || 'health check failed'}). The server was restored to ${result.installed} and is ${result.healthy ? 'running' : 'NOT running'}. Check: node scripts/taproom-remote.mjs logs`);
    if (!result.healthy) throw Error('The server is not responding after the update. Check: node scripts/taproom-remote.mjs logs');

    // Prove the LAN is now served the files from this folder. The address is the
    // SSH host's HostName unless --address overrides it.
    const address = opt('--address') || /^hostname (\S+)$/m.exec(spawnSync('ssh', ['-G', HOST], { encoding: 'utf8' }).stdout || '')?.[1];
    const base = `http://${address}:${before.port}`;
    const served = await (await fetch(base + '/shared/theme.js', { cache: 'no-store' })).text();
    const local = readFileSync(path.join(ROOT, 'public', 'shared', 'theme.js'), 'utf8');
    if (served.replace(/\r\n/g, '\n') !== local.replace(/\r\n/g, '\n')) throw Error('The server responded, but is not serving the deployed files.');
    console.log(`Updated ${result.previous} -> ${result.installed}. Healthy at ${base}. Safety copy: ${result.backup}`);
    console.log('Reopen the control app on phones (pull to refresh) to load the new version.');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const commands = { status, password, deploy, logs };
if (!commands[command]) { console.error('Commands: status | password [--raw] | deploy [--dry-run] | logs [lines]'); process.exit(2); }
try { await commands[command](); }
catch (err) { console.error(err.message); process.exit(1); }
