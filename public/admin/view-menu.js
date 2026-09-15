import {
  h, api, store, currentBoard, mutate, sheet, confirmSheet,
  field, input, select, toggle, toast, uploadImage, emit, markDirty, clearDirty
} from './core.js';
import { newPoster, pageHeading, assignedTo, navigate, showOnTV, removalDateField } from './view-home.js';
import { editorHeader, contentPreviewUrl } from './navigation.js';
import { icon } from './icons.js';
import { SECTION_KINDS, STATUSES } from '../shared/theme.js';

const STATUS_ORDER = ['on', 'low', 'off', 'soon'];
const AVAILABILITY = { on: 'Available', low: 'Running low', off: 'Sold out', soon: 'Coming soon' };
let reorderingSection = null;

export function renderMenu() {
  const board = store.state.boards.find(b => b.id === store.boardId);
  if (board && board.layout === 'poster') return renderPoster(board);
  if (!board) {
    return h('div.empty',
      h('p', 'Choose a menu to get started.'),
      h('button.btn.btn-primary', { onclick: createBoard }, 'Create a menu'));
  }

  const sections = (board.sections || []).map(section => sectionCard(board, section));
  const emptySearch = h('p.empty', { hidden: true }, 'No matching items. Try another name.');
  const search = input({ type: 'search', placeholder: 'Find an item by name…', 'aria-label': 'Find a menu item', oninput: () => {
    let matches = 0;
    sections.forEach(card => {
      let visible = 0;
      card.querySelectorAll('[data-item-name]').forEach(row => {
        row.hidden = !row.dataset.itemName.includes(search.value.trim().toLowerCase());
        if (!row.hidden) visible++;
      });
      card.hidden = !!search.value && !visible; matches += visible;
    });
    emptySearch.hidden = !search.value || matches > 0;
  } });
  return h('div',
    contentHeading(board),
    field('Find an item to update', search), emptySearch, ...sections,
    h('button.btn.btn-block', { style: { marginTop: '14px' }, onclick: () => addSection(board) },
      icon('plus', 17), 'Add section'),
    h('div.section-title', 'Menu details'),
    h('div.row-btns',
      h('button.btn.btn-sm', { onclick: () => editBoard(board) },
        icon('pencil', 15), 'Name & scrolling message'),
      h('button.btn.btn-sm', { onclick: () => window.open(contentPreviewUrl(board), '_blank') },
        icon('external', 15), 'Preview menu'),
      h('button.btn.btn-sm', { onclick: createBoard }, icon('plus', 15), 'New menu')));
}

// ------------------------------------------------------------------ posters

function renderPoster(board) {
  const c = board.content || {};
  let imageId = c.image || null;
  let showLogo = c.showLogo !== false;
  let uploading = false;
  const headline = input({ value: c.headline || '', placeholder: 'Live music' });
  const when = input({ value: c.eyebrow || '', placeholder: 'Friday at 8 PM' });
  const subhead = input({ value: c.subhead || '', placeholder: 'Free entry' });
  const body = h('textarea.input', { value: c.body || '', placeholder: 'Optional details' });
  const removeOn = input({ type: 'date', value: c.removeOn || '' });
  const align = select(c.align || 'center', [['center', 'Centre'], ['top', 'Top left'], ['bottom', 'Bottom left']]);
  const fit = select(c.fit || 'cover', [['contain', 'Show the entire artwork'], ['cover', 'Fill the TV (may crop)']]);
  const overlay = input({ type: 'range', min: 0, max: 0.9, step: 0.05, value: c.overlay ?? (c.image ? 0.45 : 0), 'aria-label': 'Darken artwork' });
  const artwork = h('div.poster-upload-preview');
  const drawArt = () => {
    artwork.replaceChildren(imageId ? h('img', { src: '/u/' + imageId, alt: 'Poster artwork' }) : h('p', 'Text-only poster. Add artwork if you like.'));
  };
  drawArt();
  const upload = h('button.btn', { onclick: async () => {
    uploading = true; upload.disabled = true;
    try { const id = await uploadImage({ maxSize: 1920, quality: 0.85 }); if (id) { imageId = id; drawArt(); markDirty(); } }
    catch (err) { toast(err.message, true); }
    finally { uploading = false; upload.disabled = false; }
  } }, icon('upload', 17), 'Choose artwork');
  const saveButton = h('button.btn.btn-primary.btn-block', { onclick: async () => {
    if (uploading) return toast('Finish choosing the artwork first.', true);
    saveButton.disabled = true;
    try {
      const ok = await mutate(() => api.patch('/api/boards/' + board.id, { content: {
        image: imageId, headline: headline.value.trim(), eyebrow: when.value.trim(), subhead: subhead.value.trim(),
        body: body.value.trim(), align: align.value, fit: fit.value, overlay: Number(overlay.value), showLogo, removeOn: removeOn.value || null
      } }), 'Poster saved');
      if (ok) { clearDirty(); emit(); }
    } finally { saveButton.disabled = false; }
  } }, 'Save poster');
  return h('div', { oninput: markDirty, onchange: markDirty }, contentHeading(board),
    h('div.card', h('div.card-head', h('h2', board.name), h('span.status-pill', 'Poster')),
      h('div.card-body', artwork, h('div.row-btns', upload, h('button.btn', { onclick: () => { imageId = null; drawArt(); markDirty(); } }, 'Remove artwork')),
        h('p.hint', 'Artwork and text changes apply together when you save.'),
        field('Event title', headline), field('Date or short announcement', when), field('Time, location or entry details', subhead), field('Extra details', body),
        removalDateField(removeOn, c.expiryTimeZone),
        h('details.advanced', h('summary', 'Artwork & text placement'),
          field('Text position', align), field('Artwork fit', fit), field('Darken artwork', overlay),
          toggle('Show venue logo', showLogo, v => { showLogo = v; markDirty(); })), saveButton)),
    h('div.row-btns', h('button.btn', { onclick: () => editBoard(board) }, 'Rename or delete'),
      h('button.btn', { onclick: () => window.open(contentPreviewUrl(board), '_blank') }, 'Preview on TV'),
      h('button.btn', { onclick: createBoard }, icon('plus', 17), 'New menu')));
}

function contentHeading(board) {
  return h('div', editorHeader(board),
    h('div.content-scope', h('div', h('strong', assignedTo(board.id)), h('p.hint', 'Saving edits updates this content everywhere it is shown.')),
      h('button.btn', { onclick: () => showOnTV(board) }, 'Show on TV')));
}

// ------------------------------------------------------------------ sections

function sectionCard(board, section) {
  const items = section.items || [];
  return h('div.card' + (reorderingSection === section.id ? '.is-reordering' : ''),
    h('div.card-head',
      h('h2', section.name || 'Untitled'),
      section.hidden ? h('span.status-pill.status-off', 'Hidden') : null,
      h('button.btn.btn-ghost.btn-sm', { onclick: () => { reorderingSection = reorderingSection === section.id ? null : section.id; emit(); } }, reorderingSection === section.id ? 'Done' : 'Reorder'),
      h('button.btn.btn-ghost.btn-sm', { onclick: () => editSection(board, section) }, 'Edit section')),
    items.length
      ? h('div.card-body.tight', ...items.map((item, i) => itemRow(section, item, i, items.length)))
      : h('div.empty', h('p', 'No items in this section yet.')),
    h('div.card-body',
      h('button.btn.btn-block.btn-sm', { onclick: () => editItem(section, null) },
        icon('plus', 17), 'Add item')));
}

function addSection(board) {
  const name = h('input.input', { value: '', placeholder: 'e.g. On Draft' });
  const kind = select('draft', Object.entries(SECTION_KINDS).map(([k, v]) => [k, v.label]));
  sheet({
    title: 'New section',
    body: h('div', field('Name', name), field('Type', kind,
      'Type only sets sensible defaults for new items — it does not limit what you can enter.')),
    saveLabel: 'Add',
    onSave: () => mutate(
      () => api.post(`/api/boards/${board.id}/sections`, { name: name.value.trim() || 'New section', kind: kind.value }),
      'Section added')
  });
}

function editSection(board, section) {
  const name = h('input.input', { value: section.name });
  const kind = select(section.kind, Object.entries(SECTION_KINDS).map(([k, v]) => [k, v.label]));
  const note = h('input.input', { value: section.note || '', placeholder: 'Optional line under the heading' });
  let hidden = !!section.hidden;

  const editor = sheet({
    title: 'Edit section',
    body: h('div',
      field('Name', name),
      field('Type', kind),
      field('Note', note),
      toggle('Hide this whole section from the display', hidden, v => { hidden = v; })),
    extra: h('button.btn.btn-danger.btn-sm', {
      onclick: async () => {
        const ok = await confirmSheet('Delete section?',
          `"${section.name}" and its ${(section.items || []).length} item(s) will be removed.`);
        if (ok && await mutate(() => api.del('/api/sections/' + section.id), 'Section deleted')) editor.close();
      }
    }, 'Delete'),
    onSave: () => mutate(
      () => api.patch('/api/sections/' + section.id,
        { name: name.value.trim(), kind: kind.value, note: note.value.trim(), hidden }),
      'Section saved')
  });
}

// ------------------------------------------------------------------ items

function itemRow(section, item, index, total) {
  const price = (item.prices || [])[0];
  const sub = [item.style, item.producer].filter(Boolean).join(' · ');

  const move = async (dir) => {
    const ids = section.items.map(i => i.id);
    const to = index + dir;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    await mutate(() => api.post('/api/reorder', { kind: 'items', parentId: section.id, ids }));
  };

  return h('div.item' + (item.status === 'off' || item.hidden ? '.is-off' : ''), { dataset: { itemName: (item.name || '').toLowerCase() } },
    h('span.swatch', { style: item.color ? { background: item.color } : null }),
    h('div.item-grab',
      h('button', { onclick: () => move(-1), disabled: index === 0, 'aria-label': 'Move up' },
        icon('chevronUp', 14)),
      h('button', { onclick: () => move(1), disabled: index === total - 1, 'aria-label': 'Move down' },
        icon('chevronDown', 14))),
    h('button.item-main.item-edit', { onclick: () => editItem(section, item), 'aria-label': 'Edit ' + item.name },
      h('div.item-name', (item.tap ? item.tap + '. ' : '') + (item.name || 'Untitled')),
      sub ? h('div.item-sub', sub) : null),
    price ? h('button.item-price.price-edit', { onclick: () => editItem(section, item), 'aria-label': 'Edit prices for ' + item.name }, formatAmount(price.amount), item.prices.length > 1 ? '+' : '') : null,
    item.hidden ? h('span.status-pill', 'Hidden from TV') : null,
    statusPill(item));
}

function formatAmount(amount) {
  const raw = String(amount ?? '').trim();
  if (!raw) return '';
  const currency = store.state.settings?.currency || '$';
  return /^\d+(\.\d+)?$/.test(raw) ? currency + raw : raw;
}

/** Show explicit choices so staff never have to guess the next status. */
function statusPill(item) {
  const status = item.status || 'on';
  const label = AVAILABILITY[status] || status;
  return h('button.status-pill.status-' + status, {
    onclick: () => {
      const modal = sheet({ title: 'Availability · ' + item.name, body: h('div.content-choices',
        ...STATUS_ORDER.map(key => h('button.btn.btn-block', {
          style: { marginBottom: '8px' },
          onclick: async () => {
            if (await mutate(() => api.patch('/api/items/' + item.id, { status: key }), 'Availability updated')) modal.close();
          }
        }, AVAILABILITY[key] + (key === status ? ' (current)' : '')))) });
    }
  }, label);
}

function editItem(section, item) {
  const isNew = !item;
  const data = item || { status: 'on', prices: [] };

  const f = {
    name: h('input.input', { value: data.name || '', placeholder: 'Pliny the Elder' }),
    tap: h('input.input', { value: data.tap || '', placeholder: '1', inputmode: 'numeric' }),
    style: h('input.input', { value: data.style || '', placeholder: 'Double IPA' }),
    producer: h('input.input', { value: data.producer || '', placeholder: 'Russian River' }),
    origin: h('input.input', { value: data.origin || '', placeholder: 'Santa Rosa, CA' }),
    abv: h('input.input', { value: data.abv ?? '', placeholder: '8.0', inputmode: 'decimal' }),
    ibu: h('input.input', { value: data.ibu ?? '', placeholder: '100', inputmode: 'numeric' }),
    badge: h('input.input', { value: data.badge || '', placeholder: 'Rare' }),
    description: h('textarea.input', { placeholder: 'Shown only if descriptions are enabled in Design' }),
    status: select(data.status || 'on', Object.entries(AVAILABILITY))
  };
  f.description.value = data.description || '';

  let color = data.color || '';
  const colorPicker = h('input', { type: 'color', value: color || '#e8b04b',
    oninput: (e) => { color = e.target.value; } });
  const clearColor = h('button.btn.btn-sm', { onclick: () => { color = ''; toast('Colour cleared'); } }, 'Clear');

  let image = data.image || null;
  const imageBtn = h('button.btn.btn-sm', {
    onclick: async () => {
      try {
        const id = await uploadImage({ maxSize: 400 });
        if (id) { image = id; imageBtn.textContent = 'Image set ✓'; }
      } catch (err) { toast(err.message, true); }
    }
  }, icon('image', 15), image ? 'Replace image' : 'Add image');

  const pricesBox = h('div');
  const priceRows = [];
  const addPrice = (p = { label: '', amount: '' }) => {
    const lbl = h('input.input.lbl', { 'aria-label': 'Serving size', value: p.label || '', placeholder: 'Size, e.g. 16 oz' });
    const amt = h('input.input.amt', { 'aria-label': 'Price', value: p.amount || '', placeholder: '8', inputmode: 'decimal' });
    const row = h('div.price-row', lbl, amt,
      h('button.btn.btn-sm.btn-danger', {
        'aria-label': 'Remove price',
        onclick: () => { row.remove(); priceRows.splice(priceRows.findIndex(r => r.row === row), 1); }
      }, icon('x', 15)));
    priceRows.push({ row, lbl, amt });
    pricesBox.appendChild(row);
  };
  (data.prices || []).forEach(addPrice);
  if (!(data.prices || []).length) addPrice();

  let hidden = !!data.hidden;

  const body = h('div',
    h('p.hint', 'Update the name, price, or availability, then save. Other details are optional.'),
    field('Item name', f.name),
    field('Prices', h('div', pricesBox,
      h('button.btn.btn-sm', { onclick: () => addPrice() }, icon('plus', 15), 'Add another size')),
      'One price? Leave the size blank.'),
    field('Availability', f.status),
    toggle('Hide this item from the TV', hidden, v => { hidden = v; }),
    h('details.advanced', h('summary', 'Description, drink details & image'),
      field('Description', f.description),
      h('div.grid3', field('Tap number', f.tap), field('ABV %', f.abv), field('IBU', f.ibu)),
      field('Style', f.style),
      h('div.grid2', field('Producer', f.producer), field('Origin', f.origin)),
      field('Badge', f.badge), field('Image', imageBtn),
      field('Colour', h('div.color-row', colorPicker, clearColor))));

  const payload = () => ({
    name: f.name.value.trim(),
    tap: f.tap.value.trim(),
    style: f.style.value.trim(),
    producer: f.producer.value.trim(),
    origin: f.origin.value.trim(),
    abv: f.abv.value.trim() === '' ? null : f.abv.value.trim(),
    ibu: f.ibu.value.trim() === '' ? null : f.ibu.value.trim(),
    badge: f.badge.value.trim(),
    description: f.description.value.trim(),
    status: f.status.value,
    color: color || null,
    image: image || null,
    hidden,
    prices: priceRows.map(r => ({ label: r.lbl.value.trim(), amount: r.amt.value.trim() }))
  });

  const editor = sheet({
    title: isNew ? 'Add item' : 'Edit item',
    body,
    saveLabel: isNew ? 'Add item' : 'Save item',
    extra: isNew ? null : h('button.btn.btn-danger.btn-sm', {
      onclick: async () => {
        const ok = await confirmSheet('Delete item?', `"${data.name}" will be removed from the menu.`);
        if (ok && await mutate(() => api.del('/api/items/' + data.id), 'Item deleted')) editor.close();
      }
    }, 'Delete'),
    onSave: () => {
      const body = payload();
      if (!body.name) { toast('Give the item a name', true); return false; }
      return mutate(
        () => isNew
          ? api.post(`/api/sections/${section.id}/items`, body)
          : api.patch('/api/items/' + data.id, body),
        isNew ? 'Item added' : 'Saved');
    }
  });
}

// ------------------------------------------------------------------ boards

export function createBoard() {
  const name = input({ placeholder: 'e.g. Drinks menu' });
  const sectionName = input({ value: 'On the menu', placeholder: 'e.g. On draft, Food, or Cocktails' });
  sheet({ title: 'Create a menu', saveLabel: 'Create menu',
    body: h('div', field('Menu name', name), field('First section', sectionName, 'A group of items. You can add more sections later.')),
    onSave: async () => {
      if (!name.value.trim()) { toast('Give your menu a name.', true); return false; }
      let made;
      const ok = await mutate(async () => {
        const result = await api.post('/api/boards', { name: name.value.trim(), layout: 'grid', sectionName: sectionName.value.trim() || 'On the menu' });
        made = result.board;
      }, 'Menu created. Add your first item.');
      if (ok) navigate('menu', made.id);
      return ok;
    }
  });
}

function editBoard(board) {
  const name = h('input.input', { value: board.name });
  const slug = h('input.input', { value: board.slug });
  const ticker = h('input.input', { value: board.ticker || '', placeholder: 'Happy hour 4–6pm daily' });

  const editor = sheet({
    title: 'Name & scrolling message',
    body: h('div',
      field('Name', name),
      h('details.advanced', h('summary', 'Direct display link'), field('Address ending', slug, `Display address: ${location.origin}/d/${board.slug}`)),
      field('Ticker', ticker, 'Scrolling line along the bottom of the screen.')),
    extra: (store.state.boards || []).length > 1
      ? h('button.btn.btn-danger.btn-sm', {
          onclick: async () => {
            const ok = await confirmSheet('Delete board?', `"${board.name}" and everything on it will be removed.`);
            if (ok && await mutate(() => api.del('/api/boards/' + board.id), 'Deleted')) { editor.close(); clearDirty(); navigate(board.layout === 'poster' ? 'posters' : 'menus'); }
          }
        }, 'Delete')
      : null,
    onSave: () => mutate(
      () => api.patch('/api/boards/' + board.id,
        { name: name.value.trim(), slug: slug.value.trim(), ticker: ticker.value }),
      'Board saved')
  });
}
