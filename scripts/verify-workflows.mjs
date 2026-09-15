// Isolated integration checks; never opens the venue database.
// Optional browser coverage: set PLAYWRIGHT_MODULE to playwright's index.mjs.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const dataDir = mkdtempSync(path.join(tmpdir(), 'signage-workflows-'));
const port = 18187;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['src/server.js'], { env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', DISCOVERY: '0', ADMIN_PASSWORD: 'workflow-test', SEED_DEMO: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let log = ''; server.stdout.on('data', b => log += b); server.stderr.on('data', b => log += b);
let browser, cookie;
async function request(url, body, method = 'POST', expected = 200) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(res.status, expected, await res.clone().text());
  return res.json();
}
const state = () => request('/api/state', undefined, 'GET');
try {
  for (let n = 0; n < 60 && !log.includes(`localhost:${port}/`); n++) { if (server.exitCode !== null) throw Error(log); await delay(100); }
  assert.ok(log.includes(`localhost:${port}/`), log);
  await request('/api/publish', { deviceIds: [] }, 'POST', 401);
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'workflow-test' }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
  const menu = (await state()).boards[0];
  const tvs = [];
  for (const name of ['Main bar', 'Patio']) {
    const { device } = await request('/api/device/register', {});
    await request('/api/devices/claim', { code: device.code, name, board_id: menu.id });
    tvs.push(device);
  }
  const { playlist } = await request('/api/playlists', { name: 'Shared menu' });
  await request(`/api/playlists/${playlist.id}/items`, { board_id: menu.id, seconds: 90 });
  for (const tv of tvs) await request('/api/devices/' + tv.id, { playlist_id: playlist.id }, 'PATCH');
  const poster = { name: 'Friday live music', content: { headline: 'Live music', eyebrow: 'Friday · 8 PM', subhead: 'Free entry', fit: 'contain', overlay: 0 }, theme: { preset: 'marquee' } };
  const { board } = await request('/api/publish', { deviceIds: [tvs[0].id], poster, mode: 'append', seconds: 20 });
  let current = await state();
  const first = current.devices.find(d => d.id === tvs[0].id);
  assert.notEqual(first.playlist_id, playlist.id);
  assert.equal(current.devices.find(d => d.id === tvs[1].id).playlist_id, playlist.id);
  assert.deepEqual(current.playlists.find(p => p.id === first.playlist_id).items.map(i => [i.board_id, i.seconds]), [[menu.id, 90], [board.id, 20]]);
  assert.equal(current.playlists.find(p => p.id === playlist.id).items.length, 1);
  const before = JSON.stringify(current);
  await request('/api/publish', { deviceIds: [tvs[0].id, 'missing'], poster, mode: 'append', seconds: 20 }, 'POST', 400);
  assert.equal(JSON.stringify(await state()), before);
  await request('/api/publish', { deviceIds: [tvs[0].id], poster, mode: 'append', seconds: 2 }, 'POST', 400);
  assert.equal(JSON.stringify(await state()), before, 'Failed publish rolls back the poster and assignments');
  await request('/api/publish', { deviceIds: [tvs[0].id], items: [{ board_id: menu.id, seconds: 120 }, { board_id: 'missing', seconds: 20 }] }, 'POST', 400);
  assert.equal(JSON.stringify(await state()), before);
  await request('/api/publish', { deviceIds: [tvs[0].id], items: [{ board_id: menu.id, seconds: 120 }] });
  assert.equal((await state()).devices.find(d => d.id === tvs[0].id).board_id, menu.id);
  await request('/api/publish', { deviceIds: [], poster: { ...poster, name: 'Saved for later' }, mode: 'append', seconds: 20 });
  assert.equal((await state()).devices.find(d => d.id === tvs[0].id).board_id, menu.id);
  const replacement = await request('/api/publish', { deviceIds: [tvs[0].id], poster: { ...poster, name: 'Tonight only' }, mode: 'replace', seconds: 20 });
  assert.equal((await state()).devices.find(d => d.id === tvs[0].id).board_id, replacement.board.id);
  await request('/api/publish', { deviceIds: [tvs[0].id], items: [{ board_id: menu.id, seconds: 120 }] });
  console.log('PASS: authentication, append, shared-TV isolation, validation, rollback, single content, save for later');
  const { checkExpiry } = await import('./check-expiry.mjs');

  if (process.env.PLAYWRIGHT_MODULE) {
    const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
    browser = await chromium.launch({ headless: true });
    const artifacts = path.resolve('docs/ui-review'); mkdirSync(artifacts, { recursive: true });
    const { checkWorkspace } = await import('./check-workspace.mjs');
    await checkWorkspace({ browser, base, request, state, menu, tvs, artifacts });
    await checkExpiry({ browser, base, request, state, menu, tvs });
  } else { await checkExpiry({ base, request, state, menu, tvs }); console.log('Browser checks skipped: set PLAYWRIGHT_MODULE to enable.'); }
} finally {
  await browser?.close(); server.kill();
  console.log('Isolated test data:', dataDir);
}
