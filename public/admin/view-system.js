import {
  h, api, store, mutate, sheet, confirmSheet, field, input, select, toast, uploadImage, refreshState
} from './core.js';

// ================================================================== screens

export function renderScreens() {
  const devices = store.state.devices || [];
  const boards = store.state.boards || [];

  return h('div',
    h('div.card',
      h('div.card-head', h('h2', 'Pair a screen')),
      h('div.card-body',
        h('p.hint', { style: { marginTop: '0' } },
          'On the TV, open ', h('strong', location.host + '/display'),
          ' in the browser. It will show a six-character code — type it here.'),
        pairForm(boards))),

    rotationsCard(),

    h('div.section-title', 'Paired screens'),
    devices.length
      ? h('div.card', h('div.card-body.tight', ...devices.map(d => deviceRow(d, boards))))
      : h('div.empty', h('p', 'No screens paired yet.')),

    devices.length
      ? h('button.btn.btn-block', { style: { marginTop: '12px' },
          onclick: () => mutate(() => api.post('/api/devices/command', { action: 'reload' }),
            'Reload sent to every screen') }, 'Reload all screens')
      : null,

    h('div.section-title', 'Direct links'),
    h('div.card', h('div.card-body',
      h('p.hint', { style: { marginTop: '0' } },
        'You can skip pairing and point a screen straight at a board:'),
      ...boards.map(b => h('div', { style: { marginBottom: '8px' } },
        h('strong', b.name), h('br'),
        h('code', { style: { color: 'var(--muted)', fontSize: '13px', wordBreak: 'break-all' } },
          `${location.origin}/d/${b.slug}`))),
      ...(store.state.playlists || []).map(p => h('div', { style: { marginBottom: '8px' } },
        h('strong', p.name + ' (rotation)'), h('br'),
        h('code', { style: { color: 'var(--muted)', fontSize: '13px', wordBreak: 'break-all' } },
          `${location.origin}/p/${p.slug}`))))));
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
        h('button.btn.btn-block.btn-sm', { onclick: newRotation }, '+ New rotation'))));
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
      h('button', { onclick: () => move(-1), disabled: index === 0 }, '▲'),
      h('button', { onclick: () => move(1), disabled: index === total - 1 }, '▼')),
    h('div.item-main',
      h('div.item-name', item.board_name),
      h('div.item-sub', item.board_layout === 'poster' ? 'Poster' : 'Menu board')),
    h('div', { style: { width: '84px' } }, secs),
    h('button.btn.btn-sm.btn-danger', {
      onclick: () => mutate(() => api.del('/api/scenes/' + item.id), 'Scene removed')
    }, '✕'));
}

function pairForm(boards) {
  const code = h('input.input.code-box', {
    placeholder: '······', maxlength: '6', autocapitalize: 'characters', autocomplete: 'off'
  });
  const boardSel = select('', targetOptions());
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
        if (ok) { code.value = ''; name.value = ''; }
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
        }, 'Identify'),
        h('button.btn.btn-sm', {
          onclick: () => mutate(() => api.post('/api/devices/command',
            { action: 'reload', deviceId: device.id }), 'Reloading')
        }, 'Reload'))),
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

  const venue = h('input.input', { value: s.venue_name || '' });
  const tagline = h('input.input', { value: s.tagline || '' });
  const currency = h('input.input', { value: s.currency || '$', maxlength: '3' });

  const logoPreview = h('div', { style: { marginBottom: '10px' } },
    s.logo
      ? h('img', { src: '/u/' + s.logo, alt: '',
          style: { maxHeight: '64px', maxWidth: '100%', background: '#fff2', borderRadius: '8px', padding: '6px' } })
      : h('span.hint', 'No logo set'));

  return h('div',
    store.defaultPassword
      ? h('div.banner',
          h('strong', 'Default password in use. '),
          'Set ADMIN_PASSWORD in your environment (or docker-compose.yml) and restart before exposing this outside your LAN.')
      : null,

    h('div.card',
      h('div.card-head', h('h2', 'Venue')),
      h('div.card-body',
        field('Name', venue),
        field('Tagline', tagline),
        field('Currency symbol', currency),
        field('Logo', h('div', logoPreview,
          h('div.row-btns',
            h('button.btn.btn-sm', {
              onclick: async () => {
                try {
                  const id = await uploadImage({ maxSize: 512 });
                  if (id) await mutate(() => api.post('/api/settings', { logo: id }), 'Logo updated');
                } catch (err) { toast(err.message, true); }
              }
            }, s.logo ? 'Replace logo' : 'Upload logo'),
            s.logo
              ? h('button.btn.btn-sm.btn-danger', {
                  onclick: () => mutate(() => api.post('/api/settings', { logo: null }), 'Logo removed')
                }, 'Remove')
              : null)),
          'A wide PNG with a transparent background works best.'),
        h('button.btn.btn-primary.btn-block', {
          onclick: () => mutate(() => api.post('/api/settings', {
            venue_name: venue.value.trim(),
            tagline: tagline.value.trim(),
            currency: currency.value.trim() || '$'
          }), 'Saved')
        }, 'Save venue details'))),

    h('div.card',
      h('div.card-head', h('h2', 'Backup')),
      h('div.card-body',
        h('div.row-btns',
          h('a.btn.btn-sm', { href: '/api/export', download: '' }, 'Download backup'),
          h('button.btn.btn-sm', { onclick: importBackup }, 'Restore from file')),
        h('div.hint', 'The backup holds every board, section, item and price as JSON. Images are not included.'))),

    h('div.card',
      h('div.card-head', h('h2', 'Running it on a Fire TV Stick')),
      h('div.card-body',
        h('ol', { style: { margin: '0', paddingLeft: '20px', color: 'var(--muted)', lineHeight: '1.6' } },
          h('li', 'Install a browser on the stick — Amazon Silk works, Fully Kiosk Browser is better.'),
          h('li', h('span', 'Open '), h('strong', location.host + '/display'), ' and pair the code.'),
          h('li', 'Settings → Display & Sounds → Screensaver → set Start After to Never.'),
          h('li', 'In Fully Kiosk, enable Keep Screen On and Start on Boot so it survives a power cut.')),
        h('div.hint', 'The board keeps showing its last menu even if this server goes offline.'))),

    h('button.btn.btn-block', { style: { marginTop: '16px' },
      onclick: async () => { await api.post('/api/auth/logout'); location.reload(); } }, 'Sign out'));
}

function importBackup() {
  const picker = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  let replace = false;

  const body = h('div',
    h('p.hint', { style: { marginTop: '0' } },
      'Choose a backup file. Boards are added to what you already have unless you replace everything.'),
    h('div', { style: { margin: '10px 0' } },
      h('label.toggle',
        h('input', { type: 'checkbox', onchange: (e) => { replace = e.target.checked; } }),
        h('span.track'),
        h('span.lbl', 'Delete existing boards first'))),
    h('button.btn.btn-block', { onclick: () => picker.click() }, 'Choose file…'),
    picker);

  const s = sheet({ title: 'Restore backup', body, saveLabel: null, onSave: null });

  picker.addEventListener('change', async () => {
    const file = picker.files && picker.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      data.replace = replace;
      await mutate(() => api.post('/api/import', data), 'Backup restored');
      s.close();
    } catch (err) {
      toast(err.message || 'That file could not be read', true);
    }
  });
}
