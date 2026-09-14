import {
  h, clear, api, store, subscribe, emit, refreshState, connectLive,
  currentBoard, toast, field
} from './core.js';
import { icon } from './icons.js';
import { renderMenu } from './view-menu.js';
import { renderDesign } from './view-design.js';
import { renderScreens, renderSettings } from './view-system.js';

const root = document.getElementById('root');

const TABS = [
  ['menu', 'Menu', 'list'],
  ['design', 'Design', 'droplet'],
  ['screens', 'Screens', 'monitor'],
  ['settings', 'Settings', 'sliders']
];

// ------------------------------------------------------------------ shell

function render() {
  clear(root);

  if (store.loading) {
    root.appendChild(h('div.empty', h('p', 'Loading…')));
    return;
  }
  if (!store.authed) {
    root.appendChild(loginView());
    return;
  }

  const board = currentBoard();
  root.appendChild(
    h('div',
      h('header.topbar',
        h('h1', store.state.settings?.venue_name || 'Taproom Signage'),
        h('span.live' + (store.connected ? '' : '.off'), store.connected ? 'Live' : 'Offline')),
      h('div.shell', viewFor(store.tab)),
      h('nav.tabs', ...TABS.map(([key, label, iconName]) =>
        h('button' + (store.tab === key ? '.on' : ''), {
          onclick: () => { store.tab = key; emit(); window.scrollTo(0, 0); }
        }, h('span.ico', icon(iconName, 22)), label)))));
}

function viewFor(tab) {
  try {
    if (tab === 'design') return renderDesign();
    if (tab === 'screens') return renderScreens();
    if (tab === 'settings') return renderSettings();
    return renderMenu();
  } catch (err) {
    console.error(err);
    return h('div.empty', h('p', 'Something broke rendering this screen.'),
      h('p.hint', String(err && err.message)));
  }
}

// ------------------------------------------------------------------ login

function loginView() {
  const pw = h('input.input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
  const btn = h('button.btn.btn-primary.btn-block', { style: { marginTop: '6px' } }, 'Sign in');

  const submit = async () => {
    btn.disabled = true;
    try {
      await api.post('/api/auth/login', { password: pw.value });
      store.authed = true;
      await boot();
    } catch (err) {
      toast(err.message || 'Sign in failed', true);
      pw.value = '';
      pw.focus();
    } finally {
      btn.disabled = false;
    }
  };

  btn.addEventListener('click', submit);
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  return h('div.login',
    h('h1', 'Taproom Signage'),
    h('p', 'Sign in to manage the menu.'),
    field('', pw),
    btn);
}

// ------------------------------------------------------------------ boot

async function boot() {
  try {
    const me = await api.get('/api/auth/me');
    store.authed = me.authed;
    store.defaultPassword = me.defaultPassword;
    if (me.authed) await refreshState();
  } catch (err) {
    if (err.status !== 401) toast('Cannot reach the server', true);
    store.authed = false;
  } finally {
    store.loading = false;
    emit();
  }
}

subscribe(render);
connectLive();
boot();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* not fatal */ });
}
