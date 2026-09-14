import {
  h, api, store, currentBoard, mutate, field, select, toggle, colorField, toast, refreshState
} from './core.js';
import { PRESETS, FONT_STACKS, ORIENTATIONS, resolveTheme, rotationFor } from '../shared/theme.js';

const FONT_LABELS = {
  system: 'System', condensed: 'Condensed (Oswald)', grotesk: 'Grotesk (Inter)',
  serif: 'Serif (Playfair)', slab: 'Slab (Roboto Slab)', mono: 'Mono (JetBrains)',
  marker: 'Marker (chalk)'
};

let previewEl = null;
let saveTimer = null;
let pending = {};

export function renderDesign() {
  const board = currentBoard();
  if (!board) return h('div.empty', h('p', 'Create a board first.'));

  const theme = resolveTheme(store.state.settings?.theme, board.theme);

  // Buffer edits: a slider fires dozens of events, but the board only needs
  // the last one. Everything re-renders from server state after the flush.
  const set = (patch, immediate) => {
    pending = { ...pending, ...patch };
    Object.assign(board.theme, patch);
    updatePreviewFrame(resolveTheme(store.state.settings?.theme, board.theme));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, immediate ? 0 : 420);
  };

  const flush = async () => {
    const patch = pending;
    pending = {};
    if (!Object.keys(patch).length) return;
    try {
      await api.patch('/api/boards/' + board.id, { theme: patch });
      await refreshState();
      reloadPreview();
    } catch (err) {
      toast(err.message, true);
    }
  };

  return h('div',
    previewCard(board, theme),
    presetCard(theme, set),
    layoutCard(theme, set),
    fieldsCard(theme, set),
    colorsCard(theme, set),
    typeCard(theme, set),
    h('div.section-title', 'Apply elsewhere'),
    h('button.btn.btn-block', { onclick: () => copyToAllBoards(board) },
      'Copy this design to all other boards'));
}

// ------------------------------------------------------------------ preview

function previewCard(board, theme) {
  const frame = h('div.preview-frame');
  const inner = h('div', { style: { position: 'absolute', top: '0', left: '0', transformOrigin: '0 0' } });
  const iframe = h('iframe', {
    src: `/d/${board.slug}?preview=1`,
    title: 'Board preview',
    scrolling: 'no',
    style: { width: '1920px', height: '1080px', border: '0', display: 'block' }
  });
  inner.appendChild(iframe);
  frame.appendChild(inner);

  previewEl = { frame, inner, iframe, slug: board.slug };
  requestAnimationFrame(() => updatePreviewFrame(theme));

  return h('div.card',
    h('div.card-head', h('h2', 'Preview'),
      h('button.btn.btn-ghost.btn-sm', { onclick: reloadPreview }, 'Refresh')),
    h('div.card-body', frame,
      h('div.hint', 'Shown the way it will look on the wall. Rotation is applied for you.')));
}

/** Size and counter-rotate the preview so a portrait board reads upright. */
function updatePreviewFrame(theme) {
  if (!previewEl || !previewEl.frame.isConnected) return;
  const deg = rotationFor(theme);
  const { frame, inner } = previewEl;

  // The Fire TV signal is always 1920x1080; portrait rotates content inside it.
  const visibleW = deg === 0 ? 1920 : 1080;
  const visibleH = deg === 0 ? 1080 : 1920;

  frame.style.aspectRatio = `${visibleW} / ${visibleH}`;
  const scale = frame.clientWidth / visibleW;

  if (deg === 90) inner.style.transform = `scale(${scale}) translateY(1920px) rotate(-90deg)`;
  else if (deg === 270) inner.style.transform = `scale(${scale}) translateX(1080px) rotate(90deg)`;
  else inner.style.transform = `scale(${scale})`;
}

function reloadPreview() {
  if (!previewEl || !previewEl.iframe.isConnected) return;
  previewEl.iframe.src = `/d/${previewEl.slug}?preview=1&t=${Date.now()}`;
}

window.addEventListener('resize', () => {
  const board = currentBoard();
  if (board) updatePreviewFrame(resolveTheme(store.state.settings?.theme, board.theme));
});

// ------------------------------------------------------------------ cards

function presetCard(theme, set) {
  return h('div.card',
    h('div.card-head', h('h2', 'Theme')),
    h('div.card-body',
      h('div.preset-grid', ...Object.entries(PRESETS).map(([key, p]) =>
        h('button.preset' + (theme.preset === key ? '.on' : ''), {
          onclick: () => set({
            preset: key,
            // Drop per-colour overrides so the preset actually shows through.
            bg: '', bgAlt: '', surface: '', text: '', muted: '',
            accent: '', accentText: '', border: '',
            headingFont: '', bodyFont: ''
          }, true)
        },
          h('div.preset-swatches',
            h('i', { style: { background: p.bg } }),
            h('i', { style: { background: p.surface } }),
            h('i', { style: { background: p.accent } })),
          h('div.preset-name', p.label)))),
      h('div.hint', 'Picking a theme resets the colours and fonts below.')));
}

function layoutCard(theme, set) {
  return h('div.card',
    h('div.card-head', h('h2', 'Layout')),
    h('div.card-body',
      field('Orientation',
        select(theme.orientation || 'landscape',
          Object.entries(ORIENTATIONS).map(([k, v]) => [k, v.label]),
          { onchange: (e) => set({ orientation: e.target.value }, true) }),
        'A Fire TV always sends a landscape picture. If the TV is mounted vertically, ' +
        'pick a Portrait option and the board is rotated to match.'),

      field('Columns',
        select(String(theme.columns ?? 2),
          [['0', 'Auto'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']],
          { onchange: (e) => set({ columns: Number(e.target.value) }, true) }),
        'Auto picks a sensible count from the screen shape and how many items you have.'),

      slider('Text size', theme.density, 0.7, 1.5, 0.05, v => set({ density: v }),
        'Bigger text means fewer items per page and more page flips.'),

      slider('Edge margin', theme.safeArea, 0, 6, 0.2, v => set({ safeArea: v }),
        'Increase if your TV crops the edges (overscan).'),

      slider('Page flip seconds', theme.rotateSeconds, 4, 40, 1, v => set({ rotateSeconds: v }),
        'Only applies when the menu is too long for one screen.'),

      field('Transition',
        select(theme.transition || 'fade', [['fade', 'Fade'], ['slide', 'Slide'], ['none', 'None']],
          { onchange: (e) => set({ transition: e.target.value }, true) }))));
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
