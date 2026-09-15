import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { normalizePosterExpiry } from '../public/shared/poster-expiry.js';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'signage.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 4000');

export const nid = () => randomUUID().replace(/-/g, '').slice(0, 16);
export const now = () => Date.now();

db.exec(`
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  venue_name TEXT NOT NULL DEFAULT 'My Bar',
  tagline    TEXT NOT NULL DEFAULT '',
  logo       TEXT,
  theme      TEXT NOT NULL DEFAULT '{}',
  currency   TEXT NOT NULL DEFAULT '$',
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS boards (
  id         TEXT PRIMARY KEY,
  slug       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  layout     TEXT NOT NULL DEFAULT 'grid',
  theme      TEXT NOT NULL DEFAULT '{}',
  ticker     TEXT NOT NULL DEFAULT '',
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sections (
  id       TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name     TEXT NOT NULL DEFAULT '',
  kind     TEXT NOT NULL DEFAULT 'draft',
  note     TEXT NOT NULL DEFAULT '',
  hidden   INTEGER NOT NULL DEFAULT 0,
  sort     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sections_board ON sections(board_id, sort);

CREATE TABLE IF NOT EXISTS items (
  id          TEXT PRIMARY KEY,
  section_id  TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  tap         TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL DEFAULT '',
  style       TEXT NOT NULL DEFAULT '',
  producer    TEXT NOT NULL DEFAULT '',
  origin      TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  abv         REAL,
  ibu         INTEGER,
  color       TEXT,
  image       TEXT,
  badge       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'on',
  hidden      INTEGER NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_section ON items(section_id, sort);

CREATE TABLE IF NOT EXISTS prices (
  id      TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  label   TEXT NOT NULL DEFAULT '',
  amount  TEXT NOT NULL DEFAULT '',
  sort    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_prices_item ON prices(item_id, sort);

CREATE TABLE IF NOT EXISTS devices (
  id         TEXT PRIMARY KEY,
  code       TEXT UNIQUE,
  name       TEXT NOT NULL DEFAULT '',
  board_id   TEXT REFERENCES boards(id) ON DELETE SET NULL,
  agent      TEXT NOT NULL DEFAULT '',
  last_seen  INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS uploads (
  id         TEXT PRIMARY KEY,
  mime       TEXT NOT NULL,
  bytes      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL DEFAULT 0
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS playlists (
  id         TEXT PRIMARY KEY,
  slug       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS playlist_items (
  id          TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  seconds     INTEGER NOT NULL DEFAULT 30,
  sort        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_playlist_items ON playlist_items(playlist_id, sort);
`);

/** Add a column to an existing install without touching a fresh one. */
function ensureColumn(table, column, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some(c => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}

// Poster copy/artwork for layout === 'poster' boards.
ensureColumn('boards', 'content', "TEXT NOT NULL DEFAULT '{}'");
// A screen shows either one board or a rotation; never both.
ensureColumn('devices', 'playlist_id', 'TEXT REFERENCES playlists(id) ON DELETE SET NULL');
ensureColumn('devices', 'orientation', 'TEXT');

// ---------------------------------------------------------------- helpers

const q = (sql) => db.prepare(sql);

function parseJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

/** Monotonic revision counter. Displays compare this to know something changed. */
export function bumpRevision() {
  const r = getRevision() + 1;
  q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('revision', String(r));
  return r;
}

export function getRevision() {
  const row = q('SELECT value FROM meta WHERE key = ?').get('revision');
  return row ? Number(row.value) || 0 : 0;
}

// ---------------------------------------------------------------- settings

export function getSettings() {
  let row = q('SELECT * FROM settings WHERE id = 1').get();
  if (!row) {
    q('INSERT INTO settings (id, venue_name, updated_at) VALUES (1, ?, ?)').run('My Bar', now());
    row = q('SELECT * FROM settings WHERE id = 1').get();
  }
  return { ...row, theme: parseJson(row.theme, {}) };
}

export function updateSettings(patch) {
  const cur = getSettings();
  const next = {
    venue_name: patch.venue_name ?? cur.venue_name,
    tagline:    patch.tagline    ?? cur.tagline,
    logo:       patch.logo === undefined ? cur.logo : patch.logo,
    currency:   patch.currency   ?? cur.currency,
    theme:      JSON.stringify(patch.theme ? { ...cur.theme, ...patch.theme } : cur.theme)
  };
  q(`UPDATE settings SET venue_name = ?, tagline = ?, logo = ?, currency = ?, theme = ?, updated_at = ?
     WHERE id = 1`)
    .run(next.venue_name, next.tagline, next.logo, next.currency, next.theme, now());
  bumpRevision();
  return getSettings();
}

// ---------------------------------------------------------------- boards

function rowToBoard(r) {
  return r ? { ...r, theme: parseJson(r.theme, {}), content: parseJson(r.content, {}) } : null;
}

export function listBoards() {
  return q('SELECT * FROM boards ORDER BY sort, created_at').all().map(rowToBoard);
}

export function getBoard(id) {
  return rowToBoard(q('SELECT * FROM boards WHERE id = ?').get(id));
}

export function getBoardBySlug(slug) {
  return rowToBoard(q('SELECT * FROM boards WHERE slug = ?').get(slug));
}

export function uniqueSlug(base, ignoreId) {
  let s = String(base || 'board').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'board';
  let candidate = s, n = 2;
  for (;;) {
    const hit = q('SELECT id FROM boards WHERE slug = ?').get(candidate);
    if (!hit || hit.id === ignoreId) return candidate;
    candidate = `${s}-${n++}`;
  }
}

export function createBoard(data = {}) {
  const content = data.layout === 'poster' ? normalizePosterExpiry(data.content || {}) : data.content || {};
  const id = nid();
  const t = now();
  const maxSort = q('SELECT COALESCE(MAX(sort), -1) AS m FROM boards').get().m;
  q(`INSERT INTO boards (id, slug, name, layout, theme, content, ticker, sort, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      id,
      uniqueSlug(data.slug || data.name || 'board'),
      data.name || 'New board',
      data.layout || 'grid',
      JSON.stringify(data.theme || {}),
      JSON.stringify(content),
      data.ticker || '',
      maxSort + 1, t, t
    );
  bumpRevision();
  return getBoard(id);
}

export function updateBoard(id, patch) {
  const cur = getBoard(id);
  if (!cur) return null;
  const content = (patch.layout || cur.layout) === 'poster' ? normalizePosterExpiry(patch.content || {}, cur.content) : { ...cur.content, ...patch.content };
  q(`UPDATE boards SET slug = ?, name = ?, layout = ?, theme = ?, content = ?, ticker = ?,
       sort = ?, updated_at = ? WHERE id = ?`)
    .run(
      patch.slug ? uniqueSlug(patch.slug, id) : cur.slug,
      patch.name ?? cur.name,
      patch.layout ?? cur.layout,
      JSON.stringify(patch.theme ? { ...cur.theme, ...patch.theme } : cur.theme),
      JSON.stringify(content),
      patch.ticker ?? cur.ticker,
      patch.sort ?? cur.sort,
      now(), id
    );
  bumpRevision();
  return getBoard(id);
}

export function deleteBoard(id) {
  q('DELETE FROM boards WHERE id = ?').run(id);
  bumpRevision();
}

// ---------------------------------------------------------------- sections

export function listSections(boardId) {
  return q('SELECT * FROM sections WHERE board_id = ? ORDER BY sort').all(boardId);
}

export function createSection(boardId, data = {}) {
  const id = nid();
  const maxSort = q('SELECT COALESCE(MAX(sort), -1) AS m FROM sections WHERE board_id = ?').get(boardId).m;
  q(`INSERT INTO sections (id, board_id, name, kind, note, hidden, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, boardId, data.name || 'New section', data.kind || 'draft', data.note || '',
         data.hidden ? 1 : 0, maxSort + 1);
  bumpRevision();
  return q('SELECT * FROM sections WHERE id = ?').get(id);
}

export function updateSection(id, patch) {
  const cur = q('SELECT * FROM sections WHERE id = ?').get(id);
  if (!cur) return null;
  q('UPDATE sections SET name = ?, kind = ?, note = ?, hidden = ?, sort = ? WHERE id = ?')
    .run(patch.name ?? cur.name, patch.kind ?? cur.kind, patch.note ?? cur.note,
         patch.hidden === undefined ? cur.hidden : (patch.hidden ? 1 : 0),
         patch.sort ?? cur.sort, id);
  bumpRevision();
  return q('SELECT * FROM sections WHERE id = ?').get(id);
}

export function deleteSection(id) {
  q('DELETE FROM sections WHERE id = ?').run(id);
  bumpRevision();
}

// ---------------------------------------------------------------- items

const ITEM_FIELDS = ['tap', 'name', 'style', 'producer', 'origin', 'description',
                     'abv', 'ibu', 'color', 'image', 'badge', 'status', 'hidden', 'sort'];

function rowToItem(r) {
  if (!r) return null;
  return { ...r, hidden: !!r.hidden, prices: listPrices(r.id) };
}

export function listItems(sectionId) {
  return q('SELECT * FROM items WHERE section_id = ? ORDER BY sort').all(sectionId).map(rowToItem);
}

export function getItem(id) {
  return rowToItem(q('SELECT * FROM items WHERE id = ?').get(id));
}

export function createItem(sectionId, data = {}) {
  const id = nid();
  const maxSort = q('SELECT COALESCE(MAX(sort), -1) AS m FROM items WHERE section_id = ?').get(sectionId).m;
  q(`INSERT INTO items (id, section_id, tap, name, style, producer, origin, description,
                        abv, ibu, color, image, badge, status, hidden, sort, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, sectionId,
      str(data.tap), str(data.name) || 'New item', str(data.style), str(data.producer),
      str(data.origin), str(data.description),
      num(data.abv), int(data.ibu), data.color || null, data.image || null,
      str(data.badge), data.status || 'on', data.hidden ? 1 : 0, maxSort + 1, now());
  if (Array.isArray(data.prices)) replacePrices(id, data.prices);
  bumpRevision();
  return getItem(id);
}

export function updateItem(id, patch) {
  const cur = q('SELECT * FROM items WHERE id = ?').get(id);
  if (!cur) return null;
  const next = {};
  for (const f of ITEM_FIELDS) next[f] = patch[f] === undefined ? cur[f] : patch[f];
  q(`UPDATE items SET tap = ?, name = ?, style = ?, producer = ?, origin = ?, description = ?,
       abv = ?, ibu = ?, color = ?, image = ?, badge = ?, status = ?, hidden = ?, sort = ?, updated_at = ?
     WHERE id = ?`)
    .run(str(next.tap), str(next.name), str(next.style), str(next.producer), str(next.origin),
         str(next.description), num(next.abv), int(next.ibu), next.color || null, next.image || null,
         str(next.badge), next.status || 'on', next.hidden ? 1 : 0, int(next.sort) ?? 0, now(), id);
  if (Array.isArray(patch.prices)) replacePrices(id, patch.prices);
  bumpRevision();
  return getItem(id);
}

export function deleteItem(id) {
  q('DELETE FROM items WHERE id = ?').run(id);
  bumpRevision();
}

/** Move an item to a position (and possibly another section) in one shot. */
export function reorderItems(sectionId, orderedIds) {
  const stmt = q('UPDATE items SET section_id = ?, sort = ?, updated_at = ? WHERE id = ?');
  orderedIds.forEach((id, i) => stmt.run(sectionId, i, now(), id));
  bumpRevision();
}

export function reorderSections(boardId, orderedIds) {
  const stmt = q('UPDATE sections SET board_id = ?, sort = ? WHERE id = ?');
  orderedIds.forEach((id, i) => stmt.run(boardId, i, id));
  bumpRevision();
}

// ---------------------------------------------------------------- prices

export function listPrices(itemId) {
  return q('SELECT id, label, amount, sort FROM prices WHERE item_id = ? ORDER BY sort').all(itemId);
}

export function replacePrices(itemId, prices) {
  q('DELETE FROM prices WHERE item_id = ?').run(itemId);
  const stmt = q('INSERT INTO prices (id, item_id, label, amount, sort) VALUES (?, ?, ?, ?, ?)');
  prices
    .filter(p => p && (String(p.amount ?? '').trim() !== '' || String(p.label ?? '').trim() !== ''))
    .forEach((p, i) => stmt.run(nid(), itemId, str(p.label), str(p.amount), i));
}

// ---------------------------------------------------------------- playlists

export function listPlaylists() {
  return q('SELECT * FROM playlists ORDER BY sort, created_at').all()
    .map(p => ({ ...p, items: listPlaylistItems(p.id) }));
}

export function getPlaylist(id) {
  const row = q('SELECT * FROM playlists WHERE id = ?').get(id);
  return row ? { ...row, items: listPlaylistItems(row.id) } : null;
}

export function getPlaylistBySlug(slug) {
  const row = q('SELECT * FROM playlists WHERE slug = ?').get(slug);
  return row ? { ...row, items: listPlaylistItems(row.id) } : null;
}

export function uniquePlaylistSlug(base, ignoreId) {
  const stem = String(base || 'rotation').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'rotation';
  let candidate = stem, n = 2;
  for (;;) {
    const hit = q('SELECT id FROM playlists WHERE slug = ?').get(candidate);
    if (!hit || hit.id === ignoreId) return candidate;
    candidate = `${stem}-${n++}`;
  }
}

export function listPlaylistItems(playlistId) {
  return q(`SELECT pi.*, b.name AS board_name, b.layout AS board_layout, b.slug AS board_slug
            FROM playlist_items pi
            JOIN boards b ON b.id = pi.board_id
            WHERE pi.playlist_id = ?
            ORDER BY pi.sort`).all(playlistId);
}

export function createPlaylist(data = {}) {
  const id = nid();
  const t = now();
  const maxSort = q('SELECT COALESCE(MAX(sort), -1) AS m FROM playlists').get().m;
  q('INSERT INTO playlists (id, slug, name, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, uniquePlaylistSlug(data.slug || data.name), data.name || 'New rotation', maxSort + 1, t, t);
  bumpRevision();
  return getPlaylist(id);
}

export function updatePlaylist(id, patch) {
  const cur = getPlaylist(id);
  if (!cur) return null;
  q('UPDATE playlists SET slug = ?, name = ?, sort = ?, updated_at = ? WHERE id = ?')
    .run(patch.slug ? uniquePlaylistSlug(patch.slug, id) : cur.slug,
         patch.name ?? cur.name, patch.sort ?? cur.sort, now(), id);
  bumpRevision();
  return getPlaylist(id);
}

export function deletePlaylist(id) {
  q('DELETE FROM playlists WHERE id = ?').run(id);
  bumpRevision();
}

export function addPlaylistItem(playlistId, boardId, seconds) {
  const id = nid();
  const maxSort = q('SELECT COALESCE(MAX(sort), -1) AS m FROM playlist_items WHERE playlist_id = ?')
    .get(playlistId).m;
  q('INSERT INTO playlist_items (id, playlist_id, board_id, seconds, sort) VALUES (?, ?, ?, ?, ?)')
    .run(id, playlistId, boardId, clampSeconds(seconds), maxSort + 1);
  bumpRevision();
  return q('SELECT * FROM playlist_items WHERE id = ?').get(id);
}

export function updatePlaylistItem(id, patch) {
  const cur = q('SELECT * FROM playlist_items WHERE id = ?').get(id);
  if (!cur) return null;
  q('UPDATE playlist_items SET board_id = ?, seconds = ?, sort = ? WHERE id = ?')
    .run(patch.board_id ?? cur.board_id,
         patch.seconds === undefined ? cur.seconds : clampSeconds(patch.seconds),
         patch.sort ?? cur.sort, id);
  bumpRevision();
  return q('SELECT * FROM playlist_items WHERE id = ?').get(id);
}

export function deletePlaylistItem(id) {
  q('DELETE FROM playlist_items WHERE id = ?').run(id);
  bumpRevision();
}

export function reorderPlaylistItems(playlistId, orderedIds) {
  const stmt = q('UPDATE playlist_items SET playlist_id = ?, sort = ? WHERE id = ?');
  orderedIds.forEach((id, i) => stmt.run(playlistId, i, id));
  bumpRevision();
}

/** 5s floor stops a typo blanking a screen; 1h ceiling keeps the timer sane. */
function clampSeconds(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 30;
  return Math.min(3600, Math.max(5, n));
}

// ---------------------------------------------------------------- devices

export function listDevices() {
  return q('SELECT * FROM devices ORDER BY created_at DESC').all();
}

export function getDevice(id) {
  return q('SELECT * FROM devices WHERE id = ?').get(id);
}

export function getDeviceByCode(code) {
  return q('SELECT * FROM devices WHERE code = ?').get(String(code || '').toUpperCase());
}

function freshCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  for (;;) {
    const bytes = randomBytes(6);
    let code = '';
    for (let i = 0; i < 6; i++) code += alphabet[bytes[i] % alphabet.length];
    if (!q('SELECT id FROM devices WHERE code = ?').get(code)) return code;
  }
}

export function createDevice(agent = '') {
  const id = nid();
  q('INSERT INTO devices (id, code, name, agent, last_seen, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, freshCode(), '', String(agent).slice(0, 200), now(), now());
  bumpRevision();
  return getDevice(id);
}

export function updateDevice(id, patch) {
  const cur = getDevice(id);
  if (!cur) return null;
  // A screen plays one board or one rotation, so setting either clears the other.
  let boardId = patch.board_id === undefined ? cur.board_id : patch.board_id;
  let playlistId = patch.playlist_id === undefined ? cur.playlist_id : patch.playlist_id;
  if (patch.board_id) playlistId = null;
  if (patch.playlist_id) boardId = null;

  const orientation = patch.orientation === undefined ? cur.orientation : patch.orientation;
  if (orientation !== null && !['landscape', 'portrait', 'portraitLeft', 'auto'].includes(orientation)) throw new Error('Choose a valid screen orientation.');
  q('UPDATE devices SET name = ?, board_id = ?, playlist_id = ?, orientation = ? WHERE id = ?')
    .run(patch.name ?? cur.name, boardId || null, playlistId || null, orientation, id);
  bumpRevision();
  return getDevice(id);
}

export function touchDevice(id) {
  q('UPDATE devices SET last_seen = ? WHERE id = ?').run(now(), id);
}

// Build a private rotation for this TV. Never edit a shared rotation implicitly.
export function setDeviceContent(id, items) {
  const device = getDevice(id);
  if (!device) throw new Error('This TV is no longer paired. Refresh and try again.');
  if (!Array.isArray(items) || !items.length || items.length > 100) throw new Error('Choose between 1 and 100 items.');
  for (const item of items) {
    if (!getBoard(item.board_id)) throw new Error('One of these items no longer exists. Refresh and try again.');
    if (!Number.isInteger(item.seconds) || item.seconds < 5 || item.seconds > 3600) throw new Error('Enter a duration from 5 to 3600 seconds.');
  }
  if (items.length === 1) return updateDevice(id, { board_id: items[0].board_id });
  const playlist = createPlaylist({ name: (device.name || 'TV') + ' content' });
  for (const item of items) addPlaylistItem(playlist.id, item.board_id, item.seconds);
  return updateDevice(id, { playlist_id: playlist.id });
}

export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (err) { db.exec('ROLLBACK'); throw err; }
}

export function deleteDevice(id) {
  q('DELETE FROM devices WHERE id = ?').run(id);
  bumpRevision();
}

// ---------------------------------------------------------------- uploads

export function recordUpload(id, mime, bytes) {
  q('INSERT INTO uploads (id, mime, bytes, created_at) VALUES (?, ?, ?, ?)').run(id, mime, bytes, now());
  return { id, mime, bytes };
}

export function getUpload(id) {
  return q('SELECT * FROM uploads WHERE id = ?').get(id);
}

export function listUploads() {
  return q('SELECT * FROM uploads ORDER BY created_at DESC').all();
}

export function deleteUpload(id) {
  q('DELETE FROM uploads WHERE id = ?').run(id);
}

// ---------------------------------------------------------------- sessions

export function createSession(ttlMs) {
  const token = randomBytes(32).toString('base64url');
  q('INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)')
    .run(token, now(), now() + ttlMs);
  return token;
}

export function validSession(token) {
  if (!token) return false;
  const row = q('SELECT expires_at FROM sessions WHERE token = ?').get(token);
  if (!row) return false;
  if (row.expires_at < now()) { destroySession(token); return false; }
  return true;
}

export function destroySession(token) {
  q('DELETE FROM sessions WHERE token = ?').run(token);
}

export function purgeSessions() {
  q('DELETE FROM sessions WHERE expires_at < ?').run(now());
}

// ---------------------------------------------------------------- payloads

/** Everything the admin PWA needs in one request. */
export function fullState() {
  return {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    revision: getRevision(),
    settings: getSettings(),
    boards: listBoards().map(b => ({
      ...b,
      sections: listSections(b.id).map(s => ({ ...s, hidden: !!s.hidden, items: listItems(s.id) }))
    })),
    playlists: listPlaylists(),
    devices: listDevices()
  };
}

/** Read-only render payload for one board, with hidden rows already stripped. */
export function boardPayload(boardId) {
  const board = getBoard(boardId);
  if (!board) return null;
  const settings = getSettings();
  return {
    revision: getRevision(),
    venue: {
      name: settings.venue_name,
      tagline: settings.tagline,
      logo: settings.logo,
      currency: settings.currency
    },
    globalTheme: settings.theme,
    board: {
      id: board.id, slug: board.slug, name: board.name,
      layout: board.layout, theme: board.theme, ticker: board.ticker,
      content: board.content
    },
    sections: board.layout === 'poster' ? [] : listSections(board.id)
      .filter(s => !s.hidden)
      .map(s => ({
        id: s.id, name: s.name, kind: s.kind, note: s.note,
        items: listItems(s.id).filter(i => !i.hidden)
      }))
      .filter(s => s.items.length > 0 || s.note)
  };
}

// ---------------------------------------------------------------- coercion

function str(v) { return v === null || v === undefined ? '' : String(v); }
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function int(v) {
  const n = num(v);
  return n === null ? null : Math.round(n);
}
