import { themeToCssVars, webfontHref, webfontFamilies, rotationFor, resolveTheme, STATUSES } from '../shared/theme.js';
import { qrSvg } from '../shared/qr.js';
import { posterTransitionFor, runPosterTransition } from './poster-transitions.js';
import { POSTER_TRANSITIONS } from '../shared/transitions.js';
import { posterExpired } from '../shared/poster-expiry.js';

const app = document.getElementById('app');
const CACHE_KEY = 'signage.lastPayload';
const DEVICE_KEY = 'signage.deviceId';

// Preview mode renders one static frame: no SSE, no timers, no rotation.
// Used by the admin's live preview pane and by screenshot tooling.
const PREVIEW = new URLSearchParams(location.search).has('preview');
const orientationParam = new URLSearchParams(location.search).get('orientation');
const previewOrientation = PREVIEW && ['landscape', 'portrait', 'portraitLeft', 'auto'].includes(orientationParam) ? orientationParam : null;
const previewScene = scene => previewOrientation ? { ...scene, theme: { ...scene.theme, orientation: previewOrientation } } : scene;

let payload = null;      // last rendered board payload
let deviceId = null;     // set when running in paired-screen mode
let rotateTimer = null;
let pages = [];
let pageIndex = 0;
let liveRevision = -1;

// ------------------------------------------------------------------ routing

/**
 * /d/slug (or ?board=) pins this screen to one board, /p/slug (or ?playlist=)
 * to a rotation. With neither, the screen registers and shows a pairing code.
 */
function sourceFromUrl() {
  const params = new URLSearchParams(location.search);
  if (PREVIEW && params.get('device')) return { kind: 'device', slug: params.get('device') };
  if (params.get('board')) return { kind: 'board', slug: params.get('board') };
  if (params.get('playlist')) return { kind: 'playlist', slug: params.get('playlist') };

  const board = /^\/d\/([^/]+)/.exec(location.pathname);
  if (board) return { kind: 'board', slug: decodeURIComponent(board[1]) };

  const playlist = /^\/p\/([^/]+)/.exec(location.pathname);
  if (playlist) return { kind: 'playlist', slug: decodeURIComponent(playlist[1]) };

  return null;
}

// ------------------------------------------------------------------ fetching

async function getJson(url, opts) {
  const res = await fetch(url, { cache: 'no-store', ...opts });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function ensureDevice() {
  let id = null;
  try { id = localStorage.getItem(DEVICE_KEY); } catch { /* private mode */ }
  const body = await getJson('/api/device/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  });
  deviceId = body.device.id;
  try { localStorage.setItem(DEVICE_KEY, deviceId); } catch { /* ignore */ }
  return deviceId;
}

async function loadPayload() {
  const src = sourceFromUrl();
  if (src) {
    if (src.kind === 'device') return getJson('/api/device/' + encodeURIComponent(src.slug) + '/preview');
    const base = src.kind === 'playlist' ? '/api/playlist/' : '/api/board/';
    return getJson(base + encodeURIComponent(src.slug));
  }
  if (!deviceId) await ensureDevice();
  return getJson('/api/device/' + encodeURIComponent(deviceId));
}

async function refresh() {
  try {
    const data = await loadPayload();
    setConnected(true);

    if (data.paired === false) return renderPairing(data);

    payload = data;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* quota */ }
    applyPayload(data);
  } catch (err) {
    console.warn('refresh failed', err);
    setConnected(false);
    if (PREVIEW) {
      renderMessage('Preview unavailable', 'Check your connection and try again.');
      parent.postMessage({ type: 'preview-error' }, location.origin);
    } else if (!payload) restoreFromCache();
  }
}

/** A Firestick that reboots before the server is up still shows last night's menu. */
function restoreFromCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return renderMessage('Connecting…', 'Waiting for the menu server.');
    payload = JSON.parse(raw);
    applyPayload(payload);
  } catch {
    renderMessage('Connecting…', 'Waiting for the menu server.');
  }
}

// ------------------------------------------------------------------ realtime

function connectEvents() {
  if (typeof EventSource === 'undefined') {
    setInterval(refresh, 15000);
    return;
  }
  let es;
  const open = () => {
    es = new EventSource('/api/events');

    es.addEventListener('revision', (e) => {
      setConnected(true);
      const { revision } = JSON.parse(e.data);
      if (revision !== liveRevision) {
        liveRevision = revision;
        refresh();
      }
    });

    es.addEventListener('command', (e) => {
      const cmd = JSON.parse(e.data);
      if (cmd.deviceId && cmd.deviceId !== deviceId) return;
      if (cmd.action === 'reload') location.reload();
      if (cmd.action === 'identify') flashIdentify();
    });

    es.onerror = () => {
      setConnected(false);
      es.close();
      setTimeout(open, 4000);   // Silk drops idle sockets; just reconnect
    };
  };
  open();

  // Safety net: if SSE silently stalls, a slow poll still catches changes.
  setInterval(async () => {
    try {
      const { revision } = await getJson('/api/revision');
      if (revision !== liveRevision) { liveRevision = revision; refresh(); }
      setConnected(true);
    } catch { setConnected(false); }
  }, 60000);
}

let connEl = null;
function setConnected(ok) {
  if (ok) {
    if (connEl) { connEl.remove(); connEl = null; }
    return;
  }
  if (connEl) return;
  connEl = document.createElement('div');
  connEl.className = 'conn';
  connEl.textContent = 'Offline';
  document.body.appendChild(connEl);
}

function flashIdentify() {
  const el = document.createElement('div');
  el.className = 'center';
  el.style.zIndex = '100';
  el.innerHTML = '<h1>This screen</h1>';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ------------------------------------------------------------------ theming

function applyTheme(theme) {
  app.dataset.menuStyle = theme.menuStyle || '';
  const root = document.documentElement;
  // Fill any gaps from the defaults first. A partial theme (or none at all, as
  // on the pairing screen) would otherwise write "undefined" into the custom
  // properties, which CSS discards - leaving black text on a black board.
  const vars = themeToCssVars(resolveTheme({}, theme || {}));
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);

  applyRotation(theme);

  const href = webfontHref(theme);
  let link = document.getElementById('webfont');
  if (href) {
    if (!link) {
      link = document.createElement('link');
      link.id = 'webfont';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    if (link.href !== href) link.href = href;
  } else if (link) {
    link.remove();
  }
}

/** Rotate the whole board for a vertically mounted panel. */
function applyRotation(theme) {
  const deg = rotationFor(theme);
  app.classList.remove('rot-90', 'rot-270');
  document.documentElement.classList.toggle('rot', deg !== 0);
  if (deg === 90) app.classList.add('rot-90');
  else if (deg === 270) app.classList.add('rot-270');
}

// ------------------------------------------------------------------ building

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined && text !== null && text !== '') n.textContent = text;
  return n;
}

function buildSectionHeader(section, theme, continued) {
  const head = el('div', 'sec');
  head.appendChild(el('span', 'sec-name', continued ? section.name + ' (cont.)' : section.name));
  if (section.note && !continued) head.appendChild(el('span', 'sec-note', section.note));
  return head;
}

function buildRow(item, theme, currency) {
  const row = el('div', 'row');
  if (item.status && item.status !== 'on') row.classList.add('is-' + item.status);

  if (theme.accentBar) {
    const bar = el('span', 'row-accent');
    if (theme.showColorSwatch && item.color) bar.style.setProperty('--swatch', item.color);
    row.appendChild(bar);
  }

  if (theme.showTapNumbers && item.tap) row.appendChild(el('span', 'row-tap', item.tap));

  if (theme.showImages && item.image) {
    const img = el('img', 'row-thumb');
    img.src = '/u/' + item.image;
    img.alt = '';
    img.loading = 'lazy';
    row.appendChild(img);
  }

  const main = el('div', 'row-main');

  const name = el('div', 'row-name');
  name.appendChild(document.createTextNode(item.name || ''));
  if (item.badge) name.appendChild(el('span', 'badge', item.badge));
  main.appendChild(name);

  // Style and producer share a line; either one alone still reads fine.
  const subBits = [];
  if (theme.showStyle && item.style) subBits.push(item.style);
  if (item.producer) subBits.push(item.producer);
  if (subBits.length) main.appendChild(el('div', 'row-sub', subBits.join(' · ')));

  const meta = el('div', 'row-meta');
  if (theme.showOrigin && item.origin) meta.appendChild(el('span', null, item.origin));
  if (theme.showAbv && item.abv !== null && item.abv !== undefined) {
    meta.appendChild(el('span', 'chip chip-abv', formatAbv(item.abv)));
  }
  if (theme.showIbu && item.ibu !== null && item.ibu !== undefined) {
    meta.appendChild(el('span', 'chip', item.ibu + ' IBU'));
  }
  if (item.status && item.status !== 'on') {
    meta.appendChild(el('span', 'tag tag-' + item.status, (STATUSES[item.status] || {}).label || item.status));
  }
  if (meta.childNodes.length) main.appendChild(meta);

  if (theme.showDescription && item.description) {
    main.appendChild(el('div', 'row-desc', item.description));
  }

  row.appendChild(main);

  const prices = (item.prices || []).filter(p => String(p.amount || '').trim() !== '');
  if (prices.length) {
    const box = el('div', 'row-prices');
    if (prices.length === 1 && !prices[0].label) box.classList.add('price-solo');
    for (const p of prices) {
      const line = el('div', 'price');
      if (p.label) line.appendChild(el('span', 'price-label', p.label));
      line.appendChild(el('span', 'price-amount', formatPrice(p.amount, currency)));
      box.appendChild(line);
    }
    row.appendChild(box);
  }

  return row;
}

function formatAbv(abv) {
  const n = Number(abv);
  if (!Number.isFinite(n)) return String(abv);
  return (Number.isInteger(n) ? n.toFixed(1) : String(n)) + '%';
}

function formatPrice(amount, currency) {
  const raw = String(amount).trim();
  if (!raw) return '';
  // Respect anything non-numeric verbatim ("MKT", "$8", "8/12").
  if (!/^\d+(\.\d+)?$/.test(raw)) return raw;
  return (currency || '$') + raw;
}

// ------------------------------------------------------- layout engine

/**
 * Pack blocks into columns and pages by appending to the LIVE DOM and asking
 * the browser after each block whether the column still fits.
 *
 * Measuring a detached clone is faster but lies: row heights and the usable
 * stage height both shift when webfonts swap in, and the two never agree.
 * Packing against real geometry is self-correcting, so the board never clips
 * and never leaves a column half empty.
 */
function packPages(blocks, colCount, colHeight, targetHeight, stage, theme, useHeaders) {
  stage.textContent = '';
  const built = [];
  const heights = [];
  let page = null;
  let pageCols = [];
  let col = null;
  let colIdx = 0;

  const newPage = () => {
    page = el('div', 'page');
    page.classList.add(built.length === 0 ? 'is-live' : 'is-enter');

    // Every column is created up front. `.col` is flex: 1 1 0, so a lone column
    // would stretch to the full page width and every row would be measured at
    // double width - then halve (and re-wrap, and grow) the moment the next
    // column appeared. Building them all first fixes each column's width before
    // a single row is measured.
    pageCols = [];
    for (let i = 0; i < colCount; i++) {
      const c = el('div', 'col');
      if (theme.rowDividers) c.classList.add('divide');
      if (theme.zebra) c.classList.add('zebra');
      page.appendChild(c);
      pageCols.push(c);
    }

    stage.appendChild(page);
    built.push(page);
    colIdx = 0;
    col = pageCols[0];
  };

  const advance = () => {
    colIdx += 1;
    if (colIdx >= colCount) newPage();
    else col = pageCols[colIdx];
  };

  newPage();

  for (const b of blocks) {
    const before = col.scrollHeight;
    const node = b.build();
    col.appendChild(node);
    const grew = col.scrollHeight - before;

    // Break on the balance target, but never past the hard limit, and never
    // leave a column completely empty.
    const fits = col.scrollHeight <= targetHeight || col.childNodes.length === 1;
    if (fits) { heights.push(grew); continue; }

    col.removeChild(node);

    // Never strand a section header at the foot of a column: carry it over.
    let carried = null;
    const last = col.lastChild;
    if (last && last.classList && last.classList.contains('sec')) {
      col.removeChild(last);
      heights.pop();
      carried = b.sectionRef;
    }

    advance();

    if (carried) {
      col.appendChild(buildSectionHeader(carried, theme, false));
      heights.push(col.scrollHeight);
    } else if (useHeaders && b.type === 'row' && b.sectionRef) {
      col.appendChild(buildSectionHeader(b.sectionRef, theme, true));
    }

    const mark = col.scrollHeight;
    col.appendChild(node);
    heights.push(col.scrollHeight - mark);
  }

  // Keep unused columns in place so every page has identical column widths,
  // but drop the divider rule that would otherwise hang beside empty space.
  for (const pg of built) {
    let tallest = 0;
    for (const c of pg.children) {
      if (!c.children.length) c.classList.add('is-empty');
      tallest = Math.max(tallest, c.scrollHeight);
    }
    // Short board (or an evenly balanced one) - centre the whole block rather
    // than leaving it pinned to the top with a dead band underneath. Padding
    // the page, not the columns, keeps every column's first row aligned.
    const slack = colHeight - tallest;
    pg.style.paddingTop = slack > 8 ? Math.round(slack / 2) + 'px' : '';
  }

  pages = built;
  pageIndex = 0;
  return { pages: built, heights };
}

/**
 * Fill the columns evenly instead of cramming each one full in turn.
 *
 * Greedy packing is correct but ugly at the seams: nineteen rows across three
 * columns fills two pages solid and leaves one lonely item alone on page three,
 * which then holds the whole screen for its full rotation.
 *
 * So pack greedily once to learn how many pages the content genuinely needs and
 * how tall each block really is, then binary-search the SHORTEST column height
 * that still fits inside that page count. The search runs on the measured
 * heights in plain JS - no DOM - so only one extra pack ever touches the page.
 */
function packBalanced(blocks, colCount, colHeight, stage, theme, useHeaders) {
  const greedy = packPages(blocks, colCount, colHeight, colHeight, stage, theme, useHeaders);
  const pageCount = greedy.pages.length;
  const heights = greedy.heights;
  if (pageCount < 1 || heights.length < 2) return greedy;

  const tallest = heights.reduce((n, h) => Math.max(n, h), 0);
  let lo = Math.max(tallest, 1);
  let hi = colHeight;
  if (lo >= hi) return greedy;

  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (simulatePages(heights, colCount, mid) <= pageCount) { best = mid; hi = mid - 1; }
    else lo = mid + 1;
  }

  if (best < 0 || best >= colHeight) return greedy;

  const balanced = packPages(blocks, colCount, colHeight, best, stage, theme, useHeaders);
  if (balanced.pages.length <= pageCount) return balanced;

  // Re-inserted continuation headers cost more than the simulation predicted.
  return packPages(blocks, colCount, colHeight, colHeight, stage, theme, useHeaders);
}

/** How many pages `heights` needs if no column may exceed `target`. */
function simulatePages(heights, colCount, target) {
  let cols = 1;
  let used = 0;
  for (const h of heights) {
    if (used > 0 && used + h > target) { cols += 1; used = 0; }
    used += h;
  }
  return Math.ceil(cols / colCount);
}

function startRotation(seconds) {
  clearInterval(rotateTimer);
  rotateTimer = null;
  updateDots();
  if (PREVIEW || pages.length < 2) return;

  const ms = Math.max(4, Number(seconds) || 12) * 1000;
  rotateTimer = setInterval(() => {
    const current = pages[pageIndex];
    pageIndex = (pageIndex + 1) % pages.length;
    const next = pages[pageIndex];

    current.classList.remove('is-live');
    current.classList.add('is-exit');
    next.classList.remove('is-exit');
    next.classList.add('is-enter');
    // Force a style flush so the enter transition actually runs.
    void next.offsetHeight;
    next.classList.remove('is-enter');
    next.classList.add('is-live');

    updateDots();
  }, ms);
}

function updateDots() {
  const box = document.querySelector('.dots');
  if (!box) return;
  box.textContent = '';
  if (pages.length < 2) return;
  for (let i = 0; i < pages.length; i++) {
    const d = el('span', 'dot' + (i === pageIndex ? ' on' : ''));
    box.appendChild(d);
  }
}

// ------------------------------------------------------------- scene player

let scenes = [];
let sceneIndex = 0;
let sceneTimer = null;
let visibleScene = null;
let posterWipe = null;
let sceneGeneration = 0;
let expiryTimer = null;

function watchPosterExpiry(data) {
  clearTimeout(expiryTimer);
  const boards = data?.type === 'playlist' ? (data.scenes || []).map(s => s.board) : [data?.board];
  const cutoffs = boards.filter(b => b?.layout === 'poster').map(b => b.content?.expiresAt).filter(t => Number.isFinite(t) && t > Date.now());
  if (!cutoffs.length) return;
  // Browser timers cap at ~24 days. Recheck long dates without expiring early.
  expiryTimer = setTimeout(() => {
    if (visibleScene && posterExpired(visibleScene.board)) applyPayload(payload);
    else watchPosterExpiry(payload);
  }, Math.min(2147480000, Math.max(1, Math.min(...cutoffs) - Date.now() + 10)));
}

function cancelTransition() {
  posterWipe?.cancel();
  posterWipe = null;
}

function stopScenes() {
  sceneGeneration++;
  clearTimeout(sceneTimer);
  sceneTimer = null;
}

/** Entry point for any payload: a single board, or a rotation of scenes. */
function applyPayload(data) {
  watchPosterExpiry(data);
  if (data?.type === 'empty' || posterExpired(data?.board)) {
    stopScenes(); scenes = [];
    return renderMessage('No active content', 'This poster has finished. Choose another menu or poster for this TV.');
  }
  if (data && data.type === 'playlist') return playRotation(data);
  stopScenes();
  scenes = [];
  renderScene(data);
}

function playRotation(data) {
  const currentId = scenes[sceneIndex] && scenes[sceneIndex].sceneId;
  scenes = (data.scenes || []).filter(s => !posterExpired(s.board));

  if (!scenes.length) {
    stopScenes();
    return renderMessage('No active content',
      'Choose an active menu or poster for this TV.');
  }

  // An edit mid-rotation re-sends the whole thing. Stay on the scene that is
  // already up rather than snapping back to the first one.
  let same = scenes.findIndex(s => s.sceneId === currentId);
  if (same < 0 && currentId) {
    const original = data.scenes || [];
    const index = original.findIndex(s => s.sceneId === currentId);
    for (let offset = 1; index >= 0 && offset <= original.length; offset++) {
      const nextId = original[(index + offset) % original.length].sceneId;
      same = scenes.findIndex(s => s.sceneId === nextId);
      if (same >= 0) break;
    }
  }
  sceneIndex = same >= 0 ? same : 0;
  showScene();
}

async function showScene() {
  stopScenes();
  const generation = sceneGeneration;
  const scene = scenes[sceneIndex];
  if (!scene) return;
  if (posterExpired(scene.board)) return playRotation(payload);

  await renderScene(scene);

  if (generation !== sceneGeneration || PREVIEW || scenes.length < 2) return;
  const ms = Math.max(5, Number(scene.seconds) || 30) * 1000;
  sceneTimer = setTimeout(() => {
    sceneIndex = (sceneIndex + 1) % scenes.length;
    showScene();
  }, ms);
}

async function renderScene(scene) {
  if (!scene) return;
  scene = previewScene(scene);
  const previous = visibleScene;
  visibleScene = scene;
  cancelTransition();
  const transition = posterTransitionFor(previous, scene);
  if (!PREVIEW && transition !== 'none') {
    clearInterval(rotateTimer);
    rotateTimer = null;
    const wipe = runPosterTransition(transition, previous.theme, () => { if (!posterExpired(scene.board)) paintScene(scene); });
    posterWipe = wipe;
    await wipe.finished;
    if (posterWipe === wipe) posterWipe = null;
    return;
  }
  paintScene(scene);
  if (PREVIEW) parent.postMessage({ type: 'preview-ready' }, location.origin);
}

function paintScene(scene) {
  if (scene.board && scene.board.layout === 'poster') return renderPoster(scene);
  render(scene);
}

// The control app can preview the effect without changing saved content or TVs.
let previewReset = null;
window.addEventListener('message', async event => {
  if (PREVIEW && event.origin === location.origin && event.source === parent && event.data?.type === 'preview-theme' && visibleScene) {
    clearTimeout(previewReset);
    cancelTransition();
    visibleScene = previewScene({ ...visibleScene, theme: event.data.theme });
    paintScene(visibleScene);
    return;
  }
  if (!PREVIEW || event.origin !== location.origin || event.source !== parent || !['preview-beer', 'preview-transition'].includes(event.data?.type) || !visibleScene) return;
  clearTimeout(previewReset);
  cancelTransition();
  const effect = event.data.type === 'preview-beer' ? 'beer' : event.data.effect;
  if (!Object.prototype.hasOwnProperty.call(POSTER_TRANSITIONS, effect) || effect === 'none') return;
  const original = visibleScene;
  paintScene(original);
  const demo = { ...original, board: { ...original.board, layout: 'poster', content: { eyebrow: 'COMING UP', headline: 'Your next event', subhead: 'This is how your poster arrives.', showLogo: false } } };
  const wipe = runPosterTransition(effect, original.theme, () => paintScene(demo), { preview: true });
  posterWipe = wipe;
  await wipe.finished;
  if (posterWipe !== wipe) return;
  posterWipe = null;
  parent.postMessage({ type: event.data.type === 'preview-beer' ? 'preview-beer-ended' : 'preview-transition-ended', reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches }, location.origin);
  previewReset = setTimeout(() => { previewReset = null; paintScene(original); }, 2200);
});

// ------------------------------------------------------------------ poster

function renderPoster(scene) {
  const theme = scene.theme || {};
  const content = (scene.board && scene.board.content) || {};

  applyTheme(theme);
  clearInterval(rotateTimer);
  rotateTimer = null;
  pages = [];
  document.title = `${scene.venue?.name || ''} — ${scene.board?.name || 'Poster'}`.trim();

  app.className = 'fx-' + (theme.transition || 'fade');
  app.classList.add('is-poster');
  app.textContent = '';
  applyRotation(theme);

  const poster = el('div', 'poster align-' + (content.align || 'center'));

  if (content.image) {
    const img = el('img', 'poster-img');
    img.src = '/u/' + content.image;
    img.alt = '';
    img.style.objectFit = content.fit === 'contain' ? 'contain' : 'cover';
    poster.appendChild(img);
  }

  // Scrim keeps text legible over a busy photo; 0 leaves the art untouched.
  const veil = el('div', 'poster-veil');
  veil.style.opacity = String(content.overlay ?? (content.image ? 0.45 : 0));
  poster.appendChild(veil);

  const text = el('div', 'poster-text');
  if (content.showLogo !== false && scene.venue?.logo) {
    const logo = el('img', 'poster-logo');
    logo.src = '/u/' + scene.venue.logo;
    logo.alt = '';
    text.appendChild(logo);
  }
  if (content.eyebrow) text.appendChild(el('div', 'poster-eyebrow', content.eyebrow));
  if (content.headline) text.appendChild(el('h1', 'poster-headline', content.headline));
  if (content.subhead) text.appendChild(el('div', 'poster-sub', content.subhead));
  if (content.body) text.appendChild(el('div', 'poster-body', content.body));
  if (text.childNodes.length) poster.appendChild(text);

  app.appendChild(poster);
  fitHeading(poster.querySelector('.poster-headline'), 11, 3.4, 3);
}

// ------------------------------------------------------------------ render

function render(data) {
  const theme = data.theme || {};
  applyTheme(theme);
  document.title = `${data.venue?.name || 'Menu'} — ${data.board?.name || ''}`.trim();

  app.className = 'fx-' + (theme.transition || 'fade');
  app.textContent = '';
  applyRotation(theme);

  // --- header ---
  if (theme.showHeader !== false) {
    const head = el('header', 'head');
    if (data.venue?.logo) {
      const img = el('img', 'head-logo');
      img.src = '/u/' + data.venue.logo;
      img.alt = '';
      head.appendChild(img);
    }
    const titles = el('div', 'head-titles');
    titles.appendChild(el('h1', 'head-venue', data.venue?.name || ''));
    if (data.venue?.tagline) titles.appendChild(el('div', 'head-tagline', data.venue.tagline));
    head.appendChild(titles);

    const right = el('div', 'head-right');
    if (theme.showClock) {
      const clock = el('div', 'head-clock');
      right.appendChild(clock);
      tickClock(clock);
    }
    right.appendChild(el('div', 'head-board', data.board?.name || ''));
    head.appendChild(right);
    app.appendChild(head);
  }

  // --- stage ---
  const stage = el('div', 'stage');
  app.appendChild(stage);

  // --- footer ---
  if (theme.showFooter !== false) {
    const foot = el('footer', 'foot');
    const ticker = el('div', 'ticker');
    const inner = el('span', 'ticker-inner', data.board?.ticker || '');
    ticker.appendChild(inner);
    foot.appendChild(ticker);
    foot.appendChild(el('div', 'dots'));
    app.appendChild(foot);
    requestAnimationFrame(() => setupTicker(ticker, inner, data.board?.ticker || ''));
  }

  // Two passes. The first paints instantly with fallback metrics; the second
  // re-measures once the real faces are in, because both row heights AND the
  // header height (and so the usable stage height) shift when fonts swap in.
  layout(data, stage, theme);
  activeStage = stage;
  waitForFonts(theme).then(() => {
    if (activeStage === stage && stage.isConnected) layout(data, stage, theme);
  });
}

let activeStage = null;

async function waitForFonts(theme) {
  if (!document.fonts || !document.fonts.load) return;
  const families = webfontFamilies(theme);
  if (!families.length) return;
  try {
    await Promise.all(families.flatMap(f => [
      document.fonts.load('400 40px "' + f + '"'),
      document.fonts.load('700 40px "' + f + '"')
    ]));
  } catch { /* offline: fallback stacks are already on screen */ }
}

function layout(data, stage, theme, attempt) {
  attempt = attempt || 0;
  const currency = data.venue?.currency || '$';

  // Fit the header before measuring the stage: shrinking the venue name onto
  // one line (or growing it onto two) changes how much height is left below.
  fitHeading(app.querySelector('.head-venue'), 5.4, 2.4, 2);

  const blocks = [];
  const useHeaders = (data.sections || []).length > 1 ||
                     (data.sections || []).some(s => s.note);
  for (const section of data.sections || []) {
    const showHeader = useHeaders;
    if (showHeader) {
      blocks.push({ type: 'sec', sectionRef: section, build: () => buildSectionHeader(section, theme, false) });
    }
    for (const item of section.items || []) {
      blocks.push({ type: 'row', sectionRef: section, build: () => buildRow(item, theme, currency) });
    }
  }

  if (!blocks.length) {
    stage.appendChild(centerCard('Nothing on the menu yet',
      'Add items in the control app and they will appear here instantly.'));
    pages = [];
    updateDots();
    return;
  }

  const wanted = Math.max(1, Number(theme.columns) || autoColumns(stage, blocks.length));
  const colCount = Math.min(wanted, maxColumnsFor(stage));
  packBalanced(blocks, colCount, stage.clientHeight, stage, theme, useHeaders);
  startRotation(theme.rotateSeconds);
  watchFit(data, stage, theme, attempt);
}

let fitObserver = null;

/**
 * Packing measures live, but rows can still grow *after* we measured - a
 * webfont swapping in, or an item image finally decoding. That silently pushes
 * the tail of a column off screen, and a next-frame check is far too early to
 * catch it. So watch the columns for any size change and re-pack when the
 * result stops fitting. Capped, because a row taller than the whole column can
 * never be made to fit and would otherwise loop forever.
 */
function watchFit(data, stage, theme, attempt) {
  if (fitObserver) { fitObserver.disconnect(); fitObserver = null; }
  if (attempt >= 3) return;

  const recheck = () => {
    if (!stage.isConnected) return;
    const limit = stage.clientHeight + 2;
    const overflows = Array.prototype.some.call(
      stage.querySelectorAll('.col'), (c) => c.scrollHeight > limit);
    if (overflows) layout(data, stage, theme, attempt + 1);
  };

  if (typeof ResizeObserver === 'undefined') {
    // Older Silk builds: settle for a few spaced checks.
    [250, 900, 2500].forEach(ms => setTimeout(recheck, ms));
    return;
  }

  let queued = false;
  fitObserver = new ResizeObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; recheck(); }, 120);
  });
  Array.prototype.forEach.call(stage.querySelectorAll('.col'), c => fitObserver.observe(c));
}

function autoColumns(stage, blockCount) {
  const wide = stage.clientWidth / Math.max(stage.clientHeight, 1) > 1.5;
  if (blockCount <= 8) return 1;
  if (blockCount <= 20) return wide ? 2 : 1;
  return wide ? 3 : 2;
}

/**
 * A row needs roughly 40rem before names start wrapping one word per line.
 * Portrait boards are only 1080 wide, so an explicit "3 columns" chosen for a
 * landscape screen has to be capped rather than obeyed literally.
 */
function maxColumnsFor(stage) {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
  return Math.max(1, Math.floor(stage.clientWidth / (40 * rem)));
}

function centerCard(title, body) {
  const box = el('div', 'center');
  box.appendChild(el('h1', null, title));
  if (body) box.appendChild(el('p', null, body));
  return box;
}

function renderPairing(data) {
  cancelTransition();
  visibleScene = null;
  applyTheme(data.theme || {});
  app.className = '';
  app.textContent = '';
  applyRotation(data.theme || {});
  const code = data.code || '······';
  const box = el('div', 'center');
  box.appendChild(el('h1', null, 'Pair this screen'));

  const row = el('div', 'pair-row');

  // The QR carries the pairing code, so scanning it opens the control app with
  // the code already filled in — no address to read off the screen and type.
  try {
    const holder = el('div', 'pair-qr');
    holder.appendChild(qrSvg(`${location.origin}/?pair=${encodeURIComponent(code)}`, { level: 'M' }));
    row.appendChild(holder);
  } catch (err) {
    console.warn('QR unavailable', err);
  }

  const side = el('div', 'pair-side');
  side.appendChild(el('p', null, 'Scan with your phone camera'));
  side.appendChild(el('div', 'pair-or', 'or open'));
  side.appendChild(el('div', 'pair-host', location.host));
  side.appendChild(el('div', 'pair-or', 'and enter this code'));
  side.appendChild(el('div', 'pair-code', code));
  row.appendChild(side);

  box.appendChild(row);
  app.appendChild(box);
  pages = [];
  clearInterval(rotateTimer);
  stopScenes();
}

function renderMessage(title, body) {
  clearInterval(rotateTimer);
  pages = [];
  cancelTransition();
  visibleScene = null;
  app.className = '';
  app.textContent = '';
  app.appendChild(centerCard(title, body));
}

/**
 * Scale a heading down until it fits its box, wrapping up to `maxLines`.
 *
 * Truncating is not an option here: a venue name is the one thing on the board
 * that must always read in full, so it wraps first and then scales rather than
 * ellipsing. Binary search over the font size costs a handful of reflows and
 * only runs when the board is (re)laid out.
 */
function fitHeading(node, maxRem, minRem, maxLines) {
  if (!node || !node.isConnected || !node.textContent.trim()) return;

  const fitsAt = (sizeRem) => {
    node.style.fontSize = sizeRem + 'rem';
    return node.scrollWidth <= node.clientWidth + 1 && countLines(node) <= maxLines;
  };

  if (fitsAt(maxRem)) return;

  let lo = minRem;
  let hi = maxRem;
  let best = minRem;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    if (fitsAt(mid)) { best = mid; lo = mid; } else { hi = mid; }
  }
  // Even at the floor it may need a third line; that is fine. Growing the
  // header is always better than hiding part of the name.
  node.style.fontSize = best.toFixed(2) + 'rem';
}

/**
 * Line count for a heading holding a single run of text.
 *
 * Not scrollHeight/lineHeight: a big condensed uppercase face paints outside
 * its line box, so that ratio reports a phantom extra line and the text gets
 * shrunk until it is all on one line. Range rects are the real line boxes, and
 * counting them works just as well when the board is rotated for portrait.
 */
function countLines(node) {
  try {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = range.getClientRects();
    if (rects.length) return rects.length;
  } catch { /* fall through */ }

  const lineHeight = parseFloat(getComputedStyle(node).lineHeight);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return 1;
  return Math.max(1, Math.round(node.scrollHeight / lineHeight));
}

// ------------------------------------------------------------------ chrome

function tickClock(node) {
  const paint = () => {
    node.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };
  paint();
  if (PREVIEW) return;
  clearInterval(node._t);
  node._t = setInterval(paint, 10000);
}

function setupTicker(box, inner, textValue) {
  box.classList.remove('ticker-scroll');
  if (!textValue) return;
  if (inner.scrollWidth <= box.clientWidth) return;
  // Duplicate the text so the -50% marquee loop is seamless.
  inner.textContent = textValue + '     •     ' + textValue + '     •     ';
  const dur = Math.max(18, inner.scrollWidth / 40);
  box.style.setProperty('--marquee-dur', dur + 's');
  box.classList.add('ticker-scroll');
}

// ------------------------------------------------------------------ boot

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (PREVIEW) {
      // Opening/resizing the control preview can dispatch a late resize event.
      // Reapplying the saved payload here used to cancel the in-flight demo.
      if (visibleScene && !posterWipe && !previewReset) paintScene(visibleScene);
    } else if (payload) applyPayload(payload);
  }, 350);
});

/** Best-effort: stop the panel sleeping. Fire TV also needs its own setting. */
async function keepAwake() {
  try {
    if ('wakeLock' in navigator) {
      let lock = await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible') {
          try { lock = await navigator.wakeLock.request('screen'); } catch { /* denied */ }
        }
      });
    }
  } catch { /* unsupported on Silk; documented workaround in README */ }
}

// A preview must wait for the requested board. Restoring the shared TV cache
// first signals readiness too early; the network response then cancels the demo.
if (!PREVIEW) restoreFromCache();
refresh();
if (!PREVIEW) {
  connectEvents();
  keepAwake();
}
