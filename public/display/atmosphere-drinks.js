// Local Canvas materials: prepare textures once, then animate sprites and masks.
// No external images, video downloads, WebGL, or per-frame pixel processing.
const clamp = x => Math.max(0, Math.min(1, x));
const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const random = n => { const v = Math.sin(n * 127.1 + 91.7) * 43758.5453; return v - Math.floor(v); };
const TAU = Math.PI * 2;
function surface(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const lattice = Float32Array.from({ length: 4096 }, (_, i) => random(i + 61));
function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), sx = smooth(x - ix), sy = smooth(y - iy);
  const at = (x, y) => lattice[(x & 63) + (y & 63) * 64];
  return (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) +
    (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy;
}
function turbulence(x, y) {
  return noise(x, y) * .54 + noise(x * 2.1 + 7, y * 2.1) * .27 + noise(x * 4.3, y * 4.3 + 19) * .13 + noise(x * 8.7, y * 8.7) * .06;
}

let smokeMaterial, whiskeyMaterial, bubbleMaterial;
function smokeCloud() {
  if (smokeMaterial) return smokeMaterial;
  const c = surface(256), ctx = c.getContext('2d'), pixels = ctx.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const u = (x - 128) / 128, v = (y - 128) / 128;
    const warp = noise(x / 48 + 7, y / 48) * 3;
    const billow = turbulence(x / 37 + warp, y / 37 - warp);
    const feather = smooth((1 - Math.hypot(u, v)) * 2.4);
    const density = smooth((billow - .17) * 1.9) * feather;
    const light = clamp(.15 + billow * .85 - u * .14 - v * .1);
    const i = (y * 256 + x) * 4;
    pixels.data[i] = 64 + light * 167;
    pixels.data[i + 1] = 70 + light * 165;
    pixels.data[i + 2] = 78 + light * 158;
    pixels.data[i + 3] = density * 245;
  }
  ctx.putImageData(pixels, 0, 0); smokeMaterial = c; return c;
}

export function smokeRenderer(c) {
  const ctx = c.getContext('2d'), w = c.width, h = c.height, cloud = smokeCloud();
  const veil = ctx.createLinearGradient(0, h, w, 0);
  veil.addColorStop(0, '#242932'); veil.addColorStop(.5, '#687078'); veil.addColorStop(1, '#333940');
  const puffs = Array.from({ length: 38 }, (_, i) => ({
    x: random(i + 51), y: random(i + 98), size: .42 + random(i + 145) * .48,
    speed: .4 + random(i + 255), phase: random(i + 309) * TAU, side: i % 2 ? 1 : -1
  }));
  return {
    coverAt: 1900, openAt: 2350, duration: 5000,
    draw(ms) {
      const t = ms / 1000, arrive = smooth(ms / 1900), clear = smooth((ms - 2350) / 2650);
      ctx.clearRect(0, 0, w, h);
      // At the swap, this base is opaque beneath the moving cloud layers.
      ctx.globalAlpha = smooth((ms - 500) / 1350) * (1 - clear);
      ctx.fillStyle = veil; ctx.fillRect(0, 0, w, h);
      for (const p of puffs) {
        const size = Math.max(w, h) * p.size;
        const x = p.x * w + p.side * (1 - arrive) * w * .95 + Math.sin(t * .55 + p.phase) * w * .09 + clear * w * .22;
        const y = p.y * h + (1 - arrive) * h * .22 - clear * h * p.speed * .75;
        ctx.save(); ctx.translate(x, y); ctx.rotate(p.phase + t * .075 * p.side);
        ctx.globalAlpha = smooth(ms / 450) * (1 - clear) * .85;
        ctx.drawImage(cloud, -size * .63, -size * .48, size * 1.26, size * .96);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  };
}

function whiskeyTexture() {
  if (whiskeyMaterial) return whiskeyMaterial;
  const size = 512, c = surface(size), ctx = c.getContext('2d'), pixels = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x - size / 2) / (size / 2), v = (y - size / 2) / (size / 2);
    const r = Math.hypot(u, v), a = Math.atan2(v, u);
    const n = turbulence(u * 4 + 8, v * 4 + 3);
    const bend = a * 3 + r * 25 + n * 4;
    const ribbon = .5 + .5 * Math.sin(bend);
    const caustic = Math.pow(.5 + .5 * Math.sin(bend + 1.1), 16);
    const light = clamp(.28 + ribbon * .27 + n * .35 + caustic * .22 - r * .12);
    const i = (y * size + x) * 4;
    pixels.data[i] = 106 + light * 147;
    pixels.data[i + 1] = 29 + light * 138;
    pixels.data[i + 2] = 4 + light * 46;
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0); whiskeyMaterial = c; return c;
}

// An irregular, rotating meniscus; the same surface spreads in then opens out.
function swirlEdge(ctx, x, y, radius, phase, roughness) {
  ctx.beginPath();
  for (let i = 0; i <= 160; i++) {
    const a = i / 160 * TAU;
    const r = radius * (1 + Math.sin(a * 3 + phase) * roughness + Math.sin(a * 7 - phase * 1.4) * roughness * .25);
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
}

export function whiskeyRenderer(c) {
  const ctx = c.getContext('2d'), w = c.width, h = c.height, texture = whiskeyTexture();
  const diagonal = Math.hypot(w, h), unit = Math.min(w, h) / 540;
  const beads = Array.from({ length: 36 }, (_, i) => ({ a: random(i + 20) * TAU, r: .12 + random(i + 75) * .47, size: (1 + random(i + 90) * 3) * unit }));
  return {
    coverAt: 1750, openAt: 2250, duration: 4900,
    draw(ms) {
      const t = ms / 1000, arrive = smooth(ms / 1750), clear = smooth((ms - 2250) / 2650);
      const phase = t * 1.2, radius = diagonal * .72;
      ctx.clearRect(0, 0, w, h);
      if (!arrive || clear === 1) return;
      ctx.save();
      swirlEdge(ctx, w / 2, h / 2, radius * arrive, phase, .1 * (1 - arrive)); ctx.clip();
      // Continuous rotation of an amber material with curved highlights and depth.
      ctx.translate(w / 2, h / 2); ctx.rotate(phase * .42);
      ctx.drawImage(texture, -diagonal * .55, -diagonal * .55, diagonal * 1.1, diagonal * 1.1);
      ctx.restore();
      ctx.save();
      swirlEdge(ctx, w / 2, h / 2, radius * arrive, phase, .1 * (1 - arrive)); ctx.clip();
      ctx.globalAlpha = .42;
      for (const p of beads) {
        const a = p.a + phase * .55, r = p.r * diagonal;
        const x = w / 2 + Math.cos(a) * r, y = h / 2 + Math.sin(a) * r;
        ctx.beginPath(); ctx.ellipse(x, y, p.size * 1.7, p.size, a + Math.PI / 2, 0, TAU);
        ctx.strokeStyle = '#ffe1a8'; ctx.lineWidth = .7 * unit; ctx.stroke();
      }
      ctx.restore();
      if (clear > 0) {
        ctx.globalCompositeOperation = 'destination-out';
        swirlEdge(ctx, w / 2, h / 2, radius * clear, phase + 1, .11 * (1 - clear));
        ctx.fillStyle = '#fff'; ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        // Thin amber rim follows the receding surface instead of a hard iris edge.
        ctx.globalAlpha = Math.sin(clear * Math.PI) * .65;
        swirlEdge(ctx, w / 2, h / 2, radius * clear, phase + 1, .11 * (1 - clear));
        ctx.strokeStyle = '#ffcd72'; ctx.lineWidth = 3 * unit; ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  };
}

function champagneBubble() {
  if (bubbleMaterial) return bubbleMaterial;
  const c = surface(48), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(19, 17, 2, 24, 24, 22);
  g.addColorStop(0, '#fffce93a'); g.addColorStop(.65, '#fff7ce05');
  g.addColorStop(.82, '#82642d70'); g.addColorStop(.92, '#fffdeedc'); g.addColorStop(1, '#fffbe000');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 48, 48);
  ctx.fillStyle = '#fffef2'; ctx.beginPath(); ctx.ellipse(17, 12, 5, 2, -.6, 0, TAU); ctx.fill();
  bubbleMaterial = c; return c;
}

export function champagneRenderer(c) {
  const ctx = c.getContext('2d'), w = c.width, h = c.height, unit = Math.min(w, h) / 540;
  const bubble = champagneBubble();
  const gold = ctx.createLinearGradient(0, 0, w, h);
  gold.addColorStop(0, '#fff3bd'); gold.addColorStop(.35, '#e8ce7c'); gold.addColorStop(.64, '#fae8ab'); gold.addColorStop(1, '#af8735');
  const particles = Array.from({ length: 260 }, (_, i) => ({
    x: random(i + 75), y: random(i + 700), speed: .12 + random(i + 505) * .3,
    r: (.7 + random(i + 606) ** 3 * 6) * unit, phase: random(i + 311) * TAU
  }));
  const foam = Array.from({ length: 145 }, (_, i) => ({ x: random(i + 171), offset: random(i + 838), r: (1 + random(i + 999) * 4) * unit }));
  function wave(x, t) { return Math.sin(x / w * 10 + t * 2.8) * h * .009 + Math.sin(x / w * 21 - t * 2) * h * .004; }
  return {
    coverAt: 1800, openAt: 2450, duration: 5000,
    draw(ms) {
      const t = ms / 1000, arrive = smooth(ms / 1800), clear = smooth((ms - 2450) / 2550);
      const top = h + h * .08 - arrive * h * 1.18;
      const bottom = h * (1.08 - clear * 1.22);
      ctx.clearRect(0, 0, w, h);
      if (!arrive || clear === 1) return;
      ctx.save(); ctx.beginPath();
      for (let i = 0; i <= 90; i++) {
        const x = i / 90 * w, y = top + wave(x, t);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      for (let i = 90; i >= 0; i--) {
        const x = i / 90 * w; ctx.lineTo(x, bottom + wave(x, t + 2));
      }
      ctx.closePath(); ctx.clip();
      ctx.fillStyle = gold; ctx.fillRect(0, 0, w, h);
      // Soft moving light streaks through the golden liquid.
      for (let i = 0; i < 5; i++) {
        const x = ((i / 4 + Math.sin(t * .55 + i) * .045) * w);
        const light = ctx.createLinearGradient(x - w * .09, 0, x + w * .09, 0);
        light.addColorStop(0, '#fffef000'); light.addColorStop(.5, '#fffef040'); light.addColorStop(1, '#fffef000');
        ctx.fillStyle = light; ctx.fillRect(x - w * .09, 0, w * .18, h);
      }
      for (const p of particles) {
        const x = p.x * w + Math.sin(t * 1.6 + p.phase) * 5 * unit;
        const y = (1 - ((p.y + t * p.speed) % 1)) * h - clear * h * .32;
        ctx.drawImage(bubble, x - p.r, y - p.r, p.r * 2, p.r * 2);
      }
      ctx.restore();
      // Fine fizz at the rising surface; it lifts away to uncover the poster.
      const edge = clear > 0 ? bottom : top;
      ctx.globalAlpha = smooth(ms / 300) * (1 - smooth((clear - .85) / .15));
      for (const p of foam) {
        const x = p.x * w, y = edge + wave(x, t) + (p.offset - .5) * 17 * unit;
        ctx.drawImage(bubble, x - p.r, y - p.r, p.r * 2, p.r * 2);
      }
      ctx.globalAlpha = 1;
    }
  };
}
