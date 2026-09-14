// Minimal QR encoder — byte mode, versions 1-6, EC levels L and M.
//
// Written out rather than pulled from a CDN because the display must work on a
// venue network with no internet (and the page's CSP blocks third-party script
// anyway). Versions 1-6 top out at 106 bytes at level M, which is far more than
// any "http://host/?pair=CODE" needs, and stopping at 6 keeps this short: no
// version-information blocks (v7+) and exactly one alignment pattern.
//
// Verified module-for-module against the `segno` reference encoder across all
// eight masks — see scripts/verify-qr.mjs.

// version -> total codewords, alignment-pattern centre, and per-level
// [ec codewords per block, block count]. Every block is the same size at these
// versions, which keeps interleaving simple.
const VERSIONS = {
  1: { total: 26,  align: 0,  ec: { L: [7, 1],  M: [10, 1] } },
  2: { total: 44,  align: 18, ec: { L: [10, 1], M: [16, 1] } },
  3: { total: 70,  align: 22, ec: { L: [15, 1], M: [26, 1] } },
  4: { total: 100, align: 26, ec: { L: [20, 1], M: [18, 2] } },
  5: { total: 134, align: 30, ec: { L: [26, 1], M: [24, 2] } },
  6: { total: 172, align: 34, ec: { L: [18, 2], M: [16, 4] } }
};

const EC_FORMAT_BITS = { L: 0b01, M: 0b00 };

// ---------------------------------------------------------------- GF(256)

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function generatorPoly(degree) {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];                       // multiply by x
      next[j + 1] ^= gfMul(g[j], EXP[i]);    // multiply by a^i
    }
    g = next;
  }
  return g;
}

function reedSolomon(data, ecLen) {
  const g = generatorPoly(ecLen);
  const buf = new Uint8Array(data.length + ecLen);
  buf.set(data);
  for (let i = 0; i < data.length; i++) {
    const coef = buf[i];
    if (!coef) continue;
    for (let j = 0; j < g.length; j++) buf[i + j] ^= gfMul(g[j], coef);
  }
  return buf.subarray(data.length);
}

// ---------------------------------------------------------------- encoding

function toBytes(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
  const out = [];
  for (const ch of unescape(encodeURIComponent(text))) out.push(ch.charCodeAt(0));
  return Uint8Array.from(out);
}

function capacityBytes(version, level) {
  const [ecPerBlock, blocks] = VERSIONS[version].ec[level];
  const dataCodewords = VERSIONS[version].total - ecPerBlock * blocks;
  // 4 bits mode + 8 bits length = 12 bits of overhead.
  return Math.floor((dataCodewords * 8 - 12) / 8);
}

function pickVersion(byteLength, level) {
  for (let v = 1; v <= 6; v++) if (capacityBytes(v, level) >= byteLength) return v;
  return 0;
}

function buildCodewords(bytes, version, level) {
  const [ecPerBlock, blocks] = VERSIONS[version].ec[level];
  const dataCodewords = VERSIONS[version].total - ecPerBlock * blocks;

  const bits = [];
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4);            // byte mode
  push(bytes.length, 8);      // character count (8 bits for versions 1-9)
  for (const b of bytes) push(b, 8);

  const capacityBits = dataCodewords * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);  // terminator
  while (bits.length % 8) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0));
  }
  const PAD = [0xec, 0x11];
  for (let i = 0; data.length < dataCodewords; i++) data.push(PAD[i % 2]);

  // Split into equal blocks, error-correct each, then interleave.
  const perBlock = dataCodewords / blocks;
  const dataBlocks = [];
  const ecBlocks = [];
  for (let b = 0; b < blocks; b++) {
    const chunk = Uint8Array.from(data.slice(b * perBlock, (b + 1) * perBlock));
    dataBlocks.push(chunk);
    ecBlocks.push(reedSolomon(chunk, ecPerBlock));
  }

  const out = [];
  for (let i = 0; i < perBlock; i++) for (const blk of dataBlocks) out.push(blk[i]);
  for (let i = 0; i < ecPerBlock; i++) for (const blk of ecBlocks) out.push(blk[i]);
  return out;
}

// ---------------------------------------------------------------- matrix

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => ((((r * c) % 2) + ((r * c) % 3)) % 2) === 0,
  (r, c) => ((((r + c) % 2) + ((r * c) % 3)) % 2) === 0
];

function blankMatrix(size) {
  const modules = [];
  const reserved = [];
  for (let r = 0; r < size; r++) {
    modules.push(new Uint8Array(size));
    reserved.push(new Uint8Array(size));
  }
  return { modules, reserved };
}

function drawFunctionPatterns(modules, reserved, size, version) {
  const set = (r, c, v) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    modules[r][c] = v ? 1 : 0;
    reserved[r][c] = 1;
  };

  // Finder patterns plus their separators.
  for (const [fr, fc] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const ring = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        set(fr + dr, fc + dc, inside && (ring || core));
      }
    }
  }

  // Timing patterns.
  for (let i = 0; i < size; i++) {
    if (!reserved[6][i]) set(6, i, i % 2 === 0);
    if (!reserved[i][6]) set(i, 6, i % 2 === 0);
  }

  // Single alignment pattern (versions 2-6 only).
  const a = VERSIONS[version].align;
  if (a) {
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        set(a + dr, a + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
      }
    }
  }

  // Dark module, and the format-information areas.
  set(size - 8, 8, true);
  for (let i = 0; i <= 8; i++) {
    if (!reserved[8][i]) reserved[8][i] = 1;
    if (!reserved[i][8]) reserved[i][8] = 1;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = 1;
    reserved[size - 1 - i][8] = 1;
  }
}

function drawFormatBits(modules, size, level, mask) {
  const data = (EC_FORMAT_BITS[level] << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i) => (bits >> i) & 1;

  for (let i = 0; i <= 5; i++) modules[i][8] = bit(i);
  modules[7][8] = bit(6);
  modules[8][8] = bit(7);
  modules[8][7] = bit(8);
  for (let i = 9; i < 15; i++) modules[8][14 - i] = bit(i);

  for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = bit(i);

  modules[size - 8][8] = 1;
}

function placeCodewords(modules, reserved, size, codewords, mask) {
  const maskFn = MASKS[mask];
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  let upward = true;

  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right -= 1;   // the vertical timing column is skipped
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let c = 0; c < 2; c++) {
        const col = right - c;
        if (reserved[row][col]) continue;
        let bit = 0;
        if (bitIndex < totalBits) {
          bit = (codewords[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
          bitIndex++;
        }
        modules[row][col] = maskFn(row, col) ? bit ^ 1 : bit;
      }
    }
    upward = !upward;
  }
}

// ---------------------------------------------------------------- penalties

function penalty(modules, size) {
  let score = 0;

  const runScore = (line) => {
    let total = 0;
    let run = 1;
    for (let i = 1; i < size; i++) {
      if (line[i] === line[i - 1]) {
        run++;
      } else {
        if (run >= 5) total += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) total += 3 + (run - 5);
    return total;
  };

  const PATTERN_A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const PATTERN_B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const finderScore = (line) => {
    let total = 0;
    for (let i = 0; i + 11 <= size; i++) {
      let a = true;
      let b = true;
      for (let j = 0; j < 11; j++) {
        if (line[i + j] !== PATTERN_A[j]) a = false;
        if (line[i + j] !== PATTERN_B[j]) b = false;
      }
      if (a) total += 40;
      if (b) total += 40;
    }
    return total;
  };

  for (let r = 0; r < size; r++) {
    const row = modules[r];
    const col = [];
    for (let i = 0; i < size; i++) col.push(modules[i][r]);
    score += runScore(row) + runScore(col);
    score += finderScore(row) + finderScore(col);
  }

  // Rule 2: every 2x2 block of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) {
        score += 3;
      }
    }
  }

  // Rule 4: deviation from an even split of dark and light.
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += modules[r][c];
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

// ---------------------------------------------------------------- public

/**
 * Encode `text` as a QR symbol.
 * @returns {{size:number, modules:Uint8Array[], version:number, mask:number, level:string}}
 * @throws if the text is too long for version 6.
 */
export function encodeQr(text, options = {}) {
  const level = options.level === 'L' ? 'L' : 'M';
  const bytes = toBytes(String(text));

  const version = options.version || pickVersion(bytes.length, level);
  if (!version) {
    throw new Error(`QR: ${bytes.length} bytes exceeds the ${capacityBytes(6, level)}-byte limit`);
  }

  const size = 17 + version * 4;
  const codewords = buildCodewords(bytes, version, level);

  const build = (mask) => {
    const { modules, reserved } = blankMatrix(size);
    drawFunctionPatterns(modules, reserved, size, version);
    placeCodewords(modules, reserved, size, codewords, mask);
    drawFormatBits(modules, size, level, mask);
    return modules;
  };

  if (options.mask !== undefined && options.mask !== null) {
    return { size, modules: build(options.mask), version, mask: options.mask, level };
  }

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const modules = build(mask);
    const score = penalty(modules, size);
    if (!best || score < best.score) best = { modules, score, mask };
  }
  return { size, modules: best.modules, version, mask: best.mask, level };
}

/**
 * Render `text` as an <svg>. Quiet zone is included: without it many scanners
 * simply will not see the code.
 */
export function qrSvg(text, options = {}) {
  const { size, modules } = encodeQr(text, options);
  const quiet = options.quiet === undefined ? 4 : options.quiet;
  const dim = size + quiet * 2;

  const parts = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) parts.push(`M${c + quiet} ${r + quiet}h1v1h-1z`);
    }
  }

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${dim} ${dim}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');

  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', String(dim));
  bg.setAttribute('height', String(dim));
  bg.setAttribute('fill', options.light || '#ffffff');
  svg.appendChild(bg);

  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', parts.join(''));
  path.setAttribute('fill', options.dark || '#000000');
  svg.appendChild(path);

  return svg;
}
