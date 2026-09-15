import assert from 'node:assert/strict';
import path from 'node:path';
import { shouldPourBeer } from '../public/display/beer-transition.js';

export async function checkBeer({ browser, base, request, menu, artifacts, controlPage }) {
  const source = { board: { layout: 'grid' }, theme: { posterTransition: 'beer' } };
  const poster = { board: { layout: 'poster' } };
  assert.equal(shouldPourBeer(source, poster), true);
  for (const [from, to] of [[null, poster], [poster, source], [poster, poster], [source, source], [{ ...source, theme: {} }, poster]]) {
    assert.equal(shouldPourBeer(from, to), false);
  }
  await request('/api/boards/' + menu.id, { theme: { posterTransition: 'beer', orientation: 'landscape' } }, 'PATCH');
  const { board: event } = await request('/api/boards', { name: 'Beer reveal test', layout: 'poster', skipDefaultSection: true, content: { headline: 'Live music tonight', subhead: '8 PM · Free entry', showLogo: false } });
  const { board: other } = await request('/api/boards', { name: 'Second poster', layout: 'poster', skipDefaultSection: true, content: { headline: 'Next weekend' } });
  const { playlist } = await request('/api/playlists', { name: 'Beer animation check' });
  for (const board_id of [menu.id, event.id, other.id]) await request(`/api/playlists/${playlist.id}/items`, { board_id, seconds: 5 });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/p/' + playlist.slug);
  await page.locator('#app .row').first().waitFor();
  await page.evaluate(() => {
    window.beerCount = 0;
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (node.classList?.contains('beer-transition')) window.beerCount++;
    }).observe(document.body, { childList: true });
    // Sample at the actual scene swap, rather than after a tool round-trip
    // that may arrive after the drain has already started on a busy renderer.
    new MutationObserver(() => {
      const canvas = document.querySelector('canvas.beer-liquid');
      if (!canvas || !document.querySelector('#app.is-poster') || window.swapOpaque !== undefined) return;
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      window.swapOpaque = true;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 255) { window.swapOpaque = false; break; }
    }).observe(document.querySelector('#app'), { childList: true });
  });
  await page.locator('.beer-transition').waitFor();
  await page.waitForTimeout(1300);
  await page.screenshot({ path: path.join(artifacts, 'beer-filling.png') });
  assert.ok(await page.locator('#app .row').count(), 'Menu remains under the filling glass');
  await page.locator('.beer-transition[data-phase=drain]').waitFor();
  const coverage = await page.locator('.beer-liquid').evaluate(n => {
    const r = n.getBoundingClientRect();
    return r.left <= 0 && r.top <= 0 && r.right >= innerWidth && r.bottom >= innerHeight;
  });
  assert.equal(coverage, true, 'Beer covers every screen edge at the swap');
  assert.equal(await page.evaluate(() => window.swapOpaque), true, 'The beer pixels, not just the canvas element, cover the poster swap');
  await page.screenshot({ path: path.join(artifacts, 'beer-full.png') });
  await page.locator('.beer-transition').waitFor({ state: 'detached' });
  await page.getByRole('heading', { name: 'Live music tonight', exact: true }).waitFor();
  await page.screenshot({ path: path.join(artifacts, 'beer-revealed.png') });
  await page.waitForTimeout(3800);
  assert.equal(await page.getByRole('heading', { name: 'Live music tonight', exact: true }).count(), 1, 'Poster receives its full slot after the wipe');
  await page.getByRole('heading', { name: 'Next weekend', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.beerCount), 1, 'No poster-to-poster animation');
  await page.locator('#app .row').first().waitFor();
  assert.equal(await page.evaluate(() => window.beerCount), 1, 'No poster-to-menu animation');
  await page.close();

  // Exercise cancellation and both physical portrait mounting directions.
  const preview = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await preview.goto(base + '/d/main?preview=1');
  await preview.locator('#app .row').first().waitFor();
  for (const orientation of ['portrait', 'portraitLeft']) {
    await preview.evaluate(async orientation => {
      const { pourBeer } = await import('/display/beer-transition.js');
      window.wipe = pourBeer({ orientation }, () => { window.covered = true; });
    }, orientation);
    await preview.locator('.beer-transition[data-phase=drain]').waitFor();
    assert.equal(await preview.locator('.beer-liquid').evaluate(n => {
      const r = n.getBoundingClientRect();
      return r.left <= 1 && r.top <= 1 && r.right >= innerWidth - 1 && r.bottom >= innerHeight - 1;
    }), true, 'Portrait wipe covers panel');
    await preview.evaluate(() => window.wipe.cancel());
    assert.equal(await preview.locator('.beer-transition').count(), 0);
  }
  await preview.evaluate(async () => {
    const { pourBeer } = await import('/display/beer-transition.js');
    window.staleReveal = false;
    const wipe = pourBeer({}, () => { window.staleReveal = true; });
    wipe.cancel(); await wipe.finished;
  });
  assert.equal(await preview.evaluate(() => window.staleReveal), false);
  await preview.emulateMedia({ reducedMotion: 'reduce' });
  await preview.evaluate(async () => {
    const { pourBeer } = await import('/display/beer-transition.js');
    window.revealed = false;
    await pourBeer({}, () => { window.revealed = true; }).finished;
  });
  assert.equal(await preview.evaluate(() => window.revealed), true);
  assert.equal(await preview.locator('.beer-transition').count(), 0);
  assert.deepEqual(errors, []);
  await preview.close();
  await controlPage.getByLabel('When this menu changes to a poster', { exact: true }).selectOption('beer');
  await controlPage.getByRole('button', { name: 'Save appearance', exact: true }).click();
  await controlPage.waitForFunction(async () => (await (await fetch('/api/board/main')).json()).theme.posterTransition === 'beer');
  await controlPage.frameLocator('iframe[title="Board preview"]').locator('#app .row').first().waitFor();
  const beforePreview = await request('/api/state', undefined, 'GET');
  // The button is far below the inline preview on phones. The effect must be
  // visible where the user is, including while the menu is still loading.
  await controlPage.route('**/api/board/main', async route => {
    await new Promise(resolve => setTimeout(resolve, 500)); await route.continue();
  });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await controlPage.setViewportSize(viewport);
    await controlPage.getByRole('button', { name: 'Preview beer animation', exact: true }).click();
    const dialog = controlPage.getByRole('dialog', { name: 'Beer animation preview' });
    await dialog.waitFor();
    const frame = dialog.frameLocator('iframe');
    await frame.locator('.beer-transition').waitFor();
    await frame.locator('body').evaluate(() => window.dispatchEvent(new Event('resize')));
    const bounds = await dialog.locator('.preview-frame').boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, 'Beer preview is inside the visible viewport');
    await frame.getByRole('heading', { name: 'Your next event', exact: true }).waitFor();
    await frame.locator('.beer-transition').waitFor({ state: 'detached' });
    await controlPage.screenshot({ path: path.join(artifacts, `beer-preview-${viewport.width}.png`) });
    await dialog.getByRole('button', { name: 'Play again', exact: true }).click();
    await frame.locator('.beer-transition').waitFor();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await dialog.count(), 0, 'Closing during playback removes the preview');
  }
  await controlPage.unroute('**/api/board/main');
  await controlPage.emulateMedia({ reducedMotion: 'reduce' });
  await controlPage.getByRole('button', { name: 'Preview beer animation', exact: true }).click();
  const dialog = controlPage.getByRole('dialog', { name: 'Beer animation preview' });
  const reducedFrame = dialog.frameLocator('iframe');
  await reducedFrame.locator('canvas.beer-liquid').waitFor();
  assert.equal(await reducedFrame.locator('.beer-transition').evaluate(el => getComputedStyle(el).display !== 'none'), true,
    'Explicit desktop preview stays visible with reduced motion enabled');
  await reducedFrame.getByRole('heading', { name: 'Your next event', exact: true }).waitFor();
  await reducedFrame.locator('.beer-transition').waitFor({ state: 'detached' });
  await dialog.getByText('Preview finished. Play it again whenever you like.', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Play again', exact: true }).click();
  await reducedFrame.locator('canvas.beer-liquid').waitFor();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await controlPage.emulateMedia({ reducedMotion: 'no-preference' });
  const afterPreview = await request('/api/state', undefined, 'GET');
  assert.deepEqual(afterPreview.boards, beforePreview.boards, 'Preview does not save appearance or sample poster');
  assert.deepEqual(afterPreview.devices, beforePreview.devices, 'Preview does not change TV assignments');
  assert.equal((await request('/api/board/main', undefined, 'GET')).board.layout, 'grid', 'Preview does not change saved content');
  console.log('PASS: beer direction gating, full coverage, poster timing, portrait rotations, cancellation and reduced motion');
}
