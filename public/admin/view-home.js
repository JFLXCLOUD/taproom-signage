import { h, clear, api, store, emit, field, input, select, sheet, toast, mutate, uploadImage } from './core.js';
import { icon } from './icons.js';
import { PRESETS, FONT_STACKS } from '../shared/theme.js';
import { expiryLabel } from '../shared/poster-expiry.js';

export function removalDateField(control, timeZone) {
  return field('Remove from TVs on (optional)', control,
    `Stops at midnight at the start of this date (${timeZone || store.state.timeZone || 'server time'}). Choose the day after your event. Leave blank to keep showing. The poster stays saved in Posters.`);
}

export { navigate } from './navigation.js';
import { navigate } from './navigation.js';

export function contentFor(device) {
  if (device.playlist_id) return (store.state.playlists || []).find(p => p.id === device.playlist_id)?.items || [];
  return device.board_id ? [{ board_id: device.board_id, seconds: 120 }] : [];
}

export function pageHeading(title, subtitle, action) {
  return h('div.page-heading', h('div', h('p.overline', 'YOUR VENUE, ON SCREEN'), h('h2', title), h('p', subtitle)), action);
}

export function tvCard(device) {
  const online = device.last_seen && Date.now() - device.last_seen < 90000;
  const items = contentFor(device);
  return h('article.tv-card',
    h('div.tv-card-top', icon('monitor', 24), h('h3', device.name || 'Unnamed TV'),
      h('span.connection' + (online ? '.online' : ''), online ? 'Connected' : 'Not connected')),
    h('p.overline', 'ASSIGNED CONTENT'),
    items.length ? h('ol.tv-lineup', ...items.map(item => {
      const b = store.state.boards.find(b => b.id === item.board_id);
      return h('li', h('span', b?.name || 'Missing content'), h('small', items.length > 1 ? `${item.seconds}s` : 'Continuous'));
    })) : h('p.hint', 'Choose a menu or poster to get started.'),
    !online ? h('p.hint', 'Changes will appear when this TV reconnects.') : null,
    h('button.btn.btn-block', { onclick: () => chooseContent(device) }, 'Choose content'));
}

export function renderHome() {
  const boards = store.state.boards || [];
  const devices = store.state.devices || [];
  return h('div',
    pageHeading('What’s on your TVs?', 'Update the menu, share an event, or choose what plays.'),
    h('div.quick-actions',
      h('button.quick-action.featured', { onclick: newPoster }, icon('image', 27), h('strong', 'Add event poster'), h('span', 'Upload artwork, pick TVs, and share.')),
      h('button.quick-action', { onclick: () => navigate('menu', boards.find(b => b.layout !== 'poster')?.id) }, icon('list', 27), h('strong', 'Update a menu'), h('span', 'Change items, prices, and availability.')),
      h('button.quick-action', { onclick: () => navigate('screens') }, icon('monitor', 27), h('strong', 'Manage TVs'), h('span', 'Pair a TV or change its content.'))),
    h('div.section-heading', h('h2', 'Your TVs'), h('span.hint', `${devices.length} registered`)),
    devices.length ? h('div.tv-grid', ...devices.map(tvCard)) : h('div.card.empty', h('p', 'Your first TV is a pairing code away.'),
      h('button.btn.btn-primary', { onclick: () => navigate('screens') }, 'Pair a TV')),
    h('div.section-heading', h('h2', 'Menus & posters'), h('button.btn.btn-sm', { onclick: newPoster }, icon('plus', 16), 'Add poster')),
    h('p.hint', 'Edit content here. Use Choose content on a TV to decide where it plays.'),
    h('div.library-grid', ...boards.map(b => h('article.library-card',
      h('div.library-art', { style: { background: PRESETS[b.theme?.preset]?.bg || '#17232a', color: PRESETS[b.theme?.preset]?.accent || '#e8b04b' } },
        b.content?.image ? h('img', { src: '/u/' + b.content.image, alt: b.name }) : icon(b.layout === 'poster' ? 'image' : 'list', 34)),
      h('div.library-info', h('small.overline', b.layout === 'poster' ? 'EVENT POSTER' : 'MENU'), h('h3', b.name),
        h('p.hint', assignedTo(b.id)),
        h('div.row-btns', h('button.btn.btn-sm', { onclick: () => navigate('menu', b.id) }, 'Edit'),
          h('button.btn.btn-sm.btn-ghost', { onclick: () => navigate('design', b.id) }, 'Choose theme')))))));
}

export function assignedTo(boardId) {
  const names = (store.state.devices || []).filter(d => contentFor(d).some(i => i.board_id === boardId)).map(d => d.name || 'Unnamed TV');
  return names.length ? 'Assigned to: ' + names.join(', ') : 'Saved only · not assigned to a TV';
}

export function showOnTV(board) {
  const selected = new Set();
  const devices = store.state.devices.filter(d => d.name || d.board_id || d.playlist_id);
  const mode = select('append', [['append', 'Add alongside what already plays'], ['replace', 'Show only this menu or poster']]);
  sheet({ title: 'Show ' + board.name + ' on TV', saveLabel: 'Update selected TVs',
    body: h('div', h('p', 'Choose the TVs to update.'),
      ...devices.map(d => h('label.content-choice', h('input', { type: 'checkbox', 'aria-label': d.name, onchange: e => e.target.checked ? selected.add(d.id) : selected.delete(d.id) }),
        icon('monitor', 20), h('span', h('strong', d.name), h('small', contentFor(d).some(i => i.board_id === board.id) ? 'Already showing this' : 'Add to this TV')))),
      !devices.length ? h('p.hint', 'Add a TV from the TVs page first.') : null,
      field('What should happen?', mode), h('p.hint', 'Only the TVs you check here will change. To remove content, open that TV and choose what plays.')),
    onSave: () => {
      if (!selected.size) { toast('Choose at least one TV.', true); return false; }
      return mutate(() => api.post('/api/publish', { deviceIds: [...selected], boardId: board.id, mode: mode.value, seconds: board.layout === 'poster' ? 20 : 120 }), 'Selected TVs updated');
    }
  });
}

export function chooseContent(device) {
  let selected = contentFor(device).map(i => ({ board_id: i.board_id, seconds: i.seconds }));
  const lineup = h('div');
  const choices = h('div.content-choices');
  const summary = h('p.workflow-note', { 'aria-live': 'polite' });
  const draw = () => {
    clear(lineup); clear(choices);
    summary.textContent = selected.length === 1 ? 'This item will stay on screen continuously.' : `${selected.length} items will play in this order, then repeat.`;
    selected.forEach((item, index) => {
      const board = store.state.boards.find(b => b.id === item.board_id);
      lineup.appendChild(h('div.lineup-edit', h('span.step-number', index + 1), h('strong', board?.name || 'Missing content'),
        selected.length > 1 ? field('Seconds', input({ type: 'number', min: 5, max: 3600, value: item.seconds,
          oninput: e => { item.seconds = Number(e.target.value); } })) : h('span.hint', 'Stays on screen'),
        h('button.btn.btn-sm', { 'aria-label': `Move ${board?.name} earlier`, disabled: index === 0, onclick: () => {
          [selected[index - 1], selected[index]] = [selected[index], selected[index - 1]]; draw();
        } }, icon('chevronUp', 16)),
        h('button.btn.btn-sm', { 'aria-label': `Remove ${board?.name}`, onclick: () => { selected.splice(index, 1); draw(); } }, icon('x', 16))));
    });
    store.state.boards.forEach(b => choices.appendChild(h('label.content-choice',
      h('input', { type: 'checkbox', 'aria-label': b.name, checked: selected.some(i => i.board_id === b.id), onchange: e => {
        if (e.target.checked) selected.push({ board_id: b.id, seconds: b.layout === 'poster' ? 20 : 120 });
        else selected = selected.filter(i => i.board_id !== b.id);
        draw();
      } }), icon(b.layout === 'poster' ? 'image' : 'list', 20), h('span', h('strong', b.name), h('small', expiryLabel(b) || (b.layout === 'poster' ? 'Poster' : 'Menu'))))));
  };
  draw();
  sheet({ title: `Choose content · ${device.name || 'TV'}`, saveLabel: 'Save to this TV',
    body: h('div', h('p.hint', 'Only this TV will change when you save.'), h('h3', '1. Choose menus & posters'), choices,
      h('h3', '2. Check the order & timing'), lineup, summary,
      h('p.hint', 'Menu items are managed inside each menu. Give a long menu enough time to show all its pages.')),
    onSave: () => {
      if (!selected.length) { toast('Select at least one menu or poster.', true); return false; }
      return mutate(() => api.post('/api/publish', { deviceIds: [device.id], items: selected }), 'Content saved to ' + (device.name || 'TV'));
    }
  });
}

export function newPoster(tvId) {
  let step = 0, imageId = null, uploading = false;
  const name = input({ placeholder: 'e.g. Friday live music' });
  const headline = input({ placeholder: 'e.g. Live music with The Locals' });
  const when = input({ placeholder: 'e.g. Friday, September 25 · 8 PM' });
  const details = input({ placeholder: 'e.g. Free entry · Kitchen open until 10' });
  const removeOn = input({ type: 'date' });
  const theme = select('midnight', Object.entries(PRESETS).map(([key, p]) => [key, p.label]));
  const mode = select('append', [['append', 'Add alongside current content'], ['replace', 'Show only this poster']]);
  const seconds = input({ type: 'number', min: 5, max: 3600, value: 20 });
  const selected = new Set(tvId ? [tvId] : []);
  const art = h('div.poster-upload-preview', icon('image', 38), h('span', 'Have a finished poster? Upload it here.'));
  const upload = h('button.btn.btn-block', { onclick: async () => {
    uploading = true; upload.disabled = true; upload.textContent = 'Opening image…';
    try {
      const id = await uploadImage({ maxSize: 1920, quality: 0.85 });
      if (id) { imageId = id; clear(art); art.appendChild(h('img', { src: '/u/' + id, alt: 'Selected poster artwork' })); }
    } catch (err) { toast(err.message, true); }
    finally { uploading = false; upload.disabled = false; upload.textContent = imageId ? 'Replace artwork' : 'Upload artwork'; }
  } }, 'Upload artwork');
  const panels = [
    h('div', field('Poster name', name, 'A name to help you find it in the app.'), art, upload,
      h('p.hint', 'Finished artwork displays in full, without cropping or dimming.'),
      h('details.advanced', { open: true }, h('summary', 'Event text (optional with artwork)'),
        field('Event title', headline), field('Date & time', when), field('Extra details', details)),
      field('Theme', theme, 'Used for text posters and the space around artwork.'), removalDateField(removeOn)),
    h('div', h('p', 'Where should this poster play?'),
      ...(store.state.devices || []).map(d => h('label.content-choice', h('input', { type: 'checkbox', 'aria-label': d.name || 'Unnamed TV', checked: selected.has(d.id), onchange: e => {
        if (e.target.checked) selected.add(d.id); else selected.delete(d.id);
      } }), icon('monitor', 21), h('span', h('strong', d.name || 'Unnamed TV'), h('small', contentFor(d).map(i => store.state.boards.find(b => b.id === i.board_id)?.name).filter(Boolean).join(' → ') || 'No content yet')))),
      h('p.hint', 'Leave all TVs unchecked to save the poster for later.'),
      field('How should it play?', mode), field('Poster duration (seconds)', seconds, 'Used when playing alongside other content.'),
      h('p.workflow-note', 'Publishing starts now. An event date is display text; it does not schedule playback.')),
    h('div')
  ];
  const progress = h('div.workflow-steps');
  const body = h('div', progress, ...panels);
  const back = h('button.btn', { onclick: () => { step--; draw(); } }, 'Back');
  const draw = () => {
    clear(progress);
    ['Create poster', 'Choose TVs', 'Review'].forEach((label, i) => progress.appendChild(h('span' + (i === step ? '.active' : ''), `${i + 1}. ${label}`)));
    panels.forEach((panel, i) => { panel.hidden = i !== step; });
    back.hidden = step === 0;
    modal.el.querySelector('.sheet-foot .btn-primary').textContent = step < 2 ? 'Continue' : selected.size ? 'Publish poster' : 'Save poster';
    if (step === 2) {
      clear(panels[2]);
      panels[2].appendChild(h('div.review-poster', { style: { background: PRESETS[theme.value].bg, color: PRESETS[theme.value].text, fontFamily: FONT_STACKS[PRESETS[theme.value].headingFont] } },
        imageId ? h('img', { src: '/u/' + imageId, alt: name.value }) : null,
        h('p', when.value), h('h3', headline.value), h('p', details.value)));
      panels[2].appendChild(h('h3', name.value));
      panels[2].appendChild(h('p.workflow-note', removeOn.value ? `Automatically stops showing at midnight on ${removeOn.value} (${store.state.timeZone}).` : 'No automatic removal date.'));
      panels[2].appendChild(h('p', selected.size ? `${mode.value === 'append' ? 'Add alongside current content on' : 'Replace current content on'}: ` + store.state.devices.filter(d => selected.has(d.id)).map(d => d.name || 'Unnamed TV').join(', ') : 'Save to your library. No TVs will change.'));
      panels[2].appendChild(h('p.hint', 'Review the artwork and text above. You can edit this poster later from Home.'));
    }
  };
  const modal = sheet({ title: 'Add event poster', body, extra: back, saveLabel: 'Continue', onSave: async () => {
    if (uploading) { toast('Finish choosing the artwork first.', true); return false; }
    if (step === 0 && (!name.value.trim() || (!imageId && !headline.value.trim()))) {
      toast('Add a poster name and either artwork or an event title.', true);
      panels[0].querySelector('details').open = true;
      return false;
    }
    if (step === 1 && !seconds.checkValidity()) { seconds.reportValidity(); return false; }
    if (step < 2) { step++; draw(); return false; }
    return mutate(async () => {
      const result = await api.post('/api/publish', { deviceIds: [...selected], mode: mode.value, seconds: Number(seconds.value),
        poster: { name: name.value.trim(), theme: { preset: theme.value }, content: {
          image: imageId, headline: headline.value.trim(), eyebrow: when.value.trim(), subhead: details.value.trim(),
          fit: 'contain', overlay: 0, showLogo: false, removeOn: removeOn.value || null
        } } });
      store.boardId = result.board.id;
      navigate(tvId ? 'tv' : 'posters', tvId);
    }, selected.size ? 'Poster published to selected TVs' : 'Poster saved for later');
  } });
  draw();
}
