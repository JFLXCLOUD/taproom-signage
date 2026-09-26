// Runs against disposable data, never against the venue server.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { planPriceIncrease } from '../src/price-adjustment.js';

const data = mkdtempSync(path.join(tmpdir(), 'signage-prices-'));
const base = 'http://127.0.0.1:18189';
const server = spawn(process.execPath, ['src/server.js'], { windowsHide: true, env: { ...process.env, DATA_DIR: data, PORT: '18189', HOST: '127.0.0.1', DISCOVERY: '0', ADMIN_PASSWORD: 'price-test', SEED_DEMO: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '', cookie, browser;
server.stdout.on('data', b => log += b); server.stderr.on('data', b => log += b);
async function request(route, body, method = 'POST', expected = 200) {
  const res = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(res.status, expected, await res.clone().text());
  return res.json();
}
const state = () => request('/api/state', undefined, 'GET');
try {
  for (let n = 0; n < 100 && !log.includes('localhost:18189/'); n++) { if (server.exitCode !== null) throw Error(log); await delay(100); }
  assert.ok(log.includes('localhost:18189/'), log);
  await request('/api/boards/missing/increase-prices', { percent: 10, preview: true }, 'POST', 401);
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'price-test' }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
  const { board } = await request('/api/boards', { name: 'Price test menu' });
  const { board: poster } = await request('/api/boards', { name: 'Poster test', layout: 'poster', content: { headline: 'Live music' } });
  await request(`/api/boards/${poster.id}/increase-prices`, { percent: 10, preview: true }, 'POST', 404);
  const section = (await state()).boards.find(b => b.id === board.id).sections[0];
  const { item } = await request(`/api/sections/${section.id}/items`, { name: 'Test drink', description: 'Keep these details', prices: [{ label: 'Glass', amount: '3.25' }, { label: 'Bottle', amount: '10.00' }, { label: 'Special', amount: 'Market price' }] });
  const { item: hidden } = await request(`/api/sections/${section.id}/items`, { name: 'Hidden drink', hidden: true, prices: [{ amount: '2.50' }] });
  const route = `/api/boards/${board.id}/increase-prices`;
  const initial = JSON.stringify((await state()).boards);
  for (const percent of [0, -10, 1001, 1.001, '10', null]) await request(route, { percent, preview: true }, 'POST', 400);
  await request(route, { percent: 10, rounding: 'bad', preview: true }, 'POST', 400);
  await request(route, { percent: 10 }, 'POST', 409);
  assert.equal(JSON.stringify((await state()).boards), initial);
  const options = { percent: 10, rounding: 'cent' };
  const plan = await request(route, { ...options, preview: true });
  assert.equal(plan.changes.length, 3); assert.equal(plan.skipped.length, 1);
  assert.deepEqual(plan.changes.map(c => c.after), ['3.58', '11.00', '2.75']);
  assert.equal(JSON.stringify((await state()).boards), initial, 'Preview must not write');
  await request('/api/items/' + item.id, { name: 'Test drink updated' }, 'PATCH');
  await request(route, { ...options, token: plan.token }, 'POST', 409);
  const fresh = await request(route, { ...options, preview: true });
  const applied = await request(route, { ...options, token: fresh.token });
  assert.equal(applied.updated, 3);
  await request(route, { ...options, token: fresh.token }, 'POST', 409);
  const saved = (await state()).boards.find(b => b.id === board.id).sections[0].items;
  assert.deepEqual(saved[0].prices.map(p => [p.id, p.amount]), item.prices.map((p,i) => [p.id, ['3.58','11.00','Market price'][i]]));
  assert.equal(saved[0].description, item.description);
  assert.equal(saved.find(i => i.id === hidden.id).hidden, true);
  const quarter = planPriceIncrease([{ name: 'Test', items: [{ id: 'i', name: 'Test', prices: [{ id: 'p', amount: '3.25' }] }] }], 10, 'quarter');
  assert.equal(quarter.changes[0].after, '3.50');
  assert.equal(planPriceIncrease([{ name: '', items: [{ prices: [{ amount: '3.10' }] }] }], 1, 'dollar').changes.length, 0, 'Rounding must never decrease prices');
  console.log('PASS: auth, validation, all sizes, hidden items, text prices, rounding, preview, stale/replay rejection and detail preservation');

  if (process.env.PLAYWRIGHT_MODULE) {
    const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base);
    await page.locator('input[type=password]').fill('price-test');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'Your TVs', exact: true }).waitFor();
    for (const [width,height] of [[320,568],[390,844],[768,1024],[1440,900],[844,390]]) {
      await page.setViewportSize({ width, height });
      await page.goto(base + '/#menu/' + board.id);
      await page.getByRole('button', { name: 'Edit Test drink updated', exact: true }).click();
      await page.getByText('Description, drink details & image', { exact: true }).click();
      await page.waitForTimeout(220);
      const visibleSave = async (top, bottom) => {
        const result = await page.getByRole('button', { name: 'Save item', exact: true }).evaluate(btn => {
          const r = btn.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, height: r.height, hit: btn.contains(document.elementFromPoint(r.x + r.width/2, r.y + r.height/2)) };
        });
        assert.ok(result.top >= top && result.bottom <= bottom + 1 && result.height >= 44 && result.hit, JSON.stringify({ width, height, top, bottom, result }));
      };
      await visibleSave(0, height);
      await page.locator('.sheet-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
      await visibleSave(0, height);
      // Model the visible viewport shrinking/panning with an on-screen keyboard.
      await page.evaluate(() => {
        Object.defineProperty(visualViewport, 'height', { configurable: true, value: 260 });
        Object.defineProperty(visualViewport, 'offsetTop', { configurable: true, value: 50 });
        visualViewport.dispatchEvent(new Event('resize'));
      });
      await visibleSave(50,310);
      await page.evaluate(() => { delete visualViewport.height; delete visualViewport.offsetTop; visualViewport.dispatchEvent(new Event('resize')); });
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      assert.equal(await page.locator('body').evaluate(el => el.classList.contains('sheet-open')), false);
      await page.goto(base + '/#design/' + board.id);
      await page.getByRole('button', { name: 'Save appearance', exact: true }).waitFor();
      await page.evaluate(() => window.scrollTo(0, 400));
      const save = await page.getByRole('button', { name: 'Save appearance', exact: true }).boundingBox();
      const header = await page.locator('.topbar').boundingBox();
      assert.ok(save.y >= header.y + header.height - 1 && save.y + save.height <= height, 'Appearance save overlaps header or viewport');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
      for (const [hash, label] of [['#menu/' + poster.id, 'Save poster'], ['#settings', 'Save venue details']]) {
        await page.goto(base + '/' + hash);
        await page.getByRole('button', { name: label, exact: true }).waitFor();
        await page.evaluate(() => window.scrollTo(0, 400));
        const button = await page.getByRole('button', { name: label, exact: true }).boundingBox();
        const topbar = await page.locator('.topbar').boundingBox();
        assert.ok(button.y >= topbar.y + topbar.height - 1 && button.y + button.height <= height, `${label} must remain visible at ${width}x${height}`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/#menu/' + board.id);
    await page.getByRole('button', { name: 'Increase menu prices', exact: true }).click();
    await page.getByLabel('Increase by (%)').fill('10');
    await page.getByRole('button', { name: 'Review prices', exact: true }).click();
    await page.getByRole('button', { name: 'Apply increase', exact: true }).waitFor();
    assert.equal((await state()).boards.find(b => b.id === board.id).sections[0].items[0].prices[0].amount, '3.58');
    await page.getByLabel('Increase by (%)').fill('20');
    await page.getByRole('button', { name: 'Review prices', exact: true }).click();
    mkdirSync('.codex-tmp', { recursive: true });
    await page.screenshot({ path: '.codex-tmp/price-preview-mobile.png' });
    await page.getByRole('button', { name: 'Apply increase', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.reload();
    await page.getByRole('button', { name: 'Increase menu prices', exact: true }).waitFor();
    assert.equal((await state()).boards.find(b => b.id === board.id).sections[0].items[0].prices[0].amount, '4.30');
    assert.deepEqual(errors, []);
    console.log('PASS: mobile/desktop dialog save visibility, keyboard viewport, appearance save, price review/change/apply/reload; no browser errors');
  }
} finally { await browser?.close(); server.kill(); console.log('Isolated data:', data); }
