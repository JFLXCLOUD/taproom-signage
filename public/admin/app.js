import {
  h, clear, api, store, subscribe, emit, refreshState, connectLive,
  currentBoard, toast, field
} from './core.js';
import { icon } from './icons.js';
import { renderTVs, renderTV, renderLibrary, pairTV } from './view-workspace.js';
import { navigate, readRoute } from './navigation.js';
import { renderMenu } from './view-menu.js';
import { renderDesign } from './view-design.js';
import { renderScreens, renderSettings } from './view-system.js';

const root = document.getElementById('root');

const TABS = [['screens', 'TVs', 'monitor'], ['menus', 'Menus', 'list'], ['posters', 'Posters', 'image']];

// ------------------------------------------------------------------ shell

function render() {
  // Live updates must not erase a form somebody is still filling in.
  if (store.authed && document.querySelector('.shell[data-dirty=true]') && store.route === location.hash) {
    const live = root.querySelector('.live');
    if (live) { live.textContent = store.connected ? 'Connected' : 'Offline'; live.classList.toggle('off', !store.connected); }
    return;
  }
  clear(root);

  if (store.loading) {
    root.appendChild(h('div.empty', h('p', 'Loading…')));
    return;
  }
  if (!store.authed) {
    root.appendChild(loginView());
    return;
  }

  const activeTab = ['tv', 'screens'].includes(store.tab) ? 'screens' : ['menu', 'design'].includes(store.tab) ? (currentBoard()?.layout === 'poster' ? 'posters' : 'menus') : store.tab;
  root.appendChild(
    h('div',
      h('header.topbar',
        h('h1', store.state.settings?.venue_name || 'Taproom Signage'),
        h('span.live' + (store.connected ? '' : '.off'), store.connected ? 'Connected' : 'Offline'),
        h('button.venue-button', { onclick: () => navigate('settings'), 'aria-label': 'Venue details and app tools' }, icon('sliders', 19), h('span', 'Venue'))),
      h('div.shell', viewFor(store.tab)),
      h('nav.tabs', ...TABS.map(([key, label, iconName]) =>
        h('button' + (activeTab === key ? '.on' : ''), {
          'aria-current': activeTab === key ? 'page' : null,
          onclick: () => navigate(key)
        }, h('span.ico', icon(iconName, 22)), label)))));
}

function viewFor(tab) {
  try {
    if (tab === 'tv') return renderTV();
    if (tab === 'menus' || tab === 'posters') return renderLibrary(tab);
    if (tab === 'design') return renderDesign();
    if (tab === 'screens') return renderTVs();
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
    if (me.authed) {
      await refreshState();
      if (store.pairCode) setTimeout(pairTV, 0);
    }
  } catch (err) {
    if (err.status !== 401) toast('Cannot reach the server', true);
    store.authed = false;
  } finally {
    store.loading = false;
    emit();
  }
}

readRoute();
subscribe(render);
connectLive();
boot();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* not fatal */ });
}
