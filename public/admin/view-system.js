import {
  h, api, store, mutate, sheet, confirmSheet, field, input, select, toast, uploadImage, refreshState, markDirty, clearDirty, emit
} from './core.js';
import { navigate } from './navigation.js';
import { tvCard, pageHeading } from './view-home.js';
import { icon } from './icons.js';

// ================================================================== screens

export function renderScreens() {
  const devices = store.state.devices || [];
  const boards = store.state.boards || [];

  const advanced = h('details.advanced', h('summary', 'Advanced TV controls & saved rotations'),
    rotationsCard(),
    ...devices.map(d => deviceRow(d, boards)),
    h('button.btn.btn-block', { onclick: () => mutate(() => api.post('/api/devices/command', { action: 'reload' }), 'Reload sent') }, 'Reload all TVs'),
    h('h3', 'Direct display links'),
    ...boards.map(b => h('p.hint', h('a', { href: '/d/' + b.slug, target: '_blank', rel: 'noopener' }, b.name))));
  return h('div',
    pageHeading('Your TVs', 'Choose what plays on each TV. Select several menus or posters to play them in a loop.'),
    devices.length ? h('div.tv-grid', ...devices.map(tvCard)) : h('p.hint', 'No TVs yet. Start with the pairing code on your TV.'),
    h('details.advanced', { open: !!store.pairCode || !devices.length }, h('summary', 'Pair a new TV'),
      h('p.hint', store.pairCode ? 'Code scanned. Name this TV and choose its first menu or poster.' : 'Open ' + location.host + '/display on your TV. Scan its QR code or enter the six-character code below.'),
      pairForm(boards)), advanced);
}

// ---------------------------------------------------------------- rotations

/** One flat option list covering both single boards and rotations. */
function targetOptions() {
  const opts = [['', '— nothing yet —']];
  for (const b of store.state.boards || []) {
    opts.push(['b:' + b.id, (b.layout === 'poster' ? 'Poster · ' : 'Menu · ') + b.name]);
  }
  for (const p of store.state.playlists || []) {
    opts.push(['p:' + p.id, 'Rotation · ' + p.name]);
  }
  return opts;
}

function targetValue(device) {
  if (device && device.playlist_id) return 'p:' + device.playlist_id;
  if (device && device.board_id) return 'b:' + device.board_id;
  return '';
}

function targetPayload(value) {
  if (value.startsWith('p:')) return { playlist_id: value.slice(2), board_id: null };
  if (value.startsWith('b:')) return { board_id: value.slice(2), playlist_id: null };
  return { board_id: null, playlist_id: null };
}

function describeTarget(device) {
  if (device.playlist_id) {
    const p = (store.state.playlists || []).find(x => x.id === device.playlist_id);
    return p ? `Rotation: ${p.name} (${totalTime(p)})` : 'Rotation (missing)';
  }
  if (device.board_id) {
    const b = (store.state.boards || []).find(x => x.id === device.board_id);
    return b ? b.name : 'Board (missing)';
  }
  return 'Not assigned';
}

function totalTime(playlist) {
  const secs = (playlist.items || []).reduce((n, i) => n + (i.seconds || 0), 0);
  return formatSecs(secs);
}

function formatSecs(secs) {
  if (secs < 60) return secs + 's';
  const m = Math.floor(secs / 60);
  const r = secs % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

function rotationsCard() {
  const playlists = store.state.playlists || [];
  return h('div',
    h('div.section-title', 'Rotations'),
    h('div.card',
      playlists.length
        ? h('div.card-body.tight', ...playlists.map(p => h('div.item',
            h('div.item-main', { onclick: () => editRotation(p) },
              h('div.item-name', p.name),
              h('div.item-sub',
                `${(p.items || []).length} scene(s) · ${totalTime(p)} per loop`)),
            h('button.btn.btn-ghost.btn-sm', { onclick: () => editRotation(p) }, 'Edit'))))
        : h('div.empty',
            h('p', 'A rotation cycles through boards — menu for two minutes, then an event poster, then back.')),
      h('div.card-body',
        h('button.btn.btn-block.btn-sm', { onclick: newRotation },
          icon('plus', 17), 'New rotation'))));
}

function newRotation() {
  const name = h('input.input', { placeholder: 'e.g. Evening loop' });
  sheet({
    title: 'New rotation',
    body: h('div', field('Name', name)),
    saveLabel: 'Create',
    onSave: () => mutate(
      () => api.post('/api/playlists', { name: name.value.trim() || 'New rotation' }),
      'Rotation created')
  });
}

function editRotation(playlist) {
  const boards = store.state.boards || [];
  const items = playlist.items || [];

  const list = items.length
    ? h('div', ...items.map((item, i) => sceneRow(playlist, item, i, items.length)))
    : h('p.hint', 'No scenes yet. Add the first one below.');

  const addBoard = select(boards[0] ? boards[0].id : '',
    boards.map(b => [b.id, (b.layout === 'poster' ? 'Poster · ' : 'Menu · ') + b.name]));
  const addSecs = h('input.input', { type: 'number', value: '120', min: '5', max: '3600' });
  const name = h('input.input', { value: playlist.name });

  sheet({
    title: 'Rotation',
    body: h('div',
      field('Name', name),

      h('div.section-title', { style: { marginTop: '10px' } }, 'Scenes'),
      list,

      h('div.section-title', 'Add a scene'),
      h('div.price-row',
        h('div', { style: { flex: '1 1 60%' } }, addBoard),
        h('div', { style: { flex: '1 1 25%' } }, addSecs),
        h('button.btn.btn-sm.btn-primary', {
          onclick: () => {
            if (!addBoard.value) return toast('Create a board first', true);
            mutate(() => api.post(`/api/playlists/${playlist.id}/items`,
              { board_id: addBoard.value, seconds: Number(addSecs.value) || 120 }), 'Scene added');
          }
        }, 'Add')),
      h('div.hint',
        'Seconds each scene stays up. A long menu keeps flipping its own pages within its slot.'),

      h('div.hint', { style: { marginTop: '12px' } },
        `Direct link: ${location.origin}/p/${playlist.slug}`)),

    extra: h('button.btn.btn-danger.btn-sm', {
      onclick: async () => {
        const ok = await confirmSheet('Delete rotation?',
          `"${playlist.name}" will be removed. The boards in it are not deleted.`);
        if (ok) mutate(() => api.del('/api/playlists/' + playlist.id), 'Rotation deleted');
      }
    }, 'Delete'),

    onSave: () => mutate(
      () => api.patch('/api/playlists/' + playlist.id, { name: name.value.trim() }),
      'Rotation saved')
  });
}

function sceneRow(playlist, item, index, total) {
  const move = (dir) => {
    const ids = (playlist.items || []).map(i => i.id);
    const to = index + dir;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    mutate(() => api.post('/api/reorder', { kind: 'scenes', parentId: playlist.id, ids }));
  };

  const secs = h('input.input', {
    type: 'number', value: item.seconds, min: '5', max: '3600',
    style: { minHeight: '38px' },
    onchange: (e) => mutate(
      () => api.patch('/api/scenes/' + item.id, { seconds: Number(e.target.value) }))
  });

  return h('div.item', { style: { paddingLeft: '0', paddingRight: '0' } },
    h('div.item-grab',
      h('button', { onclick: () => move(-1), disabled: index === 0, 'aria-label': 'Move up' },
        icon('chevronUp', 14)),
      h('button', { onclick: () => move(1), disabled: index === total - 1, 'aria-label': 'Move down' },
        icon('chevronDown', 14))),
    h('div.item-main',
      h('div.item-name', item.board_name),
      h('div.item-sub', item.board_layout === 'poster' ? 'Poster' : 'Menu board')),
    h('div', { style: { width: '84px' } }, secs),
    h('button.btn.btn-sm.btn-danger', {
      'aria-label': 'Remove scene',
      onclick: () => mutate(() => api.del('/api/scenes/' + item.id), 'Scene removed')
    }, icon('x', 15)));
}

function pairForm(boards) {
  const code = h('input.input.code-box', {
    placeholder: '······', maxlength: '6', autocapitalize: 'characters', autocomplete: 'off',
    value: store.pairCode || ''
  });
  // Default to the first board so a scanned screen is one tap from live.
  const boardSel = select(boards[0] ? 'b:' + boards[0].id : '', targetOptions());
  const name = h('input.input', { placeholder: 'e.g. Behind the bar' });

  return h('div',
    field('Code', code),
    field('Show', boardSel),
    field('Screen name', name),
    h('button.btn.btn-primary.btn-block', {
      onclick: async () => {
        const value = code.value.trim().toUpperCase();
        if (value.length !== 6) return toast('Enter the 6-character code', true);
        const ok = await mutate(
          () => api.post('/api/devices/claim',
            { code: value, ...targetPayload(boardSel.value), name: name.value.trim() || 'Screen' }),
          'Screen paired');
        if (ok) { code.value = ''; name.value = ''; store.pairCode = null; }
      }
    }, 'Pair screen'));
}

function deviceRow(device, boards) {
  const seen = device.last_seen ? timeAgo(device.last_seen) : 'never';
  const online = device.last_seen && Date.now() - device.last_seen < 90000;

  return h('div.item',
    h('span.swatch', { style: { background: online ? 'var(--ok)' : 'var(--line)' } }),
    h('div.item-main',
      h('div.item-name', device.name || 'Unnamed screen'),
      h('div.item-sub', describeTarget(device) + ' · seen ' + seen)),
    h('button.btn.btn-ghost.btn-sm', { onclick: () => editDevice(device, boards) }, 'Edit'));
}

function editDevice(device, boards) {
  const name = h('input.input', { value: device.name || '' });
  const boardSel = select(targetValue(device), targetOptions());

  sheet({
    title: 'Screen',
    body: h('div',
      field('Name', name),
      field('Show', boardSel, 'A single board, or a rotation that cycles through several.'),
      h('div.row-btns',
        h('button.btn.btn-sm', {
          onclick: () => mutate(() => api.post('/api/devices/command',
            { action: 'identify', deviceId: device.id }), 'Identifying')
        }, icon('monitor', 15), 'Identify'),
        h('button.btn.btn-sm', {
          onclick: () => mutate(() => api.post('/api/devices/command',
            { action: 'reload', deviceId: device.id }), 'Reloading')
        }, icon('refresh', 15), 'Reload'))),
    extra: h('button.btn.btn-danger.btn-sm', {
      onclick: async () => {
        const ok = await confirmSheet('Unpair screen?',
          'The TV will show a new pairing code next time it loads.');
        if (ok) mutate(() => api.del('/api/devices/' + device.id), 'Screen removed');
      }
    }, 'Unpair'),
    onSave: () => mutate(
      () => api.patch('/api/devices/' + device.id,
        { name: name.value.trim(), ...targetPayload(boardSel.value) }),
      'Screen saved')
  });
}

function timeAgo(ts) {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 60) return 'just now';
  if (secs < 3600) return Math.round(secs / 60) + 'm ago';
  if (secs < 86400) return Math.round(secs / 3600) + 'h ago';
  return Math.round(secs / 86400) + 'd ago';
}

// ================================================================= settings

export function renderSettings() {
  const s = store.state.settings || {};
  let logo = s.logo || null;
  const venue = input({ value: s.venue_name || '' });
  const tagline = input({ value: s.tagline || '' });
  const currency = input({ value: s.currency || '$', maxlength: 3 });
  const logoPreview = h('div.poster-upload-preview');
  const draw = () => logoPreview.replaceChildren(logo ? h('img', { src: '/u/' + logo, alt: 'Venue logo' }) : h('p', 'No logo added yet'));
  draw();
  const upload = h('button.btn', { onclick: async () => {
    upload.disabled = true;
    try { const id = await uploadImage({ maxSize: 512 }); if (id) { logo = id; draw(); markDirty(); } }
    catch (err) { toast(err.message, true); }
    finally { upload.disabled = false; }
  } }, 'Choose logo');
  const save = h('button.btn.btn-primary', { onclick: async () => {
    if (!venue.value.trim()) return toast('Enter your venue name.', true);
    save.disabled = true;
    try {
      if (await mutate(() => api.post('/api/settings', { venue_name: venue.value.trim(), tagline: tagline.value.trim(), currency: currency.value.trim() || '$', logo }), 'Venue details saved')) { clearDirty(); emit(); }
    } finally { save.disabled = false; }
  } }, 'Save venue details');
  return h('div', { oninput: markDirty, onchange: markDirty },
    h('button.back-link', { onclick: () => navigate('screens') }, 'Back to TVs'),
    pageHeading('Venue details', 'Your name, logo, and currency appear across your menus.'),
    h('div.save-bar.appearance-save', h('span.hint', 'These details apply to all TVs.'), save),
    h('div.card', h('div.card-body', field('Venue name', venue), field('Tagline', tagline, 'A short line below your venue name.'), field('Currency symbol', currency),
      logoPreview, h('div.row-btns', upload, h('button.btn', { onclick: () => { logo = null; draw(); markDirty(); } }, 'Remove logo')))),
    h('details.advanced', h('summary', 'App tools & backups'),
      h('div.row-btns', h('button.btn', { onclick: downloadBackup }, 'Download backup'), h('button.btn', { onclick: importBackup }, 'Restore backup')),
      h('p.hint', 'Backups include menus, poster artwork, uploaded images, rotations, venue settings and TV assignments. Server password and port stay unchanged.'),
      h('details.advanced', h('summary', 'Saved rotations'), rotationsCard()),
      h('button.btn', { onclick: async () => { if (document.querySelector('.shell[data-dirty=true]') && !confirm('Discard unsaved venue details and sign out?')) return; clearDirty(); await api.post('/api/auth/logout'); location.reload(); } }, 'Sign out')));
}

async function downloadBackup(event) {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const response = await fetch('/api/export', { cache: 'no-store' });
    if (!response.ok) throw new Error((await response.json()).error || 'Could not create backup.');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: `taproom-backup-${new Date().toISOString().slice(0,10)}.json` });
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast('Backup downloaded, including images.');
  } catch (err) { toast(err.message, true); }
  finally { button.disabled = false; }
}

function importBackup() {
  let data = null, preview = null;
  const picker = input({ type: 'file', accept: 'application/json,.json' });
  const mode = select('append', [['append', 'Add content to this server'], ['replace', 'Replace this server with the backup']]);
  const review = h('div', { 'aria-live': 'polite' });
  const confirm = h('input', { type: 'checkbox' });
  const confirmation = h('label.toggle', { hidden: true }, confirm, h('span.track'), h('span.lbl', 'Replace current menus, settings and TV assignments with this backup'));
  const reset = () => { preview = null; review.replaceChildren(); confirm.checked = false; confirmation.hidden = true; save.textContent = 'Review backup'; };
  const modal = sheet({
    title: 'Restore backup', saveLabel: 'Review backup',
    body: h('div', h('p.hint', 'Download a backup of this server first. Choose a file and review it before restoring. Password and port do not change. TVs using a different server address must be pointed here.'),
      field('Backup file', picker, 'Up to 128 MB, with up to 64 MB of images.'), field('Restore mode', mode), review, confirmation),
    onSave: async () => {
      if (!data) { toast('Choose a backup file first.', true); return false; }
      picker.disabled = mode.disabled = true;
      try {
        if (!preview) {
          preview = await api.post('/api/import', { ...data, mode: mode.value, replace: mode.value === 'replace', preview: true });
          review.replaceChildren(h('p', `${preview.menus} menus, ${preview.posters} posters, ${preview.items} items, ${preview.images} images, ${preview.rotations} rotations and ${preview.tvs} TV assignments.`),
            ...(preview.warnings || []).map(message => h('p.hint', message)));
          confirmation.hidden = mode.value !== 'replace';
          save.textContent = 'Restore now';
          return false;
        }
        if (mode.value === 'replace' && !confirm.checked) { toast('Confirm that you want to replace this server from the backup.', true); return false; }
        await api.post('/api/import', { ...data, mode: mode.value, replace: mode.value === 'replace', preview: false, expectedRevision: preview.revision });
        modal.close(); clearDirty();
        await mutate(async () => {}, 'Backup restored');
      } catch (err) { reset(); toast(err.message || 'Restore failed. No partial restore was saved.', true); }
      finally { picker.disabled = mode.disabled = false; }
      return false;
    }
  });
  const save = modal.el.querySelector('.sheet-foot .btn-primary');
  mode.addEventListener('change', reset);
  picker.addEventListener('change', async () => {
    reset(); data = null;
    const file = picker.files?.[0];
    if (!file) return;
    try {
      if (file.size > 128 * 1024 * 1024) throw new Error('Choose a backup smaller than 128 MB.');
      data = JSON.parse(await file.text());
      if (!data || ![1,2].includes(data.version) || !Array.isArray(data.boards)) throw new Error('Not a supported Taproom backup.');
      review.replaceChildren(h('p.hint', `${file.name} selected. Review the backup to continue.`));
    } catch (err) { data = null; toast(err.message || 'Could not read that file.', true); }
  });
}
