import { h, store, api, mutate, sheet, field, input, select, toast, confirmSheet } from './core.js';
import { icon } from './icons.js';
import { navigate } from './navigation.js';
import { contentFor, chooseContent, newPoster, assignedTo } from './view-home.js';
import { createBoard } from './view-menu.js';
import { PRESETS, resolveTheme, rotationFor } from '../shared/theme.js';
import { expiryLabel, posterExpired } from '../shared/poster-expiry.js';

const namedTVs = () => store.state.devices.filter(d => d.name || d.board_id || d.playlist_id);
const heading = (title, text, action) => h('div.workspace-heading', h('div', h('h2', title), h('p', text)), action);
const action = (text, fn, primary = false) => h('button.btn' + (primary ? '.btn-primary' : ''), { onclick: fn }, text);

export function renderTVs() {
  const devices = namedTVs();
  return h('div', heading('Your TVs', 'Start with the TV you want to change.', action('+ Add a TV', pairTV, true)),
    !devices.length ? h('section.welcome-panel', icon('monitor', 42), h('h3', 'Let’s set up your first screen'),
      h('p', 'You’ll name your TV, choose a menu or poster, and check which way the screen faces.'),
      h('ol.setup-steps', h('li', 'Open the display app on your TV'), h('li', 'Enter the code shown on screen'), h('li', 'Choose what you want to show')),
      action('Set up my first TV', pairTV, true), action('Create a menu first', () => navigate('menus'))) :
    h('div.television-grid', ...devices.map(d => {
      const items = contentFor(d).filter(i => !posterExpired(store.state.boards.find(b => b.id === i.board_id)));
      const online = d.last_seen && Date.now() - d.last_seen < 90000;
      return h('article.television-card',
        h('div.tv-mini', icon('monitor', 34), h('span', items.length ? items.map(i => store.state.boards.find(b => b.id === i.board_id)?.name).filter(Boolean).join(' + ') : 'Ready for your content')),
        h('div.tv-card-top', h('h3', d.name || 'Unnamed TV'), h('span.connection' + (online ? '.online' : ''), online ? 'Connected' : 'Not connected')),
        h('p.hint', items.length > 1 ? `${items.length} menus & posters playing in a loop` : items.length ? 'Showing one menu or poster' : 'Nothing selected yet'),
        action('Open TV', () => navigate('tv', d.id), true));
    })),
    h('div.help-strip', icon('list', 20), h('p', h('strong', 'Just changing a price? '), 'Go to Menus, open your menu, and tap the item you want to update.'), action('Go to menus', () => navigate('menus'))));
}

export function renderLibrary(kind) {
  const isPoster = kind === 'posters';
  const boards = store.state.boards.filter(b => (b.layout === 'poster') === isPoster);
  const list = h('div.content-library');
  const search = input({ type: 'search', placeholder: isPoster ? 'Find a poster…' : 'Find a menu…', 'aria-label': isPoster ? 'Find a poster' : 'Find a menu', oninput: () => draw() });
  const draw = () => {
    list.replaceChildren();
    const matches = boards.filter(b => b.name.toLowerCase().includes(search.value.toLowerCase()));
    for (const b of matches) {
      const count = (b.sections || []).reduce((n, s) => n + s.items.length, 0);
      list.appendChild(h('article.content-entry',
        h('div.content-thumb', { style: { color: PRESETS[b.theme?.preset]?.accent || '#efbd68', background: PRESETS[b.theme?.preset]?.bg || '#101923' } }, b.content?.image ? h('img', { src: '/u/' + b.content.image, alt: '' }) : icon(isPoster ? 'image' : 'list', 28)),
        h('div.content-entry-copy', h('h3', b.name), h('p', isPoster ? (b.content?.eyebrow || 'Event poster') : `${count} items · ${b.sections.length} sections`), h('small', expiryLabel(b)), h('small', assignedTo(b.id))),
        action(isPoster ? 'Edit poster' : 'Edit menu', () => navigate('menu', b.id))));
    }
    if (!matches.length) list.appendChild(h('div.empty', h('p', boards.length ? 'No matches. Try another name.' : isPoster ? 'Your event posters will be saved here.' : 'Your menus will be saved here.'), !boards.length ? action(isPoster ? 'Create a poster' : 'Create a menu', isPoster ? () => newPoster() : createBoard, true) : null));
  };
  draw();
  return h('div', heading(isPoster ? 'Posters' : 'Menus', isPoster ? 'Announce an event or share a special.' : 'Open a menu to change its items, prices, or appearance.',
    action(isPoster ? '+ Add a poster' : '+ Add a menu', isPoster ? () => newPoster() : createBoard, true)),
    boards.length ? field(isPoster ? 'Find your poster' : 'Find your menu', search) : null, list);
}

export function renderTV() {
  const device = store.state.devices.find(d => d.id === store.tvId);
  if (!device) return h('div.empty', h('p', 'This TV is no longer paired.'), action('Back to TVs', () => navigate('screens')));
  const items = contentFor(device);
  return h('div', h('button.back-link', { onclick: () => navigate('screens') }, '← All TVs'),
    heading(device.name || 'Your TV', 'Everything for this screen is right here.', action('Screen setup', () => screenSetup(device))),
    h('div.tv-workspace',
      h('section.tv-preview-panel', previewTV(device), h('p.hint', 'Preview of the first item, shown upright. The TV follows the order below.'),
        h('div.screen-summary', icon('monitor', 18), orientationLabel(device.orientation), action('Change', () => screenSetup(device)))),
      h('section.playing-panel', h('div.section-heading', h('h3', 'What plays on this TV'), action('Choose what plays', () => chooseContent(device))),
        !items.length ? h('p.empty', 'Choose a menu or poster to start showing content.') :
          h('ol.playing-list', ...items.map((item, i) => {
            const b = store.state.boards.find(b => b.id === item.board_id);
            if (!b) return null;
            return h('li', h('span.play-number', i + 1), h('div', h('h4', b.name), h('p.hint', posterExpired(b) ? expiryLabel(b) : `${b.layout === 'poster' ? 'Poster' : 'Menu'} · ${items.length === 1 ? 'Stays on screen' : item.seconds + ' seconds'}`), !posterExpired(b) && expiryLabel(b) ? h('p.hint', expiryLabel(b)) : null),
              action(b.layout === 'poster' ? 'Edit poster' : 'Edit menu', () => navigate('menu', b.id, device.id)));
          })),
        items.length > 1 ? h('p.hint', 'After the last item, playback starts again at the top.') : null,
        action('+ Add an event poster', () => newPoster(device.id))),
    ),
    h('details.advanced', h('summary', 'TV tools'),
      h('p.hint', 'Identify briefly displays a message on this TV. Restart display reloads its content.'),
      h('div.row-btns', action('Identify this TV', () => mutate(() => api.post('/api/devices/command', { deviceId: device.id, action: 'identify' }), 'Look for “This screen” on your TV')),
        action('Restart display', () => mutate(() => api.post('/api/devices/command', { deviceId: device.id, action: 'reload' }), 'Restart requested')),
        action('Remove this TV', async () => { if (await confirmSheet('Remove this TV?', 'You will need its pairing code to add it again.', 'Remove TV')) {
          if (await mutate(() => api.del('/api/devices/' + device.id), 'TV removed')) navigate('screens');
        } }))));
}

function orientationLabel(value) {
  return ({ landscape: 'Landscape · wide screen', portrait: 'Portrait · rotated right', portraitLeft: 'Portrait · rotated left', auto: 'Matches the screen' })[value] || 'Using existing content orientation';
}

function orientationChooser(value, change) {
  const box = h('div.orientation-choices');
  const draw = () => {
    box.replaceChildren(...[['landscape', 'Wide / landscape', 'TV in its usual position'], ['portrait', 'Tall / rotated right', 'TV turned clockwise'], ['portraitLeft', 'Tall / rotated left', 'TV turned counter-clockwise']].map(([key, label, hint]) =>
      h('button.orientation-choice' + (value === key ? '.selected' : ''), { 'aria-pressed': value === key ? 'true' : 'false', onclick: () => { value = key; change(key); draw(); } },
        h('span.orientation-picture' + (key === 'landscape' ? '' : '.tall'), h('span', 'TOP ↑'), h('b', 'MENU')),
        h('strong', label), h('small', hint))));
  };
  box.choose = next => { value = next; change(next); draw(); };
  draw(); return box;
}

export function screenSetup(device) {
  let orientation = device.orientation;
  const name = input({ value: device.name || '', placeholder: 'e.g. Behind the bar' });
  const unchanged = h('p.hint', orientation ? 'This setting applies to every menu and poster on this TV.' : 'Your current orientation stays unchanged until you choose an option.');
  const chooser = orientationChooser(orientation, value => { orientation = value; unchanged.textContent = 'This setting applies to every menu and poster on this TV.'; });
  sheet({ title: 'Screen setup · ' + (device.name || 'TV'), saveLabel: 'Save screen setup',
    body: h('div', field('TV name', name), h('h3', 'How is this TV mounted?'),
      chooser, unchanged,
      h('p.workflow-note', 'Save, then look at your TV. If a tall screen is upside down, choose the other rotation. Other TVs will not change.'),
      h('details.advanced', h('summary', 'Already rotated by the TV or player?'), action('Let the player handle orientation', () => { chooser.choose('auto'); unchanged.textContent = 'The player will handle orientation when you save.'; }),
        action('Use existing content orientation', () => { chooser.choose(null); unchanged.textContent = 'Each menu and poster will use its saved orientation.'; }))),
    onSave: () => {
      if (!name.value.trim()) { toast('Give this TV a name.', true); return false; }
      return mutate(() => api.patch('/api/devices/' + device.id, { name: name.value.trim(), orientation }), 'Screen setup saved');
    }
  });
}

export function pairTV() {
  const code = input({ value: store.pairCode || '', placeholder: 'ABC123', maxlength: 6, autocapitalize: 'characters', class: 'code-box' });
  const name = input({ placeholder: 'e.g. Main bar or Patio' });
  let orientation = 'landscape';
  sheet({ title: 'Add a TV', saveLabel: 'Connect TV',
    body: h('div', h('p', 'Open the display app on your TV. Enter the six-character code it shows.'),
      h('p.hint', 'Using a TV browser? Open ' + location.host + '/display'), field('Pairing code', code), field('Name this TV', name),
      h('h3', 'How is the TV mounted?'), orientationChooser(orientation, value => { orientation = value; }),
      h('p.hint', 'Next, you’ll choose the menus or posters to show.')),
    onSave: async () => {
      if (code.value.trim().length !== 6 || !name.value.trim()) { toast('Enter the TV’s six-character code and a name.', true); return false; }
      let id;
      const ok = await mutate(async () => {
        const result = await api.post('/api/devices/claim', { code: code.value.trim().toUpperCase(), name: name.value.trim(), orientation });
        id = result.device.id; store.pairCode = null;
      }, 'TV connected. Choose what it should show.');
      if (ok) { navigate('tv', id); chooseContent(store.state.devices.find(d => d.id === id)); }
      return ok;
    }
  });
}

function previewTV(device) {
  if (!contentFor(device).length) return h('div.preview-empty', icon('monitor', 52), h('p', 'Your preview will appear here'));
  const first = contentFor(device).map(i => store.state.boards.find(b => b.id === i.board_id)).find(b => b && !posterExpired(b));
  const theme = resolveTheme(store.state.settings.theme, first?.theme);
  const deg = rotationFor({ ...theme, orientation: device.orientation || theme.orientation });
  const frame = h('div.screen-preview', { dataset: { rotation: deg }, style: { aspectRatio: deg ? '9 / 16' : '16 / 9', maxWidth: deg ? '338px' : '100%', margin: '0 auto' } },
    h('div.screen-preview-inner', h('iframe', { src: `/display?preview=1&device=${device.id}&v=${store.state.revision}`, title: 'TV content preview', tabindex: '-1' })));
  requestAnimationFrame(sizePreviews);
  return frame;
}

function sizePreviews() {
  document.querySelectorAll('.screen-preview').forEach(frame => {
    const deg = Number(frame.dataset.rotation), scale = frame.clientWidth / (deg ? 1080 : 1920);
    frame.firstChild.style.transform = `scale(${scale})` + (deg === 90 ? ' translateY(1920px) rotate(-90deg)' : deg === 270 ? ' translateX(1080px) rotate(90deg)' : '');
  });
}
window.addEventListener('resize', sizePreviews);
