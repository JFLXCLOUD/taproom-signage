import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import * as api from './api.js';
import * as store from './db.js';
import { json, text, sendFile, mimeFor } from './http.js';
import { UPLOAD_DIR } from './db.js';
import { maybeSeed } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

// Opt-in, for the Raspberry Pi image where this box IS the Wi-Fi network.
// Phones probe a known URL on joining; answering with a redirect makes them pop
// the admin app open by themselves, so nobody has to type an address.
//
// Off by default and it must stay that way: when the Pi passes real internet
// through to the screens, hijacking these probes would make every device on the
// network believe it is offline.
const CAPTIVE_PORTAL = process.env.CAPTIVE_PORTAL === '1';

const PROBE_PATHS = new Set([
  '/generate_204',              // Android
  '/gen_204',
  '/hotspot-detect.html',       // Apple
  '/library/test/success.html',
  '/ncsi.txt',                  // Windows
  '/connecttest.txt',
  '/success.txt',               // Firefox
  '/canonical.html'
]);

// ------------------------------------------------------------------ routes

/** [method, path pattern, handler, requiresAuth] — :params become named groups. */
const routes = [
  ['GET',    '/api/health',            (q, s) => json(s, 200, { ok: true, revision: store.getRevision(), displays: api.clientCount() }), false],
  ['GET',    '/api/events',            api.handleEvents,   false],
  ['GET',    '/api/revision',          api.getRevision,    false],

  ['POST',   '/api/auth/login',        api.login,          false],
  ['POST',   '/api/auth/logout',       api.logout,         false],
  ['GET',    '/api/auth/me',           api.me,             false],

  // Public read paths — the displays use these, and a TV can't hold a login.
  ['GET',    '/api/board/:slug',       api.getBoardPayload, false],
  ['GET',    '/api/playlist/:slug',    api.getPlaylistPayload, false],
  ['POST',   '/api/device/register',   api.registerDevice,  false],
  ['GET',    '/api/device/:id',        api.resolveDevice,   false],

  ['GET',    '/api/state',             api.getState,       true],
  ['POST',   '/api/settings',          api.patchSettings,  true],

  ['GET',    '/api/devices',           api.listDevices,    true],
  ['POST',   '/api/devices/claim',     api.claimDevice,    true],
  ['POST',   '/api/devices/command',   api.commandDevices, true],
  ['PATCH',  '/api/devices/:id',       api.patchDevice,    true],
  ['DELETE', '/api/devices/:id',       api.removeDevice,   true],

  ['POST',   '/api/boards',            api.createBoard,    true],
  ['PATCH',  '/api/boards/:id',        api.patchBoard,     true],
  ['DELETE', '/api/boards/:id',        api.removeBoard,    true],
  ['POST',   '/api/boards/:id/sections', api.createSection, true],

  ['PATCH',  '/api/sections/:id',      api.patchSection,   true],
  ['DELETE', '/api/sections/:id',      api.removeSection,  true],
  ['POST',   '/api/sections/:id/items', api.createItem,    true],

  ['PATCH',  '/api/items/:id',         api.patchItem,      true],
  ['DELETE', '/api/items/:id',         api.removeItem,     true],
  ['POST',   '/api/items/:id/duplicate', api.duplicateItem, true],

  ['POST',   '/api/playlists',         api.createPlaylist,    true],
  ['PATCH',  '/api/playlists/:id',     api.patchPlaylist,     true],
  ['DELETE', '/api/playlists/:id',     api.removePlaylist,    true],
  ['POST',   '/api/playlists/:id/items', api.addPlaylistItem, true],
  ['PATCH',  '/api/scenes/:id',        api.patchPlaylistItem, true],
  ['DELETE', '/api/scenes/:id',        api.removePlaylistItem, true],

  ['POST',   '/api/reorder',           api.reorder,        true],
  ['POST',   '/api/uploads',           api.upload,         true],
  ['DELETE', '/api/uploads/:id',       api.removeUpload,   true],

  ['GET',    '/api/export',            api.exportAll,      true],
  ['POST',   '/api/import',            api.importAll,      true]
].map(([method, pattern, handler, auth]) => ({
  method,
  auth,
  handler,
  regex: new RegExp('^' + pattern.replace(/:([A-Za-z]+)/g, '(?<$1>[^/]+)') + '$')
}));

// ------------------------------------------------------------------ server

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = decodeURIComponent(url.pathname);

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');

  try {
    // --- API -------------------------------------------------------------
    for (const route of routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      if (route.method !== req.method) continue;
      if (route.auth && !api.isAuthed(req)) return json(res, 401, { error: 'Not signed in' });
      return await route.handler(req, res, m.groups || {}, url);
    }

    // --- captive portal ---------------------------------------------------
    if (CAPTIVE_PORTAL && PROBE_PATHS.has(pathname.toLowerCase())) {
      res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' });
      return res.end();
    }

    // --- uploaded images (content-addressed, cache forever) ---------------
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (pathname.startsWith('/u/')) {
        const name = pathname.slice(3);
        if (!/^[A-Za-z0-9._-]+$/.test(name)) return text(res, 400, 'Bad name');
        return sendFile(req, res, path.join(UPLOAD_DIR, name), { immutable: true });
      }

      // --- display views -------------------------------------------------
      if (pathname === '/display' || pathname === '/display/' ||
          pathname.startsWith('/d/') || pathname.startsWith('/p/')) {
        return sendFile(req, res, path.join(PUBLIC, 'display', 'index.html'));
      }

      // --- admin PWA -----------------------------------------------------
      if (pathname === '/' || pathname === '/admin' || pathname === '/admin/') {
        return sendFile(req, res, path.join(PUBLIC, 'index.html'));
      }

      // --- static assets -------------------------------------------------
      const safe = path.normalize(pathname).replace(/^([/\\])+/, '');
      const file = path.join(PUBLIC, safe);
      if (!file.startsWith(PUBLIC)) return text(res, 403, 'Forbidden');
      if (existsSync(file)) {
        return sendFile(req, res, file, { mime: mimeFor(file) });
      }
      // Unknown non-asset path: let the admin PWA route it client-side.
      if (!path.extname(safe)) return sendFile(req, res, path.join(PUBLIC, 'index.html'));
    }

    text(res, 404, 'Not found');
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    if (status >= 500) console.error('[error]', req.method, pathname, err);
    if (!res.headersSent) json(res, status, { error: err?.message || 'Server error' });
    else res.end();
  }
});

// Displays hold an SSE connection open indefinitely; don't let Node reap them.
server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;
server.requestTimeout = 0;

store.purgeSessions();
setInterval(() => store.purgeSessions(), 1000 * 60 * 60).unref();

maybeSeed();

server.listen(PORT, HOST, () => {
  const pw = process.env.ADMIN_PASSWORD;
  console.log('');
  console.log('  Taproom Signage');
  console.log('  ───────────────────────────────────────────');
  console.log(`  Admin PWA   http://localhost:${PORT}/`);
  console.log(`  Display     http://localhost:${PORT}/display`);
  console.log(`  Data dir    ${store.DATA_DIR}`);
  if (CAPTIVE_PORTAL) console.log('  Captive portal ON (probe URLs redirect to the admin app)');
  if (!pw || pw === 'changeme') {
    console.log('');
    console.log('  ⚠  ADMIN_PASSWORD is unset (default: "changeme").');
    console.log('     Set it before exposing this beyond your LAN.');
  }
  console.log('');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\nShutting down…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
