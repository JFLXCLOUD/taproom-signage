import assert from 'node:assert/strict';
import path from 'node:path';
import { posterTransitionFor } from '../public/display/poster-transitions.js';

export async function checkTransitions({ browser, base, request, menu, controlPage: control, artifacts }) {
  // Compact labels remain readable, keyboard reachable, and inside the page.
  for (const width of [320, 390, 768, 1440]) {
    await control.setViewportSize({ width, height: 900 });
    const grid = control.locator('.transition-previews');
    await grid.scrollIntoViewIfNeeded();
    const boxes = await grid.locator('button').evaluateAll(buttons => buttons.map(b => {
      const r = b.getBoundingClientRect(), style = getComputedStyle(b);
      return { left: r.left, right: r.right, height: r.height, font: parseFloat(style.fontSize), clipped: b.scrollWidth > b.clientWidth + 1, name: b.getAttribute('aria-label') };
    }));
    assert.equal(boxes.length, 6);
    assert.ok(boxes.every(b => b.left >= 0 && b.right <= width && b.height >= 36 && b.height <= 44 && b.font <= 12 && !b.clipped && b.name.startsWith('Preview ')));
    await control.screenshot({ path: path.join(artifacts, `transition-buttons-${width}.png`) });
  }
  await control.getByRole('button', { name: 'Preview smoke reveal', exact: true }).focus();
  await control.keyboard.press('Enter');
  await control.getByRole('dialog', { name: 'Smoke reveal preview' }).getByRole('button', { name: 'Close', exact: true }).click();
  const poster = { board: { layout: 'poster' } };
  for (const effect of ['beer', 'ice', 'curtain', 'smoke', 'whiskey', 'champagne']) {
    const source = { board: { layout: 'grid' }, theme: { posterTransition: effect } };
    assert.equal(posterTransitionFor(source, poster), effect);
    for (const [from, to] of [[poster, source], [poster, poster], [source, source], [null, poster]]) assert.equal(posterTransitionFor(from, to), 'none');
  }
  assert.equal(posterTransitionFor({ board: {}, theme: { posterTransition: 'bogus' } }, poster), 'none');
  const { board: event } = await request('/api/boards', { name: 'Transition event', layout: 'poster', content: { headline: 'Show starts at eight' } });
  const { playlist } = await request('/api/playlists', { name: 'Transition test' });
  for (const board_id of [menu.id, event.id]) await request(`/api/playlists/${playlist.id}/items`, { board_id, seconds: 5 });
  for (const [effect, title, button] of [
    ['ice', 'Ice-cold glass preview', 'Preview ice-cold glass'],
    ['curtain', 'Stage curtain preview', 'Preview stage curtain'],
    ['smoke', 'Smoke reveal preview', 'Preview smoke reveal'],
    ['whiskey', 'Whiskey swirl preview', 'Preview whiskey swirl'],
    ['champagne', 'Champagne fizz preview', 'Preview champagne fizz']
  ]) {
    await control.getByLabel('When this menu changes to a poster', { exact: true }).selectOption(effect);
    await control.getByRole('button', { name: 'Save appearance', exact: true }).click();
    await control.getByText('No unsaved changes', { exact: true }).waitFor();
    assert.equal((await request('/api/board/main', undefined, 'GET')).theme.posterTransition, effect);
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/p/' + playlist.slug, { waitUntil: 'domcontentloaded' });
    await page.locator('#app .row').first().waitFor();
    await page.evaluate(() => {
      window.wipes = 0;
      new MutationObserver(records => records.forEach(r => r.addedNodes.forEach(n => { if (n.classList?.contains('poster-transition')) window.wipes++; }))).observe(document.body, { childList: true });
      new MutationObserver(() => {
        const c = document.querySelector('.poster-transition canvas');
        if (!c || !document.querySelector('#app.is-poster') || window.opaque !== undefined) return;
        window.opaque = c.getContext('2d').getImageData(0, 0, c.width, c.height).data.every((v, i) => i % 4 !== 3 || v === 255);
      }).observe(document.querySelector('#app'), { childList: true });
    });
    await page.locator('.effect-' + effect).waitFor();
    await page.waitForTimeout(850);
    await page.screenshot({ path: path.join(artifacts, effect + '-closing.png') });
    await page.getByRole('heading', { name: 'Show starts at eight', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.opaque), true, 'Actual swap pixels are opaque');
    await page.locator('.poster-transition').waitFor({ state: 'detached' });
    await page.waitForTimeout(3700);
    assert.equal(await page.getByRole('heading', { name: 'Show starts at eight', exact: true }).count(), 1, 'Poster gets its full slot after the effect');
    await page.locator('#app .row').first().waitFor();
    assert.equal(await page.evaluate(() => window.wipes), 1, 'No effect from poster back to menu');
    assert.deepEqual(errors, []); await page.close();
    const before = (await request('/api/state', undefined, 'GET')).boards;
    for (const width of [390, 1440]) {
      await control.setViewportSize({ width, height: 900 });
      await control.emulateMedia({ reducedMotion: width === 1440 ? 'reduce' : 'no-preference' });
      await control.getByRole('button', { name: button, exact: true }).click();
      const dialog = control.getByRole('dialog', { name: title }), frame = dialog.frameLocator('iframe');
      await frame.locator('.effect-' + effect).waitFor();
      const rect = await dialog.locator('.preview-frame').boundingBox();
      assert.ok(rect.y >= 0 && rect.y + rect.height <= 900);
      await frame.getByRole('heading', { name: 'Your next event', exact: true }).waitFor();
      await frame.locator('.poster-transition').waitFor({ state: 'detached' });
      await dialog.getByRole('button', { name: 'Play again', exact: true }).click();
      await frame.locator('.poster-transition').waitFor();
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    }
    assert.deepEqual((await request('/api/state', undefined, 'GET')).boards, before, 'Previews never save content');
    await control.emulateMedia({ reducedMotion: 'no-preference' });
    console.log('PASS: ' + effect + ' save, real rotation, opaque swap, poster timing, mobile/desktop preview and reduced-motion explicit replay');
  }
  const page = await browser.newPage(); await page.goto(base + '/d/main?preview=1', { waitUntil: 'domcontentloaded' });
  for (const key of ['ice', 'curtain', 'smoke', 'whiskey', 'champagne']) for (const orientation of ['portrait', 'portraitLeft']) {
    assert.equal(await page.evaluate(async ({ key, orientation }) => {
      const { runPosterTransition } = await import('/display/poster-transitions.js');
      let covered = false;
      const wipe = runPosterTransition(key, { orientation }, () => {
        const c = document.querySelector('.poster-transition canvas');
        const r = c.getBoundingClientRect();
        covered = r.left <= 1 && r.top <= 1 && r.right >= innerWidth - 1 && r.bottom >= innerHeight - 1;
      });
      await wipe.finished; return covered;
    }, { key, orientation }), true, key + ' portrait coverage');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const key of ['ice', 'curtain', 'smoke', 'whiskey', 'champagne']) {
    assert.equal(await page.evaluate(async key => {
      const { runPosterTransition } = await import('/display/poster-transitions.js');
      let calls = 0; await runPosterTransition(key, {}, () => calls++).finished;
      const wipe = runPosterTransition(key, {}, () => calls++, { preview: true }); wipe.cancel(); await wipe.finished;
      return calls === 1 && !document.querySelector('.poster-transition');
    }, key), true, 'Automatic reduced motion and cancellation');
  }
  await page.close();
  console.log('PASS: both portrait directions, cancellation and automatic reduced motion');
}
