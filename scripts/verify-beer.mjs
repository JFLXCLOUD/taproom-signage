// Isolated animation + control-preview regression check; never edits venue data.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { checkBeer } from './check-beer.mjs';

const dataDir = mkdtempSync(path.join(tmpdir(), 'signage-beer-'));
const base = 'http://127.0.0.1:18189';
const server = spawn(process.execPath, ['src/server.js'], {
  env: { ...process.env, DATA_DIR: dataDir, PORT: '18189', HOST: '127.0.0.1', DISCOVERY: '0', ADMIN_PASSWORD: 'beer-test', SEED_DEMO: '1' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
});
let browser, cookie, log = '';
server.stdout.on('data', b => log += b); server.stderr.on('data', b => log += b);
async function request(url, body, method = 'POST') {
  const res = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  assert.equal(res.status, 200, await res.clone().text()); return res.json();
}
try {
  for (let i = 0; i < 80 && !log.includes('localhost:18189/'); i++) {
    if (server.exitCode !== null) throw Error(log); await delay(100);
  }
  assert.ok(log.includes('localhost:18189/'), log);
  const auth = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'beer-test' }) });
  cookie = auth.headers.get('set-cookie').split(';')[0];
  const menu = (await request('/api/state', undefined, 'GET')).boards[0];
  const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
  browser = await chromium.launch({ headless: true });
  const controlPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await controlPage.context().addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1], url: base }]);
  await controlPage.goto(base + '/#design/' + menu.id, { waitUntil: 'domcontentloaded' });
  const check = process.argv.includes('--orientation') ? (await import('./check-editor-orientation.mjs')).checkEditorOrientation
    : process.argv.includes('--transitions') ? (await import('./check-transitions.mjs')).checkTransitions : checkBeer;
  await check({ browser, base, request, menu, controlPage, artifacts: path.resolve('docs/ui-review') });
} finally {
  await browser?.close(); server.kill(); console.log('Isolated test data:', dataDir);
}
