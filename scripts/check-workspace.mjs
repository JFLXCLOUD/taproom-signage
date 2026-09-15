import assert from 'node:assert/strict';
import path from 'node:path';

export async function checkWorkspace({ browser, base, request, state, menu, tvs, artifacts }) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', err => errors.push(err.message));
  const nav = text => page.locator('nav').getByRole('button', { name: text, exact: true }).click();
  const waitClosed = () => page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.goto(base);
  await page.locator('input[type=password]').fill('workflow-test');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Your TVs', exact: true }).waitFor();
  assert.deepEqual(await page.locator('nav button').allTextContents(), ['TVs', 'Menus', 'Posters']);
  await page.locator('.television-card').filter({ has: page.getByRole('heading', { name: 'Main bar', exact: true }) }).getByRole('button', { name: 'Open TV' }).click();
  await page.getByRole('button', { name: 'Screen setup', exact: true }).click();
  await page.getByRole('button', { name: 'Tall / rotated right', exact: false }).click();
  await page.getByRole('button', { name: 'Save screen setup', exact: true }).click();
  await waitClosed();
  let current = await state();
  assert.equal(current.devices.find(d => d.id === tvs[0].id).orientation, 'portrait');
  assert.equal(current.devices.find(d => d.id === tvs[1].id).orientation, null);
  const seen = current.devices.find(d => d.id === tvs[0].id).last_seen;
  const preview = await request('/api/device/' + tvs[0].id + '/preview', undefined, 'GET');
  assert.equal(preview.theme.orientation, 'portrait');
  assert.equal((await state()).devices.find(d => d.id === tvs[0].id).last_seen, seen, 'Preview does not fake TV activity');
  assert.equal((await request('/api/board/main', undefined, 'GET')).theme.orientation, 'landscape', 'TV setup does not change the menu');
  await request('/api/devices/' + tvs[0].id, { orientation: 'invalid' }, 'PATCH', 400);

  await page.getByRole('button', { name: 'Choose what plays', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Friday live music', exact: true }).check();
  await page.getByRole('button', { name: 'Save to this TV', exact: true }).click();
  await waitClosed();
  const mixed = await request('/api/device/' + tvs[0].id + '/preview', undefined, 'GET');
  assert.equal(mixed.scenes.length, 2);
  assert.ok(mixed.scenes.every(s => s.theme.orientation === 'portrait'), 'Orientation applies to menus and posters');
  await page.getByRole('button', { name: 'Edit menu', exact: true }).click();
  await page.getByRole('heading', { name: 'Main Bar', exact: true }).waitFor();
  await page.getByLabel('Find a menu item').fill('Pliny');
  assert.equal(await page.locator('[data-item-name]:visible').count(), 1);
  await page.getByRole('button', { name: 'Edit prices for Pliny the Elder', exact: true }).click();
  await page.getByLabel('Price', { exact: true }).first().fill('9.50');
  await page.getByLabel('Availability', { exact: true }).selectOption('low');
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await waitClosed();
  current = await state();
  assert.equal(current.boards[0].sections[0].items[0].prices[0].amount, '9.50');
  assert.equal(current.boards[0].sections[0].items[0].status, 'low');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.frameLocator('iframe').locator('#app .row').first().waitFor();
  const oldPreset = (await request('/api/board/main', undefined, 'GET')).theme.preset;
  await page.getByRole('button', { name: 'Parisian Bistro', exact: false }).click();
  assert.equal((await request('/api/board/main', undefined, 'GET')).theme.preset, oldPreset, 'Theme is a draft until saved');
  await page.frameLocator('iframe').locator('#app[data-menu-style=bistro]').waitFor();
  await request('/api/settings', { tagline: 'An update from another controller' });
  await page.waitForTimeout(200);
  assert.equal(await page.getByText('Unsaved changes', { exact: true }).count(), 1, 'Live update preserves draft');
  page.once('dialog', d => d.dismiss());
  await nav('Posters');
  await page.getByRole('button', { name: 'Save appearance', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
  await page.waitForFunction(async () => (await (await fetch('/api/board/main')).json()).theme.preset === 'bistro');
  await page.locator('.back-link').filter({ hasText: 'Main bar' }).click();
  await page.getByRole('heading', { name: 'Main bar', exact: true }).waitFor();

  await nav('Menus');
  await page.getByRole('button', { name: '+ Add a menu', exact: true }).click();
  await page.getByLabel('Menu name', { exact: true }).fill('Lunch menu');
  await page.getByLabel('First section', { exact: true }).fill('Sandwiches');
  await page.getByRole('button', { name: 'Create menu', exact: true }).click();
  await waitClosed();
  await page.getByRole('heading', { name: 'Lunch menu', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page.getByLabel('Item name', { exact: true }).fill('Club sandwich');
  await page.getByLabel('Price', { exact: true }).fill('12');
  await page.getByRole('dialog').getByRole('button', { name: 'Add item', exact: true }).click();
  await waitClosed();
  const lunch = (await state()).boards.find(b => b.name === 'Lunch menu');
  assert.equal(lunch.sections[0].name, 'Sandwiches');
  assert.equal(lunch.sections[0].items[0].name, 'Club sandwich');
  await page.getByRole('button', { name: 'Show on TV', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Patio', exact: true }).check();
  await page.getByRole('button', { name: 'Update selected TVs', exact: true }).click();
  await waitClosed();
  const patio = await request('/api/device/' + tvs[1].id + '/preview', undefined, 'GET');
  assert.deepEqual(patio.scenes.map(s => s.board.id), [menu.id, lunch.id]);

  await nav('Posters');
  await page.getByRole('button', { name: '+ Add a poster', exact: true }).click();
  await page.getByLabel('Poster name', { exact: true }).fill('Saturday trivia');
  await page.getByLabel('Event title', { exact: true }).fill('Trivia night');
  await page.getByLabel('Date & time', { exact: true }).fill('Saturday at 7 PM');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Main bar', exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Publish poster', exact: true }).click();
  await waitClosed();
  await page.locator('.content-entry').filter({ hasText: 'Saturday trivia' }).getByRole('button', { name: 'Edit poster', exact: true }).click();
  await page.getByLabel('Event title', { exact: true }).fill('Trivia night updated');
  await request('/api/settings', { tagline: 'Still editing on the phone' });
  await page.waitForTimeout(200);
  assert.equal(await page.getByLabel('Event title', { exact: true }).inputValue(), 'Trivia night updated');
  await page.getByRole('button', { name: 'Save poster', exact: true }).click();
  await page.waitForFunction(async () => (await (await fetch('/api/state')).json()).boards.find(b => b.name === 'Saturday trivia')?.content.headline === 'Trivia night updated');
  await page.goBack();
  await page.getByRole('heading', { name: 'Posters', exact: true }).waitFor();

  // Image upload and a poster saved without changing TVs.
  await page.getByRole('button', { name: '+ Add a poster', exact: true }).click();
  await page.getByLabel('Poster name', { exact: true }).fill('Artwork only');
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload artwork', exact: true }).click();
  await (await choosing).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64') });
  await page.getByRole('button', { name: 'Replace artwork' }).waitFor();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Save poster', exact: true }).click();
  await waitClosed();
  assert.ok((await state()).boards.find(b => b.name === 'Artwork only').content.image);

  // A scanned pairing code survives sign-in, with an immediate next action.
  const { device: fresh } = await request('/api/device/register', {});
  const phone = await browser.newPage({ viewport: { width: 320, height: 740 } });
  phone.on('pageerror', e => errors.push(e.message));
  await phone.goto(base + '/?pair=' + fresh.code);
  await phone.locator('input[type=password]').fill('workflow-test');
  await phone.getByRole('button', { name: 'Sign in', exact: true }).click();
  await phone.getByRole('dialog', { name: 'Add a TV' }).waitFor();
  assert.equal(await phone.getByLabel('Pairing code').inputValue(), fresh.code);
  await phone.getByLabel('Name this TV').fill('Entrance');
  await phone.getByRole('button', { name: 'Connect TV', exact: true }).click();
  await phone.getByRole('dialog', { name: 'Choose content', exact: false }).waitFor();
  await phone.getByRole('checkbox', { name: 'Main Bar', exact: true }).check();
  await phone.getByRole('button', { name: 'Save to this TV', exact: true }).click();
  await phone.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal((await state()).devices.find(d => d.id === fresh.id).orientation, 'landscape');
  await phone.close();

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['screens', 'menus', 'posters', 'tv/' + tvs[0].id, 'menu/' + menu.id, 'design/' + menu.id, 'settings']) {
      await page.goto(base + '/#' + route);
      await page.locator('.shell').waitFor();
      await page.waitForTimeout(140);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${route} overflows at ${width}`);
    }
  }
  await nav('TVs');
  await page.screenshot({ path: path.join(artifacts, 'workspace-tvs-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(artifacts, 'workspace-tvs-mobile.png'), fullPage: true });
  await page.locator('.television-card').filter({ has: page.getByRole('heading', { name: 'Main bar', exact: true }) }).getByRole('button', { name: 'Open TV' }).click();
  await page.frameLocator('iframe').locator('#app .row').first().waitFor();
  await page.screenshot({ path: path.join(artifacts, 'workspace-tv-detail.png'), fullPage: true });
  await page.getByRole('button', { name: 'Screen setup', exact: true }).click();
  await page.screenshot({ path: path.join(artifacts, 'workspace-orientation.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Edit menu', exact: true }).click();
  await page.screenshot({ path: path.join(artifacts, 'workspace-menu.png'), fullPage: true });
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  for (const [key, label] of [['bistro', 'Parisian Bistro'], ['coastal', 'Coastal'], ['marquee', 'Marquee'], ['market', 'Fresh Market'], ['stadium', 'Stadium']]) {
    await page.getByRole('button', { name: label, exact: false }).click();
    await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
    await page.waitForFunction(async key => (await (await fetch('/api/board/main')).json()).theme.preset === key, key);
    const display = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await display.goto(base + '/d/main?preview=1');
    await display.locator(`#app[data-menu-style=${key}] .row`).first().waitFor();
    assert.equal(await display.evaluate(() => [...document.querySelectorAll('.col')].some(col => col.scrollHeight > col.clientHeight + 2)), false);
    await display.close();
  }
  assert.deepEqual(errors, []);
  const { checkBeer } = await import('./check-beer.mjs');
  await checkBeer({ browser, base, request, menu, artifacts, controlPage: page });
  console.log('PASS: TV-first navigation, per-TV orientation, preview isolation, item/price edits, theme drafts, live-update draft protection, new menu, poster upload/publish, QR pairing, browser back, 320–1440 layouts, five themes and beer effect');
  await page.close();
}
