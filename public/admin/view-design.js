import {
  h, api, store, currentBoard, mutate, field, select, toggle, colorField, toast, refreshState, markDirty, clearDirty, emit, sheet
} from './core.js';
import { assignedTo } from './view-home.js';
import { editorHeader, navigate, editorPreviewTheme, contentPreviewUrl } from './navigation.js';
import { PRESETS, FONT_STACKS, ORIENTATIONS, resolveTheme, rotationFor } from '../shared/theme.js';
import { POSTER_TRANSITIONS } from '../shared/transitions.js';

const FONT_LABELS = {
  system: 'System', condensed: 'Condensed (Oswald)', grotesk: 'Grotesk (Inter)',
  serif: 'Serif (Playfair)', slab: 'Slab (Roboto Slab)', mono: 'Mono (JetBrains)',
  marker: 'Marker (chalk)'
};

let previewEl = null;


export function renderDesign() {
  const saved = store.state.boards.find(b => b.id === store.boardId);
  if (!saved) return h('div.empty', h('p', 'Choose a menu or poster first.'), h('button.btn', { onclick: () => navigate('menus') }, 'Back to menus'));
  const board = { ...saved, theme: { ...saved.theme } };
  let theme = resolveTheme(store.state.settings?.theme, board.theme);
  const status = h('span.save-status', { 'aria-live': 'polite' }, 'No unsaved changes');
  const presets = h('div');
  const custom = h('div');
  const set = patch => {
    Object.assign(board.theme, patch);
    theme = resolveTheme(store.state.settings?.theme, board.theme);
    markDirty(); status.textContent = 'Unsaved changes';
    updatePreviewFrame(theme);
    previewEl?.iframe.contentWindow?.postMessage({ type: 'preview-theme', theme: editorPreviewTheme(theme) }, location.origin);
    if (patch.preset) draw();
  };
  const draw = () => {
    presets.replaceChildren(presetCard(theme, set));
    custom.replaceChildren(...(board.layout === 'poster' ? [] : [fieldsCard(theme, set)]), colorsCard(theme, set), typeCard(theme, set));
  };
  draw();
  const save = h('button.btn.btn-primary', { onclick: async () => {
    save.disabled = true;
    try {
      if (await mutate(() => api.patch('/api/boards/' + board.id, { theme: board.theme }), 'Appearance saved')) { clearDirty(); emit(); }
    } finally { save.disabled = false; }
  } }, 'Save appearance');
  return h('div', editorHeader(board, 'look'),
    h('p.content-scope', assignedTo(board.id), '. This appearance is shared wherever this content plays.'),
    h('div.save-bar.appearance-save', status, save),
    h('div.appearance-workspace',
      h('div.appearance-preview', previewCard(board, theme), h('p.hint', 'Try a theme below. Your TVs change only when you save.')),
      h('div', presets, board.layout === 'poster' ? h('p.hint', 'To change artwork fit or text placement, return to Artwork & text.') : layoutCard(theme, set, () => theme),
        h('details.advanced', h('summary', 'More appearance options'), custom))));
}

// ------------------------------------------------------------------ preview

function previewCard(board, theme) {
  theme = editorPreviewTheme(theme);
  const tv = store.state.devices.find(d => d.id === store.tvId);
  const frame = h('div.preview-frame');
  const inner = h('div', { style: { position: 'absolute', top: '0', left: '0', transformOrigin: '0 0' } });
  const iframe = h('iframe', {
    src: contentPreviewUrl(board),
    title: 'Board preview',
    scrolling: 'no',
    style: { width: '1920px', height: '1080px', border: '0', display: 'block' }
  });
  inner.appendChild(iframe);
  frame.appendChild(inner);

  previewEl = { frame, inner, iframe, theme };
  requestAnimationFrame(() => updatePreviewFrame(theme));

  return h('div.card',
    h('div.card-head', h('h2', 'Preview'),
      h('span.hint', tv ? tv.name : 'Preview')),
    h('div.card-body', frame,
      h('div.hint', tv ? `${tv.name} · ${ORIENTATIONS[theme.orientation]?.label || 'Landscape'}. Shown upright for editing.` : 'Content preview. Open from a TV to preview its screen orientation.')));
}

/** Size and counter-rotate the preview so a portrait board reads upright. */
function updatePreviewFrame(theme) {
  if (!previewEl || !previewEl.frame.isConnected) return;
  theme = editorPreviewTheme(theme);
  previewEl.theme = theme;
  sizePreview(previewEl, theme);
}

function sizePreview({ frame, inner }, theme) {
  const deg = rotationFor(theme);

  // The Fire TV signal is always 1920x1080; portrait rotates content inside it.
  const visibleW = deg === 0 ? 1920 : 1080;
  const visibleH = deg === 0 ? 1080 : 1920;

  if (frame.classList.contains('beer-demo-frame')) {
    const height = Math.max(60, Math.min(innerHeight * 0.52, innerHeight - 270));
    frame.style.width = `min(100%, ${height * visibleW / visibleH}px)`;
  }
  frame.style.aspectRatio = `${visibleW} / ${visibleH}`;
  const scale = frame.clientWidth / visibleW;

  if (deg === 90) inner.style.transform = `scale(${scale}) translateY(1920px) rotate(-90deg)`;
  else if (deg === 270) inner.style.transform = `scale(${scale}) translateX(1080px) rotate(90deg)`;
  else inner.style.transform = `scale(${scale})`;
}

window.addEventListener('message', event => {
  if (event.origin !== location.origin || !previewEl?.iframe.isConnected ||
      event.source !== previewEl.iframe.contentWindow || event.data?.type !== 'preview-ready') return;
  // Apply current unsaved appearance after the preview finishes loading.
  previewEl.iframe.contentWindow.postMessage({ type: 'preview-theme', theme: previewEl.theme }, location.origin);
});

window.addEventListener('resize', () => {
  if (previewEl?.theme) updatePreviewFrame(previewEl.theme);
});

function openTransitionPreview(board, theme, effect) {
  theme = editorPreviewTheme(theme);
  const title = POSTER_TRANSITIONS[effect].preview;
  const frame = h('div.preview-frame.beer-demo-frame');
  const inner = h('div', { style: { position: 'absolute', inset: '0', transformOrigin: '0 0' } });
  const iframe = h('iframe', { title, scrolling: 'no', tabindex: '-1' });
  inner.appendChild(iframe); frame.appendChild(inner);
  const status = h('p.hint', { 'aria-live': 'polite' }, 'Loading your menu…');
  let ready = false, timeout;
  const send = data => iframe.contentWindow?.postMessage(data, location.origin);
  const play = () => {
    if (!ready) { load(); return; }
    replay.disabled = true;
    status.textContent = 'Playing preview…';
    send({ type: 'preview-theme', theme });
    send({ type: 'preview-transition', effect });
  };
  const replay = h('button.btn.btn-primary', { disabled: true, onclick: play }, 'Play again');
  const resize = () => sizePreview({ frame, inner }, theme);
  const receive = event => {
    if (event.origin !== location.origin || event.source !== iframe.contentWindow) return;
    if (event.data?.type === 'preview-ready' && !ready) {
      ready = true; clearTimeout(timeout); resize(); play();
    } else if (event.data?.type === 'preview-error') {
      clearTimeout(timeout); ready = false;
      status.textContent = 'The preview could not load. Check your connection and try again.';
      replay.disabled = false; replay.textContent = 'Retry preview';
    } else if (event.data?.type === 'preview-transition-ended' || event.data?.type === 'preview-beer-ended') {
      replay.disabled = false; replay.textContent = 'Play again';
      status.textContent = 'Preview finished. Play it again whenever you like.';
    }
  };
  const load = () => {
    ready = false; replay.disabled = true; status.textContent = 'Loading your menu…';
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      if (ready) return;
      status.textContent = 'The preview could not load. Check your connection and try again.';
      replay.disabled = false; replay.textContent = 'Retry preview';
    }, 12000);
    iframe.src = contentPreviewUrl(board) + `&t=${Date.now()}`;
  };
  window.addEventListener('message', receive);
  window.addEventListener('resize', resize);
  const modal = sheet({
    title, body: h('div', frame, status,
      h('p.hint', 'A sample poster is used here. Your TVs and saved content stay as they are.')),
    extra: replay, onSave: null,
    onClose: () => {
      clearTimeout(timeout);
      window.removeEventListener('message', receive);
      window.removeEventListener('resize', resize);
    }
  });
  modal.el.classList.add('beer-demo');
  resize(); load();
}

// ------------------------------------------------------------------ cards

function presetCard(theme, set) {
  return h('div.card',
    h('div.card-head', h('h2', '1. Choose a look')),
    h('div.card-body',
      h('div.preset-grid', ...Object.entries(PRESETS).map(([key, p]) =>
        h('button.preset' + (theme.preset === key ? '.on' : ''), {
          'aria-pressed': theme.preset === key ? 'true' : 'false',
          onclick: () => set({
            ...Object.fromEntries([...new Set(Object.values(PRESETS).flatMap(p => Object.keys(p)))].filter(k => !['label', 'description'].includes(k)).map(k => [k, ''])),
            preset: key
          }, true)
        },
          h('div.theme-sample', { style: { background: p.bg, color: p.text, fontFamily: FONT_STACKS[p.headingFont], borderColor: p.accent } },
            h('strong', { style: { color: p.accent } }, 'THE MENU'),
            h('span', 'House favourites'),
            h('div', h('span', 'Seasonal special'), h('b', '$12')),
            h('div', h('span', 'Local favourite'), h('b', '$8'))),
          h('div.preset-name', p.label + (theme.preset === key ? ' (selected)' : '')),
          h('p.hint', p.description || 'A signature look for your venue')))),
      h('div.hint', 'Picking a theme resets the colours and fonts below.')));
}

function layoutCard(theme, set, getTheme) {
  return h('div.card',
    h('div.card-head', h('h2', '2. Adjust the menu')),
    h('div.card-body',
      h('p.hint', 'TV mounted vertically? Set its orientation under TVs > open your TV > Screen setup.'),
      field('Columns',
        select(String(theme.columns ?? 2),
          [['0', 'Automatic'], ['1', 'One column'], ['2', 'Two columns'], ['3', 'Three columns'], ['4', 'Four columns']],
          { onchange: (e) => set({ columns: Number(e.target.value) }, true) }),
        'Auto picks a sensible count from the screen shape and how many items you have.'),

      slider('Text size', theme.density, 0.7, 1.5, 0.05, v => set({ density: v }),
        'Bigger text means fewer items per page and more page flips.'),

      slider('Edge margin', theme.safeArea, 0, 6, 0.2, v => set({ safeArea: v }),
        'Increase if your TV crops the edges (overscan).'),

      slider('Page flip seconds', theme.rotateSeconds, 4, 40, 1, v => set({ rotateSeconds: v }),
        'Only applies when the menu is too long for one screen.'),

      field('Menu page transition',
        select(theme.transition || 'fade', [['fade', 'Fade'], ['slide', 'Slide'], ['none', 'None']],
          { onchange: (e) => set({ transition: e.target.value }, true) })),
      currentBoard()?.layout !== 'poster' ? h('div',
        field('When this menu changes to a poster',
          select(theme.posterTransition || 'none', Object.entries(POSTER_TRANSITIONS).map(([key, effect]) => [key, effect.label]),
            { onchange: e => set({ posterTransition: e.target.value }, true) }),
          'Plays only from menu to poster. The poster gets its full display time afterward.'),
        h('p.transition-preview-label', 'Try an effect'),
        h('div.transition-previews', ...Object.entries(POSTER_TRANSITIONS).filter(([key]) => key !== 'none').map(([key, effect]) =>
          h('button.btn', { 'aria-label': effect.button, title: effect.button, onclick: () => openTransitionPreview(currentBoard(), getTheme(), key) },
            h('span.transition-play', { 'aria-hidden': 'true' }, '▶'), effect.short))),
        h('p.hint', 'Previews use a sample poster and don’t change your TVs.')) : null));
}

function fieldsCard(theme, set) {
  const rows = [
    ['showTapNumbers', 'Tap numbers'],
    ['showStyle', 'Style (e.g. Double IPA)'],
    ['showAbv', 'ABV'],
    ['showIbu', 'IBU'],
    ['showOrigin', 'Origin'],
    ['showDescription', 'Descriptions'],
    ['showImages', 'Item images'],
    ['showColorSwatch', 'Colour bar beside each item'],
    ['accentBar', 'Show the bar at all'],
    ['rowDividers', 'Divider lines between rows'],
    ['zebra', 'Shade alternate rows'],
    ['showHeader', 'Header (logo, venue, clock)'],
    ['showClock', 'Clock'],
    ['showFooter', 'Footer ticker'],
    ['uppercaseHeadings', 'Uppercase headings']
  ];
  return h('div.card',
    h('div.card-head', h('h2', 'What to show')),
    h('div.card-body',
      ...rows.map(([key, label]) => toggle(label, !!theme[key], v => set({ [key]: v }, true)))));
}

function colorsCard(theme, set) {
  const rows = [
    ['bg', 'Background'], ['bgAlt', 'Background glow'], ['surface', 'Panel'],
    ['text', 'Text'], ['muted', 'Secondary text'], ['accent', 'Accent'],
    ['accentText', 'Text on accent'], ['border', 'Lines']
  ];
  return h('div.card',
    h('div.card-head', h('h2', 'Colours')),
    h('div.card-body',
      ...rows.map(([key, label]) => colorField(label, theme[key], v => set({ [key]: v })))));
}

function typeCard(theme, set) {
  const fontOptions = Object.keys(FONT_STACKS).map(k => [k, FONT_LABELS[k] || k]);
  return h('div.card',
    h('div.card-head', h('h2', 'Type')),
    h('div.card-body',
      field('Heading font', select(theme.headingFont, fontOptions,
        { onchange: (e) => set({ headingFont: e.target.value }, true) })),
      field('Body font', select(theme.bodyFont, fontOptions,
        { onchange: (e) => set({ bodyFont: e.target.value }, true) })),
      slider('Corner rounding', theme.radius, 0, 28, 1, v => set({ radius: v })),
      toggle('Download fonts from Google', !!theme.webfonts, v => set({ webfonts: v }, true)),
      h('div.hint',
        'Turn this off for a screen with no internet — the board falls back to built-in fonts.')));
}

function slider(label, value, min, max, step, onchange, hint) {
  const out = h('span', { style: { color: 'var(--muted)', float: 'right' } }, String(value));
  const range = h('input', {
    type: 'range', min, max, step, value,
    oninput: (e) => { out.textContent = e.target.value; onchange(Number(e.target.value)); }
  });
  return h('div.field', h('label', label, out), range, hint ? h('div.hint', hint) : null);
}

// ------------------------------------------------------------------ actions

async function copyToAllBoards(board) {
  const others = (store.state.boards || []).filter(b => b.id !== board.id);
  if (!others.length) return toast('There is only one board');
  await mutate(async () => {
    for (const other of others) {
      await api.patch('/api/boards/' + other.id, { theme: board.theme });
    }
  }, `Design copied to ${others.length} board(s)`);
}
