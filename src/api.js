import { writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';

import * as store from './db.js';
import { UPLOAD_DIR, nid } from './db.js';
import { json, readJson, parseCookies, setCookie } from './http.js';
import { resolveTheme } from '../public/shared/theme.js';
import { posterExpired } from '../public/shared/poster-expiry.js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days — bartenders shouldn't re-login nightly
const COOKIE = 'sig_session';

// ------------------------------------------------------------------ SSE bus

const clients = new Set();

export function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(frame); } catch { clients.delete(res); }
  }
}

/** Called after every mutation so displays repaint within ~50ms. */
function changed() {
  broadcast('revision', { revision: store.getRevision() });
}

export function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  // 2kB pad: some proxies (and Silk) won't flush a tiny first chunk.
  res.write(':' + ' '.repeat(2048) + '\n\n');
  res.write(`retry: 3000\n\n`);
  res.write(`event: revision\ndata: ${JSON.stringify({ revision: store.getRevision() })}\n\n`);

  clients.add(res);

  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* closed */ }
  }, 25000);

  const close = () => { clearInterval(ping); clients.delete(res); };
  req.on('close', close);
  req.on('error', close);
}

export function clientCount() { return clients.size; }

// ------------------------------------------------------------------ auth

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function isAuthed(req) {
  return store.validSession(parseCookies(req)[COOKIE]);
}

export async function login(req, res) {
  const body = await readJson(req, 4096);
  if (!safeEqual(body.password || '', ADMIN_PASSWORD)) {
    // Blunt throttle: makes remote brute-forcing impractical without extra state.
    await new Promise(r => setTimeout(r, 600));
    return json(res, 401, { error: 'Incorrect password' });
  }
  const token = store.createSession(SESSION_TTL);
  setCookie(res, COOKIE, token, { maxAge: SESSION_TTL });
  json(res, 200, { ok: true });
}

export function logout(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) store.destroySession(token);
  setCookie(res, COOKIE, '', { maxAge: 0 });
  json(res, 200, { ok: true });
}

export function me(req, res) {
  json(res, 200, {
    authed: isAuthed(req),
    defaultPassword: ADMIN_PASSWORD === 'changeme'
  });
}

// ------------------------------------------------------------------ reads

export function getState(req, res) {
  json(res, 200, store.fullState());
}

export function getRevision(req, res) {
  json(res, 200, { revision: store.getRevision() });
}

export function getBoardPayload(req, res, { slug }) {
  const board = store.getBoardBySlug(slug) || store.getBoard(slug);
  if (!board) return json(res, 404, { error: 'No such board' });
  json(res, 200, withTheme(store.boardPayload(board.id)));
}

function withTheme(payload) {
  if (!payload) return payload;
  if (posterExpired(payload.board)) return { type: 'empty', reason: 'expired', revision: payload.revision, venue: payload.venue, theme: resolveTheme(payload.globalTheme, payload.board.theme) };
  return { ...payload, type: 'board', theme: resolveTheme(payload.globalTheme, payload.board.theme) };
}

/**
 * A rotation is sent as a list of fully-resolved scenes. Each scene is exactly
 * the shape the display already renders for a single board, so the player just
 * hands them to the same renderer in turn - and the whole rotation arrives in
 * one request, so a screen never goes blank waiting on the next scene.
 */
function playlistPayload(playlist) {
  const scenes = [];
  for (const item of playlist.items) {
    const board = store.boardPayload(item.board_id);
    if (!board || posterExpired(board.board)) continue;
    scenes.push({ sceneId: item.id, seconds: item.seconds, ...withTheme(board) });
  }
  return {
    type: 'playlist',
    revision: store.getRevision(),
    playlist: { id: playlist.id, slug: playlist.slug, name: playlist.name },
    scenes
  };
}

export function getPlaylistPayload(req, res, { slug }) {
  const playlist = store.getPlaylistBySlug(slug) || store.getPlaylist(slug);
  if (!playlist) return json(res, 404, { error: 'No such rotation' });
  json(res, 200, playlistPayload(playlist));
}

// ------------------------------------------------------------------ devices

/** A display with no ?board= registers itself and shows a pairing code. */
export async function registerDevice(req, res) {
  const body = await readJson(req, 4096);
  let device = body.id ? store.getDevice(body.id) : null;
  if (!device) device = store.createDevice(req.headers['user-agent'] || '');
  json(res, 200, { device });
}

/** Display polls/refetches this: either "unpaired + code" or the full board payload. */
export function resolveDevice(req, res, { id, preview }) {
  const device = store.getDevice(id);
  if (!device) return json(res, 404, { error: 'Unknown device' });
  if (!preview) store.touchDevice(id);

  const unpaired = () => {
    const settings = store.getSettings();
    return json(res, 200, {
      paired: false,
      code: device.code,
      device: { id: device.id, name: device.name },
      venue: { name: settings.venue_name, logo: settings.logo },
      theme: resolveTheme(settings.theme, {}),
      revision: store.getRevision()
    });
  };

  const who = { id: device.id, name: device.name, orientation: device.orientation };
  const forTV = payload => device.orientation ? { ...payload, theme: { ...payload.theme, orientation: device.orientation } } : payload;

  if (device.playlist_id) {
    const playlist = store.getPlaylist(device.playlist_id);
    const payload = playlist ? playlistPayload(playlist) : null;
    if (!payload) return unpaired();
    return json(res, 200, { paired: true, device: who, ...payload, scenes: payload.scenes.map(forTV) });
  }

  if (!device.board_id) return unpaired();

  const payload = store.boardPayload(device.board_id);
  if (!payload) return unpaired();
  json(res, 200, { paired: true, device: who, ...forTV(withTheme(payload)) });
}

export function listDevices(req, res) {
  json(res, 200, { devices: store.listDevices() });
}

export async function claimDevice(req, res) {
  const body = await readJson(req, 4096);
  const device = store.getDeviceByCode(body.code);
  if (!device) return json(res, 404, { error: 'No screen with that code' });
  const updated = store.updateDevice(device.id, {
    board_id: body.board_id || null,
    playlist_id: body.playlist_id || null,
    name: body.name || device.name || 'Screen',
    orientation: body.orientation === undefined ? device.orientation : body.orientation
  });
  changed();
  json(res, 200, { device: updated });
}

export async function patchDevice(req, res, { id }) {
  const body = await readJson(req, 4096);
  if (body.orientation !== undefined && body.orientation !== null && !['landscape', 'portrait', 'portraitLeft', 'auto'].includes(body.orientation)) return json(res, 400, { error: 'Choose a valid screen orientation.' });
  const device = store.updateDevice(id, body);
  if (!device) return json(res, 404, { error: 'Unknown device' });
  changed();
  json(res, 200, { device });
}

export async function publishContent(req, res) {
  const body = await readJson(req);
  let result;
  try {
    result = store.transaction(() => {
      if (!Array.isArray(body.deviceIds) || body.deviceIds.length > 100) throw new Error('Choose the TVs to update.');
      const ids = [...new Set(body.deviceIds)];
      for (const id of ids) if (!store.getDevice(id)) throw new Error('A selected TV is no longer paired.');
      if (body.poster || body.boardId) {
        if (body.poster && !String(body.poster.name || '').trim()) throw new Error('Give the poster a name.');
        if (body.poster && !body.poster.content?.image && !String(body.poster.content?.headline || '').trim()) throw new Error('Add artwork or an event title.');
        if (!['append', 'replace'].includes(body.mode)) throw new Error('Choose how to show the poster.');
        const board = body.poster ? store.createBoard({ ...body.poster, layout: 'poster' }) : store.getBoard(body.boardId);
        if (!board) throw new Error('This menu or poster no longer exists.');
        for (const id of ids) {
          const device = store.getDevice(id);
          const previous = body.mode === 'append'
            ? device.playlist_id ? (store.getPlaylist(device.playlist_id)?.items || [])
              : device.board_id ? [{ board_id: device.board_id, seconds: 120 }] : []
            : [];
          store.setDeviceContent(id, [...previous.filter(i => i.board_id !== board.id), { board_id: board.id, seconds: body.seconds }]);
        }
        return { board };
      }
      if (!ids.length) throw new Error('Choose a TV.');
      for (const id of ids) store.setDeviceContent(id, body.items);
      return { ok: true };
    });
  } catch (err) { return json(res, 400, { error: err.message }); }
  changed();
  json(res, 200, result);
}

export function removeDevice(req, res, { id }) {
  store.deleteDevice(id);
  changed();
  json(res, 200, { ok: true });
}

/** Push a one-off command (reload / identify) to every display. */
export async function commandDevices(req, res) {
  const body = await readJson(req, 4096);
  broadcast('command', { action: body.action || 'reload', deviceId: body.deviceId || null });
  json(res, 200, { ok: true, delivered: clients.size });
}

// ------------------------------------------------------------------ settings

export async function patchSettings(req, res) {
  const body = await readJson(req);
  const settings = store.updateSettings(body);
  changed();
  json(res, 200, { settings });
}

// ------------------------------------------------------------------ boards

export async function createBoard(req, res) {
  const body = await readJson(req);
  const board = store.createBoard(body);
  // A brand-new board with no sections renders as an empty screen; give it one.
  if (!body.skipDefaultSection) store.createSection(board.id, { name: body.sectionName || 'On Draft', kind: 'draft' });
  changed();
  json(res, 200, { board: store.getBoard(board.id) });
}

export async function patchBoard(req, res, { id }) {
  const body = await readJson(req);
  const board = store.updateBoard(id, body);
  if (!board) return json(res, 404, { error: 'No such board' });
  changed();
  json(res, 200, { board });
}

export function removeBoard(req, res, { id }) {
  store.deleteBoard(id);
  changed();
  json(res, 200, { ok: true });
}

// ------------------------------------------------------------------ sections

export async function createSection(req, res, { id }) {
  const body = await readJson(req);
  if (!store.getBoard(id)) return json(res, 404, { error: 'No such board' });
  const section = store.createSection(id, body);
  changed();
  json(res, 200, { section });
}

export async function patchSection(req, res, { id }) {
  const body = await readJson(req);
  const section = store.updateSection(id, body);
  if (!section) return json(res, 404, { error: 'No such section' });
  changed();
  json(res, 200, { section });
}

export function removeSection(req, res, { id }) {
  store.deleteSection(id);
  changed();
  json(res, 200, { ok: true });
}

// ------------------------------------------------------------------ items

export async function createItem(req, res, { id }) {
  const body = await readJson(req);
  const item = store.createItem(id, body);
  changed();
  json(res, 200, { item });
}

export async function patchItem(req, res, { id }) {
  const body = await readJson(req);
  const item = store.updateItem(id, body);
  if (!item) return json(res, 404, { error: 'No such item' });
  changed();
  json(res, 200, { item });
}

export function removeItem(req, res, { id }) {
  store.deleteItem(id);
  changed();
  json(res, 200, { ok: true });
}

export function duplicateItem(req, res, { id }) {
  const src = store.getItem(id);
  if (!src) return json(res, 404, { error: 'No such item' });
  const copy = store.createItem(src.section_id, {
    ...src, tap: '', name: src.name + ' (copy)', prices: src.prices
  });
  changed();
  json(res, 200, { item: copy });
}

export async function reorder(req, res) {
  const body = await readJson(req);
  if (body.kind === 'sections') store.reorderSections(body.parentId, body.ids || []);
  else if (body.kind === 'scenes') store.reorderPlaylistItems(body.parentId, body.ids || []);
  else store.reorderItems(body.parentId, body.ids || []);
  changed();
  json(res, 200, { ok: true });
}

// ------------------------------------------------------------------ rotations

export async function createPlaylist(req, res) {
  const body = await readJson(req);
  const playlist = store.createPlaylist(body);
  changed();
  json(res, 200, { playlist });
}

export async function patchPlaylist(req, res, { id }) {
  const body = await readJson(req);
  const playlist = store.updatePlaylist(id, body);
  if (!playlist) return json(res, 404, { error: 'No such rotation' });
  changed();
  json(res, 200, { playlist });
}

export function removePlaylist(req, res, { id }) {
  store.deletePlaylist(id);
  changed();
  json(res, 200, { ok: true });
}

export async function addPlaylistItem(req, res, { id }) {
  const body = await readJson(req);
  if (!store.getPlaylist(id)) return json(res, 404, { error: 'No such rotation' });
  if (!store.getBoard(body.board_id)) return json(res, 400, { error: 'Pick a board to show' });
  const item = store.addPlaylistItem(id, body.board_id, body.seconds);
  changed();
  json(res, 200, { item });
}

export async function patchPlaylistItem(req, res, { id }) {
  const body = await readJson(req);
  const item = store.updatePlaylistItem(id, body);
  if (!item) return json(res, 404, { error: 'No such scene' });
  changed();
  json(res, 200, { item });
}

export function removePlaylistItem(req, res, { id }) {
  store.deletePlaylistItem(id);
  changed();
  json(res, 200, { ok: true });
}

// ------------------------------------------------------------------ uploads

const ALLOWED_IMAGE = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif'
};
const MAX_UPLOAD = 4 * 1024 * 1024;

export async function upload(req, res) {
  const body = await readJson(req, 12 * 1024 * 1024);
  const m = /^data:([a-z0-9/+.-]+);base64,(.*)$/i.exec(String(body.dataUrl || ''));
  if (!m) return json(res, 400, { error: 'Expected a base64 data URL' });

  const mime = m[1].toLowerCase();
  const ext = ALLOWED_IMAGE[mime];
  // SVG is deliberately excluded: it executes script when served same-origin.
  if (!ext) return json(res, 415, { error: 'Use PNG, JPEG, WebP or GIF' });

  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) return json(res, 400, { error: 'Empty image' });
  if (buf.length > MAX_UPLOAD) {
    return json(res, 413, { error: `Image is ${(buf.length / 1048576).toFixed(1)}MB; limit is 4MB` });
  }

  const id = nid() + ext;
  writeFileSync(path.join(UPLOAD_DIR, id), buf);
  store.recordUpload(id, mime, buf.length);
  json(res, 200, { id, url: '/u/' + id, bytes: buf.length });
}

export function removeUpload(req, res, { id }) {
  const rec = store.getUpload(id);
  if (rec) {
    try { unlinkSync(path.join(UPLOAD_DIR, id)); } catch { /* already gone */ }
    store.deleteUpload(id);
  }
  json(res, 200, { ok: true });
}

// ------------------------------------------------------------------ backup

export function exportAll(req, res) {
  const data = { version: 1, exportedAt: new Date().toISOString(), ...store.fullState() };
  const payload = JSON.stringify(data, null, 2);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="signage-backup-${Date.now()}.json"`,
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

export async function importAll(req, res) {
  const body = await readJson(req, 32 * 1024 * 1024);
  if (!body || !Array.isArray(body.boards)) return json(res, 400, { error: 'Not a backup file' });

  if (body.settings) {
    store.updateSettings({
      venue_name: body.settings.venue_name,
      tagline: body.settings.tagline,
      logo: body.settings.logo,
      currency: body.settings.currency,
      theme: body.settings.theme
    });
  }
  if (body.replace) for (const b of store.listBoards()) store.deleteBoard(b.id);

  for (const b of body.boards) {
    const board = store.createBoard({
      name: b.name, slug: b.slug, layout: b.layout, theme: b.theme, ticker: b.ticker,
      skipDefaultSection: true
    });
    for (const s of b.sections || []) {
      const section = store.createSection(board.id, { name: s.name, kind: s.kind, note: s.note, hidden: s.hidden });
      for (const it of s.items || []) store.createItem(section.id, it);
    }
  }
  changed();
  json(res, 200, { ok: true, boards: store.listBoards().length });
}

export { changed };
