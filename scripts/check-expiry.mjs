import assert from 'node:assert/strict';
import { normalizePosterExpiry, posterExpired } from '../public/shared/poster-expiry.js';

export async function checkExpiry({ browser, base, request, state, menu, tvs }) {
  const normalized = normalizePosterExpiry({ removeOn: '2030-06-02' });
  assert.equal(normalized.expiresAt, new Date(2030, 5, 2).getTime());
  assert.equal(posterExpired({ layout: 'poster', content: normalized }, normalized.expiresAt - 1), false);
  assert.equal(posterExpired({ layout: 'poster', content: normalized }, normalized.expiresAt), true);
  assert.equal(posterExpired({ layout: 'grid', content: normalized }, normalized.expiresAt), false);
  assert.throws(() => normalizePosterExpiry({ removeOn: '2030-02-30' }));
  assert.equal(normalizePosterExpiry({ headline: 'Updated' }, normalized).expiresAt, normalized.expiresAt);
  assert.equal(normalizePosterExpiry({ removeOn: '' }, normalized).expiresAt, null);

  const { board } = await request('/api/boards', { name: 'Expired test poster', layout: 'poster', skipDefaultSection: true, content: { headline: 'Old event', removeOn: '2001-01-01' } });
  assert.equal((await request('/api/board/' + board.id, undefined, 'GET')).type, 'empty');
  const originalTV = (await state()).devices.find(d => d.id === tvs[0].id);
  await request('/api/publish', { deviceIds: [tvs[0].id], items: [{ board_id: menu.id, seconds: 5 }, { board_id: board.id, seconds: 5 }] });
  const mixed = await request('/api/device/' + tvs[0].id + '/preview', undefined, 'GET');
  assert.deepEqual(mixed.scenes.map(s => s.board.id), [menu.id]);
  await request('/api/publish', { deviceIds: [tvs[0].id], items: [{ board_id: board.id, seconds: 5 }] });
  const only = await request('/api/device/' + tvs[0].id + '/preview', undefined, 'GET');
  assert.equal(only.paired, true);
  assert.equal(only.type, 'empty');
  await request('/api/boards/' + board.id, { content: { removeOn: '2030-02-30' } }, 'PATCH', 400);
  assert.ok((await state()).boards.find(b => b.id === board.id), 'Expiry retains editable poster');
  await request('/api/boards/' + board.id, { content: { removeOn: null } }, 'PATCH');
  assert.equal((await request('/api/board/' + board.id, undefined, 'GET')).type, 'board');
  await request('/api/devices/' + tvs[0].id, { board_id: originalTV.board_id, playlist_id: originalTV.playlist_id }, 'PATCH');
  console.log('PASS: midnight semantics, date validation, server filtering, expired-only TV remains paired, poster retained, expiry clearing');

  if (!browser) return;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(base + '/#posters');
  await page.locator('input[type=password]').fill('workflow-test');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: '+ Add a poster', exact: true }).click();
  await page.getByLabel('Poster name', { exact: true }).fill('Scheduled removal');
  await page.getByLabel('Event title', { exact: true }).fill('Saturday event');
  await page.getByLabel('Remove from TVs on (optional)', { exact: true }).fill('2030-06-02');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByText('Automatically stops showing at midnight on', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Save poster', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  const saved = (await state()).boards.find(b => b.name === 'Scheduled removal');
  assert.equal(saved.content.removeOn, '2030-06-02');
  assert.ok(saved.content.expiryTimeZone);
  await page.locator('.content-entry').filter({ hasText: 'Scheduled removal' }).getByRole('button', { name: 'Edit poster' }).click();
  await page.getByLabel('Remove from TVs on (optional)', { exact: true }).fill('2001-01-01');
  await page.getByRole('button', { name: 'Save poster', exact: true }).click();
  await page.waitForFunction(async id => (await (await fetch('/api/board/' + id)).json()).type === 'empty', saved.id);
  await page.getByLabel('Remove from TVs on (optional)', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save poster', exact: true }).click();
  await page.waitForFunction(async id => (await (await fetch('/api/board/' + id)).json()).type === 'board', saved.id);
  await page.close();

  // A cached poster must expire without a server connection or revision event.
  const poster = await request('/api/board/' + board.id, undefined, 'GET');
  const menuPayload = await request('/api/board/' + menu.id, undefined, 'GET');
  const display = await browser.newPage();
  const errors = []; display.on('pageerror', e => errors.push(e.message));
  let fixture;
  await display.route('**/api/playlist/expiry-test', route => route.fulfill({ json: fixture }));
  fixture = { type: 'playlist', scenes: [
    { ...poster, board: { ...poster.board, content: { ...poster.board.content, expiresAt: Date.now() + 3500 } }, sceneId: 'event', seconds: 120 },
    { ...menuPayload, sceneId: 'menu', seconds: 120 }
  ] };
  await display.goto(base + '/p/expiry-test');
  await display.getByRole('heading', { name: 'Old event', exact: true }).waitFor();
  await display.context().setOffline(true);
  await display.locator('#app .row').first().waitFor({ timeout: 7000 });
  assert.equal(await display.getByRole('heading', { name: 'Old event', exact: true }).count(), 0);
  await display.context().setOffline(false);
  // All-expired cached rotation shows a neutral message, not pairing or old art.
  fixture = { type: 'playlist', scenes: [{ ...poster, board: { ...poster.board, content: { ...poster.board.content, expiresAt: Date.now() - 1 } }, sceneId: 'event', seconds: 120 }] };
  await display.reload();
  await display.getByRole('heading', { name: 'No active content', exact: true }).waitFor();
  assert.equal(await display.locator('.pair-code').count(), 0);
  assert.deepEqual(errors, []);
  await display.close();
  console.log('PASS: create/edit/clear removal date in PWA, expiry during active playback while offline, cached expired-only rotation');
}
