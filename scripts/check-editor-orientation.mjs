import assert from 'node:assert/strict';

export async function checkEditorOrientation({ browser, base, request, menu, controlPage: page }) {
  await request('/api/boards/' + menu.id, { theme: { orientation: 'portrait' } }, 'PATCH');
  const { device } = await request('/api/device/register', {});
  await request('/api/devices/claim', { code: device.code, name: 'Test2', board_id: menu.id, orientation: 'portrait' });
  const { device: other } = await request('/api/device/register', {});
  await request('/api/devices/claim', { code: other.code, name: 'Other TV', board_id: menu.id, orientation: 'portraitLeft' });
  await page.goto(base + '/#tv/' + device.id, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Screen setup', exact: true }).click();
  await page.locator('.orientation-choice').filter({ hasText: 'Landscape' }).click();
  await page.getByRole('button', { name: 'Save screen setup', exact: true }).click();
  await page.locator('.sheet-backdrop').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Edit menu', exact: true }).click();
  assert.ok(page.url().endsWith('/' + device.id), 'TV context survives Edit menu');
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Preview menu', exact: true }).click();
  const popup = await popupPromise;
  await popup.locator('#app .row').first().waitFor();
  assert.equal(new URL(popup.url()).searchParams.get('orientation'), 'landscape');
  assert.equal(await popup.locator('#app.rot-90, #app.rot-270').count(), 0);
  await popup.close();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  const frame = page.frameLocator('iframe[title="Board preview"]');
  await frame.locator('#app .row').first().waitFor();
  const checkWide = async () => {
    assert.equal(await frame.locator('#app.rot-90, #app.rot-270').count(), 0);
    const rect = await page.locator('.appearance-preview .preview-frame').boundingBox();
    assert.ok(rect.width > rect.height, 'Frame uses the TV landscape orientation');
  };
  await checkWide();
  await page.getByLabel('Columns', { exact: true }).selectOption('3');
  await checkWide();
  await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
  await page.getByText('No unsaved changes', { exact: true }).waitFor();
  await frame.locator('#app .row').first().waitFor();
  await checkWide();
  let state = await request('/api/state', undefined, 'GET');
  assert.equal(state.boards.find(b => b.id === menu.id).theme.orientation, 'portrait', 'Appearance save does not write TV orientation into shared menu');
  assert.equal(state.devices.find(d => d.id === other.id).orientation, 'portraitLeft');
  const beforePreview = JSON.stringify(state.devices);
  await page.getByRole('button', { name: 'Preview beer animation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Beer animation preview' });
  await dialog.frameLocator('iframe').locator('canvas.beer-liquid').waitFor();
  assert.equal(await dialog.frameLocator('iframe').locator('.beer-rot-90, .beer-rot-270').count(), 0);
  const bounds = await dialog.locator('.preview-frame').boundingBox();
  assert.ok(bounds.width > bounds.height);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(JSON.stringify((await request('/api/state', undefined, 'GET')).devices), beforePreview, 'Previews do not change pairing or TV activity');

  // Verify both mounting directions, player-controlled orientation, inheritance,
  // and a standalone library visit with no TV context.
  for (const [orientation, degrees] of [['portrait', 90], ['portraitLeft', 270], ['auto', 0], [null, 90]]) {
    await request('/api/devices/' + device.id, { orientation }, 'PATCH');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await frame.locator('#app .row').first().waitFor();
    assert.equal(await frame.locator('#app').evaluate(n => n.classList.contains('rot-90') ? 90 : n.classList.contains('rot-270') ? 270 : 0), degrees);
    const rect = await page.locator('.appearance-preview .preview-frame').boundingBox();
    assert.equal(rect.height > rect.width, degrees !== 0);
  }
  await page.goto(base + '/#design/' + menu.id, { waitUntil: 'domcontentloaded' });
  await frame.locator('#app.rot-90 .row').first().waitFor();
  console.log('PASS: TV screen setup flows into content popup, appearance, draft/save and beer previews; portrait directions, auto, inheritance, library view and shared-TV isolation');
}
