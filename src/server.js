import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, writeFileSync } from 'node:fs';

import * as api from './api.js';
import * as store from './db.js';
import { json, text, sendFile, mimeFor } from './http.js';
import { UPLOAD_DIR } from './db.js';
import { maybeSeed } from './seed.js';
import { startDiscovery } from './discovery.js';

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

/** Health is public, so it must never throw on a half-initialised database. */
function safeVenueName() {
  try { return store.getSettings().venue_name; } catch { return 'Taproom'; }
}

/** [method, path pattern, handler, requiresAuth] — :params become named groups. */
const routes = [
  ['GET',    '/api/health',            (q, s) => json(s, 200, {
    ok: true, app: 'taproom-signage', name: safeVenueName(),
    revision: store.getRevision(), displays: api.clientCount()
  }), false],
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

/**
 * Bind, stepping to the next port if this one is taken or reserved.
 *
 * Windows reserves whole port ranges (Hyper-V and WinNAT do this), so a fixed
 * 8080 fails outright on plenty of machines with EACCES rather than EADDRINUSE.
 * Drifting the port is safe here because nothing hard-codes it: screens find the
 * server over UDP discovery, which advertises whatever port we actually got.
 */
function listenWithFallback(startPort, attemptsLeft) {
  // Both listeners must come off before retrying. Leaving the 'listening' one
  // attached means the failed attempt's callback also fires when a later port
  // succeeds - which announced two ports and had discovery advertising the dead
  // one, so screens could be handed a port nothing is listening on.
  const cleanup = () => {
    server.removeListener('error', onError);
    server.removeListener('listening', onOk);
  };

  const onError = (err) => {
    cleanup();
    const recoverable = err.code === 'EADDRINUSE' || err.code === 'EACCES';
    if (!recoverable || attemptsLeft <= 0) {
      console.error(`  Cannot listen on port ${startPort}: ${err.code || err.message}`);
      process.exit(1);
    }
    console.log(`  Port ${startPort} unavailable (${err.code}); trying ${startPort + 1}`);
    listenWithFallback(startPort + 1, attemptsLeft - 1);
  };

  const onOk = () => {
    cleanup();
    onListening(startPort);
  };

  server.once('error', onError);
  server.once('listening', onOk);
  server.listen(startPort, HOST);
}

function onListening(port) {
  // The launcher reads this to know where to point "Open control app".
  try {
    writeFileSync(path.join(store.DATA_DIR, 'port'), String(port));
  } catch (err) {
    console.warn(`  Could not record the port: ${err.message}`);
  }

  // Announce the port we actually got, not the one we asked for.
  startDiscovery({
    httpPort: port,
    venueName: () => { try { return store.getSettings().venue_name; } catch { return 'Taproom'; } }
  });

  const pw = process.env.ADMIN_PASSWORD;
  console.log('');
  console.log('  Taproom Signage');
  console.log('  ───────────────────────────────────────────');
  console.log(`  Admin PWA   http://localhost:${port}/`);
  console.log(`  Display     http://localhost:${port}/display`);
  console.log(`  Data dir    ${store.DATA_DIR}`);
  if (CAPTIVE_PORTAL) console.log('  Captive portal ON (probe URLs redirect to the admin app)');
  if (!pw || pw === 'changeme') {
    console.log('');
    console.log('  ⚠  ADMIN_PASSWORD is unset (default: "changeme").');
    console.log('     Set it before exposing this beyond your LAN.');
  }
  console.log('');
}

listenWithFallback(PORT, 10);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\nShutting down…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
