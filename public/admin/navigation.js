import { h, store, emit, clearDirty } from './core.js';

export function navigate(tab, id, tvId) {
  if (tab === 'home') tab = 'screens';
  if (tab === 'menu' && !id) tab = 'menus';
  const route = '#' + [tab, id, tvId].filter(Boolean).map(encodeURIComponent).join('/');
  if (location.hash === route) readRoute();
  else location.hash = route;
}

export function readRoute() {
  if (store.route && store.route !== location.hash && document.querySelector('.shell[data-dirty=true]')) {
    if (!window.confirm('Discard your unsaved changes?')) { history.replaceState(null, '', store.route); return; }
    clearDirty();
  }
  store.route = location.hash;
  const [tab, id, tvId] = location.hash.slice(1).split('/').map(v => { try { return decodeURIComponent(v); } catch { return ''; } });
  store.tab = ['screens', 'tv', 'menus', 'posters', 'menu', 'design', 'settings'].includes(tab) ? tab : 'screens';
  store.tvId = store.tab === 'tv' ? id : tvId || null;
  if (['menu', 'design'].includes(store.tab)) store.boardId = id || null;
  emit();
  window.scrollTo(0, 0);
}

export function backToContent(board) {
  navigate(store.tvId ? 'tv' : board.layout === 'poster' ? 'posters' : 'menus', store.tvId || undefined);
}

// TV orientation belongs to this editor visit, never to the shared board draft.
export function editorPreviewTheme(theme) {
  const tv = store.state.devices.find(d => d.id === store.tvId);
  return tv?.orientation ? { ...theme, orientation: tv.orientation } : theme;
}

export function contentPreviewUrl(board) {
  const params = new URLSearchParams({ preview: '1' });
  const tv = store.state.devices.find(d => d.id === store.tvId);
  if (tv?.orientation) params.set('orientation', tv.orientation);
  return `/d/${encodeURIComponent(board.slug)}?${params}`;
}

export function editorHeader(board, active = 'edit') {
  const parentTV = store.state.devices.find(d => d.id === store.tvId);
  return h('div.editor-context',
    h('button.back-link', { onclick: () => backToContent(board) }, '← ' + (parentTV?.name || (board.layout === 'poster' ? 'All posters' : 'All menus'))),
    h('p.eyebrow', board.layout === 'poster' ? 'EVENT POSTER' : 'MENU'),
    h('h2.editor-title', board.name),
    h('div.editor-tabs',
      h('button' + (active === 'edit' ? '.selected' : ''), { onclick: () => navigate('menu', board.id, store.tvId), 'aria-current': active === 'edit' ? 'page' : null }, board.layout === 'poster' ? 'Artwork & text' : 'Items & prices'),
      h('button' + (active === 'look' ? '.selected' : ''), { onclick: () => navigate('design', board.id, store.tvId), 'aria-current': active === 'look' ? 'page' : null }, 'Appearance')));
}

window.addEventListener('hashchange', readRoute);
