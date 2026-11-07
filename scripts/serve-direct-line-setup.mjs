// Serve the one-time "direct line" setup script to the menu server PC, then record
// the Windows account it reports so `ssh taproom-server` works from this laptop.
//
//   node scripts/serve-direct-line-setup.mjs [--server 192.168.1.191] [--port 8131]
//
// On the server PC, in PowerShell opened with "Run as administrator", paste the
// command this prints. Only the server's address may fetch the script or report
// back, and this helper exits after one successful report (or after --minutes, default 60).
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { networkInterfaces, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const server = opt('--server', '192.168.1.191');
const port = Number(opt('--port', '8131'));
const alias = opt('--alias', 'taproom-server');
const minutes = Number(opt('--minutes', '60'));
const keyFile = opt('--key', path.join(homedir(), '.ssh', 'id_ed25519_taproom'));
const sshConfig = opt('--ssh-config', path.join(homedir(), '.ssh', 'config'));

const publicKey = readFileSync(keyFile + '.pub', 'utf8').trim();
if (!/^ssh-ed25519 [A-Za-z0-9+/=]{60,}( [\w.@-]+)?$/.test(publicKey)) throw Error('Unexpected public key format in ' + keyFile + '.pub');

// Listen on this laptop's address in the server's /24 so the server can reach it.
const prefix = server.split('.').slice(0, 3).join('.') + '.';
const host = Object.values(networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && a.address.startsWith(prefix))?.address;
if (!host) throw Error(`This laptop has no address on ${prefix}0/24. Join the venue network first.`);

const reportUrl = `http://${host}:${port}/done`;
const script = readFileSync(path.join(ROOT, 'windows', 'Enable-DirectLine.ps1'), 'utf8')
  .replace("'__TAPROOM_PUBLIC_KEY__'", `'${publicKey}'`)
  .replace("'__TAPROOM_REPORT_URL__'", `'${reportUrl}'`);

function remember(user) {
  // Replace (or add) our Host block; leave every other entry untouched.
  const block = [
    `Host ${alias} ${server}`,
    `    HostName ${server}`,
    `    User ${/\s/.test(user) ? `"${user}"` : user}`,
    `    IdentityFile ~/.ssh/${path.basename(keyFile)}`,
    '    IdentitiesOnly yes',
    '    ServerAliveInterval 30',
    ''
  ].join('\n');
  let text = existsSync(sshConfig) ? readFileSync(sshConfig, 'utf8').replace(/\r\n/g, '\n') : '';
  if (existsSync(sshConfig)) copyFileSync(sshConfig, sshConfig + '.bak-taproom');
  const re = new RegExp(`(^|\\n)Host ${alias}[^\\n]*\\n(?:[ \\t]+[^\\n]*\\n?)*`);
  text = re.test(text) ? text.replace(re, (m, lead) => lead + block) : text.replace(/\n*$/, '\n\n') + block;
  writeFileSync(sshConfig, text.replace(/^\n+/, ''));
}

const fromServer = req => (req.socket.remoteAddress || '').replace(/^::ffff:/, '') === server || args.includes('--any');
const http = createServer((req, res) => {
  if (!fromServer(req)) { res.writeHead(403).end('Forbidden\n'); return; }
  if (req.method === 'GET' && req.url === '/setup') {
    console.log(`  ${new Date().toLocaleTimeString()} server fetched the setup script`);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end(script);
    return;
  }
  if (req.method === 'POST' && req.url === '/done') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 8192) req.destroy(); });
    req.on('end', () => {
      let report;
      try { report = JSON.parse(body); } catch { res.writeHead(400).end('Bad report\n'); return; }
      // Windows account names: letters, digits, space and a few punctuation marks.
      if (typeof report.user !== 'string' || !/^[\w .@$'-]{1,64}$/.test(report.user)) { res.writeHead(400).end('Bad account name\n'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      remember(report.user);
      console.log(`\nSetup finished on ${report.computer || server}: account "${report.user}", menu service ${report.taproomService || 'unknown'}.`);
      console.log(`Saved "Host ${alias}" in ${sshConfig}. Test with: ssh ${alias} hostname`);
      console.log('DIRECT_LINE_REPORT ' + JSON.stringify(report));
      http.close(); process.exit(0);
    });
    return;
  }
  res.writeHead(404).end('Not found\n');
});
http.listen(port, host, () => {
  console.log(`Waiting for ${server} on http://${host}:${port}/setup (closes after one report, or in ${minutes} minutes).`);
  console.log('\nOn the server PC, open PowerShell with "Run as administrator" and paste:\n');
  console.log(`  & ([scriptblock]::Create((irm http://${host}:${port}/setup)))\n`);
});
setTimeout(() => { console.error(`No report within ${minutes} minutes; closing.`); process.exit(1); }, minutes * 60 * 1000).unref();
