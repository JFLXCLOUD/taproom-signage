import {
  h, api, store, currentBoard, mutate, sheet, confirmSheet,
  field, input, select, toggle, toast, uploadImage, emit
} from './core.js';
import { icon } from './icons.js';
import { SECTION_KINDS, STATUSES } from '../shared/theme.js';

const STATUS_ORDER = ['on', 'low', 'off', 'soon'];

export function renderMenu() {
  const board = currentBoard();
  if (board && board.layout === 'poster') return renderPoster(board);
  if (!board) {
    return h('div.empty',
      h('p', 'No boards yet. A board is one screen layout — draft list, food menu, whatever.'),
      h('button.btn.btn-primary', { onclick: createBoard }, 'Create your first board'));
  }

  return h('div',
    boardBar(board),
    ...(board.sections || []).map(section => sectionCard(board, section)),
    h('button.btn.btn-block', { style: { marginTop: '14px' }, onclick: () => addSection(board) },
      icon('plus', 17), 'Add section'),
    h('div.section-title', 'Board'),
    h('div.row-btns',
      h('button.btn.btn-sm', { onclick: () => editBoard(board) },
        icon('pencil', 15), 'Board settings'),
      h('button.btn.btn-sm', { onclick: () => window.open('/d/' + board.slug, '_blank') },
        icon('external', 15), 'Open display'),
      h('button.btn.btn-sm', { onclick: createBoard }, icon('plus', 15), 'New board')));
}

// ------------------------------------------------------------------ posters

function renderPoster(board) {
  const c = board.content || {};
  const save = (patch, msg) =>
    mutate(() => api.patch('/api/boards/' + board.id, { content: patch }), msg);

  const eyebrow = h('input.input', { value: c.eyebrow || '', placeholder: 'THIS FRIDAY' });
  const headline = h('textarea.input', { placeholder: 'Live Music', style: { minHeight: '68px' } });
  const subhead = h('input.input', { value: c.subhead || '', placeholder: '9pm · No cover' });
  const body = h('textarea.input', { placeholder: 'Optional detail' });
  headline.value = c.headline || '';
  body.value = c.body || '';

  const artwork = h('div', { style: { marginBottom: '10px' } },
    c.image
      ? h('img', { src: '/u/' + c.image, alt: '',
          style: { width: '100%', borderRadius: '10px', display: 'block' } })
      : h('span.hint', 'No artwork — the poster uses your theme background.'));

  return h('div',
    boardBar(board),

    h('div.card',
      h('div.card-head', h('h2', board.name), h('span.status-pill.status-soon', 'Poster')),
      h('div.card-body',
        field('Artwork', h('div', artwork,
          h('div.row-btns',
            h('button.btn.btn-sm', {
              onclick: async () => {
                try {
                  // Posters go full-screen, so keep more pixels than a thumbnail.
                  const id = await uploadImage({ maxSize: 1920, quality: 0.85 });
                  if (id) await save({ image: id }, 'Artwork updated');
                } catch (err) { toast(err.message, true); }
              }
            }, icon('upload', 15), c.image ? 'Replace artwork' : 'Upload artwork'),
            c.image
              ? h('button.btn.btn-sm.btn-danger', { onclick: () => save({ image: null }, 'Artwork removed') },
                  icon('trash', 15), 'Remove')
              : null))),

        field('Eyebrow', eyebrow),
        field('Headline', headline),
        field('Sub-headline', subhead),
        field('Body', body),

        h('button.btn.btn-primary.btn-block', {
          onclick: () => save({
            eyebrow: eyebrow.value.trim(),
            headline: headline.value.trim(),
            subhead: subhead.value.trim(),
            body: body.value.trim()
          }, 'Poster saved')
        }, 'Save text'))),

    h('div.card',
      h('div.card-head', h('h2', 'Placement')),
      h('div.card-body',
        field('Text position', select(c.align || 'center',
          [['center', 'Centred'], ['top', 'Top left'], ['bottom', 'Bottom left']],
          { onchange: (e) => save({ align: e.target.value }) })),
        field('Artwork fit', select(c.fit || 'cover',
          [['cover', 'Fill the screen (may crop)'], ['contain', 'Fit inside (may letterbox)']],
          { onchange: (e) => save({ fit: e.target.value }) })),
        darkenSlider(c, save),
        toggle('Show venue logo', c.showLogo !== false, v => save({ showLogo: v })))),

    h('div.section-title', 'Board'),
    h('div.row-btns',
      h('button.btn.btn-sm', { onclick: () => editBoard(board) },
        icon('pencil', 15), 'Board settings'),
      h('button.btn.btn-sm', { onclick: () => window.open('/d/' + board.slug, '_blank') },
        icon('external', 15), 'Open display'),
      h('button.btn.btn-sm', { onclick: createBoard }, icon('plus', 15), 'New board')));
}

function darkenSlider(c, save) {
  const current = c.overlay == null ? (c.image ? 0.45 : 0) : c.overlay;
  const out = h('span', { style: { color: 'var(--muted)', float: 'right' } },
    Math.round(current * 100) + '%');
  let timer = null;
  const range = h('input', {
    type: 'range', min: 0, max: 0.9, step: 0.05, value: current,
    oninput: (e) => {
      const v = Number(e.target.value);
      out.textContent = Math.round(v * 100) + '%';
      clearTimeout(timer);
      timer = setTimeout(() => save({ overlay: v }), 400);
    }
  });
  return h('div.field', h('label', 'Darken artwork', out), range,
    h('div.hint', 'Raise this until the headline is readable over the photo.'));
}

function boardBar(board) {
  const boards = store.state.boards || [];
  if (boards.length < 2) return null;
  return h('div.field', { style: { marginTop: '14px' } },
    select(board.id, boards.map(b => [b.id, b.name]), {
      onchange: (e) => { store.boardId = e.target.value; emit(); }
    }));
}

// ------------------------------------------------------------------ sections

function sectionCard(board, section) {
  const items = section.items || [];
  return h('div.card',
    h('div.card-head',
      h('h2', section.name || 'Untitled'),
      section.hidden ? h('span.status-pill.status-off', 'Hidden') : null,
      h('button.btn.btn-ghost.btn-sm', { onclick: () => editSection(board, section) }, 'Edit')),
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

  sheet({
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
        if (ok) mutate(() => api.del('/api/sections/' + section.id), 'Section deleted');
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

  return h('div.item' + (item.status === 'off' || item.hidden ? '.is-off' : ''),
    h('span.swatch', { style: item.color ? { background: item.color } : null }),
    h('div.item-grab',
      h('button', { onclick: () => move(-1), disabled: index === 0, 'aria-label': 'Move up' },
        icon('chevronUp', 14)),
      h('button', { onclick: () => move(1), disabled: index === total - 1, 'aria-label': 'Move down' },
        icon('chevronDown', 14))),
    item.tap ? h('span.item-tap', item.tap) : null,
    h('div.item-main', { onclick: () => editItem(section, item) },
      h('div.item-name', item.name || 'Untitled'),
      sub ? h('div.item-sub', sub) : null),
    price ? h('span.item-price', formatAmount(price.amount)) : null,
    statusPill(item));
}

function formatAmount(amount) {
  const raw = String(amount ?? '').trim();
  if (!raw) return '';
  const currency = store.state.settings?.currency || '$';
  return /^\d+(\.\d+)?$/.test(raw) ? currency + raw : raw;
}

/** One tap cycles Pouring → Low → Kicked → Coming soon. The nightly workhorse. */
function statusPill(item) {
  const status = item.status || 'on';
  const label = (STATUSES[status] || {}).label || status;
  return h('button.status-pill.status-' + status, {
    onclick: () => {
      const next = STATUS_ORDER[(STATUS_ORDER.indexOf(status) + 1) % STATUS_ORDER.length];
      mutate(() => api.patch('/api/items/' + item.id, { status: next }));
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
    status: select(data.status || 'on', Object.entries(STATUSES).map(([k, v]) => [k, v.label]))
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
    const lbl = h('input.input.lbl', { value: p.label || '', placeholder: 'Size, e.g. 16 oz' });
    const amt = h('input.input.amt', { value: p.amount || '', placeholder: '8', inputmode: 'decimal' });
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
    field('Name', f.name),
    h('div.grid3', field('Tap #', f.tap), field('ABV %', f.abv), field('IBU', f.ibu)),
    field('Style', f.style),
    h('div.grid2', field('Producer', f.producer), field('Origin', f.origin)),
    field('Prices', h('div', pricesBox,
      h('button.btn.btn-sm', { onclick: () => addPrice() }, icon('plus', 15), 'Add size')),
      'Leave the size blank for a single unlabelled price. Non-numeric values ("MKT") show as typed.'),
    h('div.grid2', field('Status', f.status), field('Badge', f.badge)),
    field('Colour', h('div.color-row', colorPicker, clearColor),
      'Tints the bar beside the item — handy for matching beer colour.'),
    field('Image', imageBtn, 'Only shown when "Item images" is enabled in Design.'),
    field('Description', f.description),
    toggle('Hide from display', hidden, v => { hidden = v; }));

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

  sheet({
    title: isNew ? 'Add item' : 'Edit item',
    body,
    saveLabel: isNew ? 'Add' : 'Save',
    extra: isNew ? null : h('button.btn.btn-danger.btn-sm', {
      onclick: async () => {
        const ok = await confirmSheet('Delete item?', `"${data.name}" will be removed from the menu.`);
        if (ok) mutate(() => api.del('/api/items/' + data.id), 'Item deleted');
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

function createBoard() {
  const name = h('input.input', { placeholder: 'e.g. Food Menu' });
  const layout = select('grid', [
    ['grid', 'Menu board — sections and items'],
    ['poster', 'Poster — artwork and a headline']
  ]);
  sheet({
    title: 'New board',
    body: h('div',
      field('Name', name),
      field('Type', layout,
        'Both kinds can be shown on a screen directly, or dropped into a rotation.')),
    saveLabel: 'Create',
    onSave: async () => {
      const res = await mutate(
        () => api.post('/api/boards', {
          name: name.value.trim() || 'New board',
          layout: layout.value,
          skipDefaultSection: layout.value === 'poster'
        }), 'Board created');
      if (res) {
        const made = store.state.boards[store.state.boards.length - 1];
        if (made) { store.boardId = made.id; emit(); }
      }
      return res;
    }
  });
}

function editBoard(board) {
  const name = h('input.input', { value: board.name });
  const slug = h('input.input', { value: board.slug });
  const ticker = h('input.input', { value: board.ticker || '', placeholder: 'Happy hour 4–6pm daily' });

  sheet({
    title: 'Board settings',
    body: h('div',
      field('Name', name),
      field('URL slug', slug, `Display address: ${location.origin}/d/${board.slug}`),
      field('Ticker', ticker, 'Scrolling line along the bottom of the screen.')),
    extra: (store.state.boards || []).length > 1
      ? h('button.btn.btn-danger.btn-sm', {
          onclick: async () => {
            const ok = await confirmSheet('Delete board?', `"${board.name}" and everything on it will be removed.`);
            if (ok) mutate(() => api.del('/api/boards/' + board.id), 'Board deleted');
          }
        }, 'Delete')
      : null,
    onSave: () => mutate(
      () => api.patch('/api/boards/' + board.id,
        { name: name.value.trim(), slug: slug.value.trim(), ticker: ticker.value }),
      'Board saved')
  });
}
