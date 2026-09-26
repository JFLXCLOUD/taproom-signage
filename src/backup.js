import { readFileSync, writeFileSync, existsSync, unlinkSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as store from './db.js';

export const BACKUP_LIMIT = 128 * 1024 * 1024;
const IMAGE_LIMIT = 4 * 1024 * 1024;
const TOTAL_IMAGES = 64 * 1024 * 1024;
const extensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const text = (v, fallback = '') => v == null ? fallback : typeof v === 'string' ? v : fail('Invalid text in backup.');
const array = (v, label) => Array.isArray(v) ? v : fail(`Missing or invalid ${label}.`);
const number = (v, fallback = 0) => v == null ? fallback : typeof v === 'number' && Number.isFinite(v) ? v : fail('Invalid number in backup.');
const integer = (v, fallback = 0) => { const n = number(v, fallback); return n === null || Number.isSafeInteger(n) ? n : fail('Invalid integer in backup.'); };
const jsonObject = (v, fallback = {}) => v == null ? fallback : object(v) ? v : fail('Invalid settings or poster content.');
const bool = v => v === true || v === 1 ? 1 : v === false || v === 0 || v == null ? 0 : fail('Invalid visibility in backup.');
const id = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v) ? v : fail('Invalid record ID in backup.');
const imageId = v => typeof v === 'string' && /^[a-f0-9]{16}\.(png|jpg|webp|gif)$/.test(v) ? v : fail('Invalid image name in backup.');

function readImage(name) {
  const file = path.join(store.UPLOAD_DIR, imageId(name));
  if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) fail(`Image ${name} is missing. Restore its file before backing up.`);
  return readFileSync(file);
}

export function exportBackup() {
  const state = store.fullState();
  let total = 0;
  const uploads = store.listUploads().map(rec => {
    const bytes = readImage(rec.id);
    total += bytes.length;
    if (bytes.length > IMAGE_LIMIT || total > TOTAL_IMAGES) fail('Images exceed the backup size limit (4 MB each, 64 MB total).');
    return { ...rec, bytes: bytes.length, sha256: hash(bytes), data: bytes.toString('base64') };
  });
  const backup = { version: 2, exportedAt: new Date().toISOString(), ...state, uploads };
  // Reject dangling references rather than advertise an incomplete backup.
  prepareBackup(backup, 'replace');
  const payload = JSON.stringify(backup);
  if (Buffer.byteLength(payload) > BACKUP_LIMIT) fail('Backup exceeds the 128 MB limit.');
  return payload;
}

export function prepareBackup(body, mode = 'append') {
  if (!object(body) || ![1, 2].includes(body.version)) fail('Choose a supported Taproom backup (version 1 or 2).');
  if (!['append', 'replace'].includes(mode)) fail('Choose Add content or Replace everything.');
  const replace = mode === 'replace';
  const warnings = body.version === 1 ? ['This older backup has no image files. Images must already exist on this server.'] : [];
  const tables = { boards: [], sections: [], items: [], prices: [], playlists: [], playlist_items: [], devices: [] };
  const seen = Object.fromEntries(Object.keys(tables).map(t => [t, new Set()]));
  const maps = { boards: new Map(), playlists: new Map() };
  const images = [], imageMap = new Map();
  let total = 0;
  for (const asset of array(body.uploads ?? (body.version === 1 ? [] : null), 'images')) {
    if (!object(asset)) fail('Invalid image record.');
    const old = imageId(asset.id);
    if (imageMap.has(old)) fail('Duplicate image in backup.');
    if (!extensions[asset.mime] || !old.endsWith(extensions[asset.mime])) fail('Unsupported image type in backup.');
    if (typeof asset.data !== 'string' || asset.data.length > Math.ceil(IMAGE_LIMIT / 3) * 4) fail('Invalid or oversized image data.');
    const bytes = Buffer.from(asset.data, 'base64');
    if (bytes.toString('base64') !== asset.data) fail('Invalid image data.');
    total += bytes.length;
    if (!bytes.length || bytes.length > IMAGE_LIMIT || total > TOTAL_IMAGES) fail('Images exceed the backup size limit (4 MB each, 64 MB total).');
    if (asset.bytes !== bytes.length || asset.sha256 !== hash(bytes)) fail(`Image verification failed: ${old}`);
    let name = old;
    const file = path.join(store.UPLOAD_DIR, old);
    // Never overwrite an existing immutable image URL with different bytes.
    if (existsSync(file) && hash(readImage(old)) !== asset.sha256) name = store.nid() + extensions[asset.mime];
    imageMap.set(old, name);
    images.push({ id: name, mime: asset.mime, bytes, created_at: integer(asset.created_at, store.now()) });
  }
  const imageRef = value => {
    if (!value) return null;
    const name = imageId(value);
    if (imageMap.has(name)) return imageMap.get(name);
    if (body.version === 1 && store.getUpload(name)) { readImage(name); return name; }
    fail(`Backup is missing image ${name}. Copy the image files or use a complete backup.`);
  };
  const recordId = (table, old) => {
    id(old);
    if (seen[table].has(old)) fail(`Duplicate ${table} ID in backup.`);
    seen[table].add(old);
    const next = replace ? old : store.nid();
    maps[table]?.set(old, next);
    return next;
  };
  const slugSets = {
    boards: new Set(replace ? [] : store.listBoards().map(b => b.slug)),
    playlists: new Set(replace ? [] : store.listPlaylists().map(p => p.slug))
  };
  const slug = (table, value) => {
    const stem = text(value);
    if (!/^[a-zA-Z0-9_-]{1,150}$/.test(stem)) fail('Invalid menu or rotation address.');
    let result = stem, n = 2;
    if (replace && slugSets[table].has(stem)) fail('Duplicate menu or rotation address.');
    while (slugSets[table].has(result)) result = `${stem}-${n++}`;
    slugSets[table].add(result);
    return result;
  };
  for (const b of array(body.boards, 'menus')) {
    if (!object(b)) fail('Invalid menu.');
    const boardId = recordId('boards', b.id);
    const content = { ...jsonObject(b.content) };
    if (content.image) content.image = imageRef(content.image);
    // Preserve the source timezone and absolute expiry, not this server's timezone.
    if (content.expiresAt != null) number(content.expiresAt);
    tables.boards.push({ id: boardId, slug: slug('boards', b.slug), name: text(b.name), layout: text(b.layout, 'grid'), theme: JSON.stringify(jsonObject(b.theme)), content: JSON.stringify(content), ticker: text(b.ticker), sort: integer(b.sort), created_at: integer(b.created_at), updated_at: integer(b.updated_at) });
    for (const s of array(b.sections ?? [], 'sections')) {
      if (!object(s)) fail('Invalid section.');
      const sectionId = recordId('sections', s.id);
      tables.sections.push({ id: sectionId, board_id: boardId, name: text(s.name), kind: text(s.kind, 'custom'), note: text(s.note), hidden: bool(s.hidden), sort: integer(s.sort) });
      for (const item of array(s.items ?? [], 'items')) {
        if (!object(item)) fail('Invalid item.');
        const row = { id: recordId('items', item.id), section_id: sectionId };
        for (const key of ['tap', 'name', 'style', 'producer', 'origin', 'description', 'badge']) row[key] = text(item[key]);
        Object.assign(row, { abv: number(item.abv, null), ibu: integer(item.ibu, null), color: text(item.color, null), image: imageRef(item.image), status: text(item.status, 'on'), hidden: bool(item.hidden), sort: integer(item.sort), updated_at: integer(item.updated_at) });
        tables.items.push(row);
        for (const p of array(item.prices ?? [], 'prices')) {
          if (!object(p)) fail('Invalid price.');
          tables.prices.push({ id: recordId('prices', p.id), item_id: row.id, label: text(p.label), amount: text(p.amount), sort: integer(p.sort) });
        }
      }
    }
  }
  for (const p of array(body.playlists ?? [], 'rotations')) {
    if (!object(p)) fail('Invalid rotation.');
    const playlistId = recordId('playlists', p.id);
    tables.playlists.push({ id: playlistId, slug: slug('playlists', p.slug), name: text(p.name), sort: integer(p.sort), created_at: integer(p.created_at), updated_at: integer(p.updated_at) });
    for (const scene of array(p.items ?? [], 'rotation content')) {
      if (!object(scene)) fail('Invalid rotation content.');
      const boardId = maps.boards.get(scene.board_id);
      if (!boardId) fail('Rotation refers to a missing menu or poster.');
      const seconds = integer(scene.seconds);
      if (seconds < 5 || seconds > 3600) fail('Invalid rotation duration.');
      tables.playlist_items.push({ id: recordId('playlist_items', scene.id), playlist_id: playlistId, board_id: boardId, seconds, sort: integer(scene.sort) });
    }
  }
  const codes = new Set();
  for (const d of array(body.devices ?? [], 'TVs')) {
    if (!object(d)) fail('Invalid TV.');
    const deviceId = recordId('devices', d.id);
    const boardId = d.board_id ? maps.boards.get(d.board_id) : null;
    const playlistId = d.playlist_id ? maps.playlists.get(d.playlist_id) : null;
    if ((d.board_id && !boardId) || (d.playlist_id && !playlistId) || (boardId && playlistId)) fail('TV refers to missing or conflicting content.');
    if (d.code != null && (typeof d.code !== 'string' || !/^[A-Z0-9]{6}$/.test(d.code) || codes.has(d.code))) fail('Invalid or duplicate TV pairing code.');
    codes.add(d.code);
    if (d.orientation != null && !['landscape','portrait','portraitLeft','auto'].includes(d.orientation)) fail('Invalid TV orientation.');
    if (replace) tables.devices.push({ id: deviceId, code: d.code ?? null, name: text(d.name), board_id: boardId, playlist_id: playlistId, orientation: d.orientation ?? null, agent: text(d.agent), last_seen: 0, created_at: integer(d.created_at) });
  }
  const settings = jsonObject(body.settings);
  const settingsRow = { id: 1, venue_name: text(settings.venue_name, 'My Bar'), tagline: text(settings.tagline), logo: imageRef(settings.logo), theme: JSON.stringify(jsonObject(settings.theme)), currency: text(settings.currency, '$'), updated_at: store.now() };
  if (!replace) warnings.push('Add content keeps the current venue settings and TV assignments.');
  return { mode, tables, images, settings: settingsRow, warnings, counts: { menus: tables.boards.filter(b => b.layout !== 'poster').length, posters: tables.boards.filter(b => b.layout === 'poster').length, items: tables.items.length, rotations: tables.playlists.length, tvs: tables.devices.length, images: images.length } };
}

export function restoreBackup(body, mode) {
  const plan = prepareBackup(body, mode);
  const createdFiles = [];
  const insert = (table, row) => {
    const keys = Object.keys(row);
    store.db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(row));
  };
  try {
    store.transaction(() => {
      for (const image of plan.images) {
        const file = path.join(store.UPLOAD_DIR, image.id);
        if (!existsSync(file)) { writeFileSync(file, image.bytes, { flag: 'wx' }); createdFiles.push(file); }
      }
      if (mode === 'replace') {
        // Sessions and server password/port are intentionally not part of backups.
        store.db.exec('DELETE FROM devices; DELETE FROM playlists; DELETE FROM boards; DELETE FROM settings;');
        insert('settings', plan.settings);
      }
      for (const [table, rows] of Object.entries(plan.tables)) for (const row of rows) insert(table, row);
      for (const image of plan.images) {
        if (!store.getUpload(image.id)) insert('uploads', { id: image.id, mime: image.mime, bytes: image.bytes.length, created_at: image.created_at });
      }
      store.bumpRevision();
    });
  } catch (err) {
    for (const file of createdFiles) { try { unlinkSync(file); } catch { /* leave harmless unreferenced file if cleanup fails */ } }
    throw err;
  }
  return { ok: true, ...plan.counts, warnings: plan.warnings };
}
