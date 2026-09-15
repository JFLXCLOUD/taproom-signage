// API client, reactive store and DOM helpers for the control PWA.

// ------------------------------------------------------------------ dom

/** Tiny hyperscript: h('div.card', {onclick}, child, child) */
export function h(spec, props, ...kids) {
  const [tag, ...classes] = String(spec).split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');

  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    kids.unshift(props);
    props = null;
  }

  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className += (node.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }

  add(node, kids);
  return node;
}

function add(parent, kids) {
  for (const kid of kids.flat(4)) {
    if (kid === null || kid === undefined || kid === false || kid === true) continue;
    parent.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

// ------------------------------------------------------------------ api

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function request(method, url, body) {
  const opts = { method, cache: 'no-store', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (res.status === 401) {
    store.authed = false;
    emit();
    throw new ApiError('Session expired — sign in again', 401);
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(data?.error || `${res.status} ${res.statusText}`, res.status);
  return data;
}

export const api = {
  get:   (u) => request('GET', u),
  post:  (u, b) => request('POST', u, b ?? {}),
  patch: (u, b) => request('PATCH', u, b ?? {}),
  del:   (u) => request('DELETE', u)
};

// ------------------------------------------------------------------ store

// Captured once at load: scanning the QR on a display lands here as ?pair=CODE.
// Read before the URL is tidied so it survives the sign-in round trip.
const scannedPair = (() => {
  try {
    const code = new URLSearchParams(location.search).get('pair');
    if (!code) return null;
    history.replaceState(null, '', location.pathname);
    return code.toUpperCase().slice(0, 6);
  } catch {
    return null;
  }
})();

export const store = {
  pairCode: scannedPair,
  authed: false,
  defaultPassword: false,
  loading: true,
  connected: false,
  tab: scannedPair ? 'screens' : 'home',
  boardId: null,
  state: { settings: {}, boards: [], devices: [], revision: 0 }
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit() { for (const fn of listeners) fn(); }

export function markDirty() {
  const shell = document.querySelector('.shell');
  if (shell) shell.dataset.dirty = 'true';
}
export function clearDirty() {
  const shell = document.querySelector('.shell');
  if (shell) delete shell.dataset.dirty;
}
window.addEventListener('beforeunload', event => {
  if (document.querySelector('.shell[data-dirty=true]')) { event.preventDefault(); event.returnValue = ''; }
});

export function currentBoard() {
  const boards = store.state.boards || [];
  return boards.find(b => b.id === store.boardId) || boards[0] || null;
}

export async function refreshState() {
  const data = await api.get('/api/state');
  store.state = data;
  if (!store.boardId || !data.boards.some(b => b.id === store.boardId)) {
    store.boardId = data.boards[0]?.id || null;
  }
  emit();
  return data;
}

/** Mutate, then pull fresh state so the UI always matches the server. */
export async function mutate(fn, successMessage) {
  try {
    await fn();
    await refreshState();
    if (successMessage) toast(successMessage);
    return true;
  } catch (err) {
    toast(err.message || 'Something went wrong', true);
    return false;
  }
}

// ------------------------------------------------------------------ live

export function connectLive() {
  if (typeof EventSource === 'undefined') return;
  let es;
  const open = () => {
    es = new EventSource('/api/events');
    es.addEventListener('revision', (e) => {
      store.connected = true;
      const { revision } = JSON.parse(e.data);
      // Another device (or another bartender) changed something.
      if (store.authed && revision !== store.state.revision) refreshState().catch(() => {});
      else emit();
    });
    es.onerror = () => {
      store.connected = false;
      emit();
      es.close();
      setTimeout(open, 4000);
    };
  };
  open();
}

// ------------------------------------------------------------------ toast

let toastTimer = null;
export function toast(message, isError) {
  document.querySelectorAll('.toast').forEach(n => n.remove());
  const node = h('div.toast' + (isError ? '.err' : ''), message);
  document.body.appendChild(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), isError ? 4200 : 2200);
}

// ------------------------------------------------------------------ sheet

/** Bottom sheet modal. onSave returns false to keep it open. */
export function sheet({ title, body, saveLabel = 'Save', onSave, extra, onClose }) {
  const backdrop = h('div.sheet-backdrop');
  const previousFocus = document.activeElement;
  const close = () => { backdrop.remove(); previousFocus?.focus(); onClose?.(); };
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const focusable = [...backdrop.querySelectorAll('button, input, select, textarea, summary, a[href]')].filter(n => !n.disabled && n.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  });

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  const saveBtn = h('button.btn.btn-primary', { type: 'button' }, saveLabel);
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      const ok = await onSave();
      if (ok !== false) close();
    } catch (err) {
      toast(err.message || 'Could not save. Please try again.', true);
    } finally {
      saveBtn.disabled = false;
    }
  });

  backdrop.appendChild(
    h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div.sheet-head',
        h('h2', title),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: close }, 'Close')),
      h('div.sheet-body', body),
      h('div.sheet-foot', extra || null, onSave ? saveBtn : null))
  );

  document.body.appendChild(backdrop);
  backdrop.querySelector('input, button')?.focus();
  return { close, el: backdrop };
}

export function confirmSheet(title, message, confirmLabel = 'Delete') {
  return new Promise((resolve) => {
    const s = sheet({
      title,
      body: h('p', { style: { margin: '4px 0 8px', color: 'var(--muted)' } }, message),
      saveLabel: confirmLabel,
      onClose: () => resolve(false),
      onSave: () => { resolve(true); return true; }
    });
    s.el.addEventListener('click', (e) => { if (e.target === s.el) resolve(false); });
  });
}

// ------------------------------------------------------------------ fields

let fieldId = 0;
export function field(label, control, hint) {
  const target = control.matches?.('input, select, textarea') ? control : control.querySelector?.('input, select, textarea');
  if (target && !target.id) target.id = 'field-' + (++fieldId);
  return h('div.field', h('label', { for: target?.id }, label), control, hint ? h('div.hint', hint) : null);
}

export function input(props = {}) {
  return h('input.input', { type: 'text', ...props });
}

export function select(value, options, props = {}) {
  const node = h('select.input', props);
  for (const opt of options) {
    const [val, label] = Array.isArray(opt) ? opt : [opt, opt];
    node.appendChild(h('option', { value: val, selected: String(val) === String(value) }, label));
  }
  node.value = value;
  return node;
}

export function toggle(label, checked, onchange) {
  const box = h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) });
  return h('label.toggle', box, h('span.track'), h('span.lbl', label));
}

export function colorField(label, value, onchange) {
  const picker = h('input', { type: 'color', value: value || '#000000',
    oninput: (e) => { textBox.value = e.target.value; onchange(e.target.value); } });
  const textBox = h('input.input', { type: 'text', value: value || '',
    oninput: (e) => {
      if (/^#[0-9a-f]{6}$/i.test(e.target.value)) { picker.value = e.target.value; onchange(e.target.value); }
    } });
  return field(label, h('div.color-row', picker, textBox));
}

/**
 * Downscale an image in the browser before upload. Keeps the database small and
 * stops a 12MP phone photo from ever reaching a Firestick.
 */
export function pickImage({ maxSize = 640, quality = 0.86 } = {}) {
  return new Promise((resolve, reject) => {
    const picker = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    document.body.appendChild(picker);

    picker.addEventListener('change', async () => {
      const file = picker.files && picker.files[0];
      picker.remove();
      if (!file) return resolve(null);
      try {
        resolve(await downscale(file, maxSize, quality));
      } catch (err) {
        reject(err);
      }
    });

    picker.addEventListener('cancel', () => { picker.remove(); resolve(null); });
    picker.click();
  });
}

function downscale(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const hh = Math.max(1, Math.round(img.height * scale));
        const canvas = h('canvas', { width: w, height: hh });
        canvas.getContext('2d').drawImage(img, 0, 0, w, hh);
        // PNG keeps logo transparency; photos go to JPEG for size.
        const isPng = /png/i.test(file.type);
        resolve(canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export async function uploadImage(opts) {
  const dataUrl = await pickImage(opts);
  if (!dataUrl) return null;
  const res = await api.post('/api/uploads', { dataUrl });
  return res.id;
}
