import { createReadStream, statSync } from 'node:fs';
import { extname } from 'node:path';
import { createHash } from 'node:crypto';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

export function mimeFor(file) {
  return MIME[extname(file).toLowerCase()] || 'application/octet-stream';
}

export function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

export function text(res, status, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...extra });
  res.end(body);
}

/** Read a JSON request body with a hard size ceiling. */
export function readJson(req, limitBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(res, name, value, { maxAge, httpOnly = true, sameSite = 'Lax' } = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', `SameSite=${sameSite}`];
  if (httpOnly) bits.push('HttpOnly');
  if (maxAge !== undefined) bits.push(`Max-Age=${Math.floor(maxAge / 1000)}`);
  const prev = res.getHeader('Set-Cookie');
  const next = prev ? [].concat(prev, bits.join('; ')) : bits.join('; ');
  res.setHeader('Set-Cookie', next);
}

/** Stream a file with ETag + conditional GET. `immutable` for content-addressed uploads. */
export function sendFile(req, res, filePath, { immutable = false, mime } = {}) {
  let st;
  try {
    st = statSync(filePath);
    if (!st.isFile()) throw new Error('not a file');
  } catch {
    return text(res, 404, 'Not found');
  }

  const etag = '"' + createHash('sha1')
    .update(`${filePath}:${st.size}:${st.mtimeMs}`)
    .digest('base64url').slice(0, 27) + '"';

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    return res.end();
  }

  res.writeHead(200, {
    'Content-Type': mime || mimeFor(filePath),
    'Content-Length': st.size,
    ETag: etag,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache'
  });

  if (req.method === 'HEAD') return res.end();
  createReadStream(filePath).pipe(res);
}
