// Original photographic material, loaded ahead of playback. A gradient fallback
// keeps the wipe working if the image is unavailable or still loading.
const texture = typeof Image === 'undefined' ? null : new Image();
if (texture) texture.src = '/display/assets/beer-macro.png';
const clamp = n => Math.max(0, Math.min(1, n));
const smooth = n => { n = clamp(n); return n * n * (3 - 2 * n); };
const random = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// Pre-shaded sprites give bubbles and drops a transparent centre, a darker rim,
// and a small reflected highlight without creating gradients every frame.
function bubbleSprite(foamy = false) {
  const sprite = document.createElement('canvas'); sprite.width = sprite.height = 48;
  const c = sprite.getContext('2d');
  const g = c.createRadialGradient(19, 16, 1, 24, 24, 21);
  g.addColorStop(0, foamy ? '#fffdf1ee' : '#fff7d54d');
  g.addColorStop(.6, foamy ? '#f1e2b5dd' : '#b47b0a08');
  g.addColorStop(.87, foamy ? '#bba47fcc' : '#65370588');
  g.addColorStop(.95, '#ffefbaaa'); g.addColorStop(1, '#fff0');
  c.fillStyle = g; c.fillRect(0, 0, 48, 48);
  c.beginPath(); c.ellipse(17, 13, 5, 2, -.65, 0, Math.PI * 2);
  c.fillStyle = '#ffffffbb'; c.fill(); return sprite;
}

/** Bounded-resolution liquid surface with traveling waves and wall run-up. */
export function liquidRenderer(canvas, width, height) {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('Canvas unavailable');
  const w = canvas.width = width, h = canvas.height = height;
  const scale = Math.min(w, h) / 540, points = 100;
  const surface = new Float32Array(points + 1), foam = new Float32Array(points + 1);
  const bubble = bubbleSprite(), froth = bubbleSprite(true);
  let material, headMaterial;
  let flow;
  function refract(t, agitation, drain) {
    if (!material && texture?.complete && texture.naturalWidth) {
      material = document.createElement('canvas'); material.width = 960; material.height = 640;
      material.getContext('2d').drawImage(texture, 0, texture.naturalHeight * .25,
        texture.naturalWidth, texture.naturalHeight * .75, 0, 0, 960, 640);
      headMaterial = document.createElement('canvas'); headMaterial.width = 960; headMaterial.height = 160;
      headMaterial.getContext('2d').drawImage(texture, 0, 0, texture.naturalWidth, texture.naturalHeight * .19, 0, 0, 960, 160);
      flow = document.createElement('canvas'); flow.width = w; flow.height = h + 48;
    }
    if (!material) return;
    const f = flow.getContext('2d');
    // Two inexpensive displacement passes produce motion through both axes.
    // Overscan in the source keeps every edge covered, without triangle clips.
    for (let y = 0; y < flow.height; y += 6) {
      const v = y / flow.height, sh = Math.min(6, flow.height - y);
      const drift = Math.sin(v * 12 + t * 2.4) * (5 + agitation * 9) + Math.sin(v * 23 - t) * 2;
      f.drawImage(material, 24 + drift, 24 + v * 592, 912, sh / flow.height * 592, 0, y, w, sh);
    }
    for (let x = 0; x < w; x += 6) {
      const u = x / w, sw = Math.min(6, w - x);
      const drift = Math.sin(u * 11 + t * 1.8) * (5 + 9 * agitation) - Math.sin(t * .65) * 5 + drain * 3;
      ctx.drawImage(flow, x, 24 + drift, sw, h, x, 0, sw, h);
    }
  }
  const beer = ctx.createLinearGradient(0, 0, w, h);
  beer.addColorStop(0, '#c5790c'); beer.addColorStop(.42, '#f6b928');
  beer.addColorStop(.7, '#d98b0b'); beer.addColorStop(1, '#874006');
  const edge = ctx.createLinearGradient(0, 0, w, 0);
  edge.addColorStop(0, '#54200099'); edge.addColorStop(.025, '#fff0a333');
  edge.addColorStop(.08, '#0000'); edge.addColorStop(.87, '#0000');
  edge.addColorStop(.985, '#fff0c044'); edge.addColorStop(1, '#552400aa');
  const particles = Array.from({ length: 180 }, (_, i) => ({
    x: random(i + 3), y: random(i + 12), r: (0.5 + random(i + 40) ** 3 * 3.3) * scale,
    speed: 20 + random(i + 90) * 70
  }));
  const crown = Array.from({ length: 220 }, (_, i) => ({
    x: random(i + 302), depth: random(i + 612), r: (1 + random(i + 102) ** 3 * 6) * scale
  }));
  function line(values, reverse = false) {
    for (let k = 0; k <= points; k++) {
      const i = reverse ? points - k : k; ctx.lineTo(i / points * w, values[i]);
    }
  }
  const at = (values, x) => {
    const index = clamp(x / w) * points, i = Math.floor(index), mix = index - i;
    return values[i] * (1 - mix) + values[Math.min(points, i + 1)] * mix;
  };
  function surfaceAt(x, ms) {
    const t = ms / 1000, drain = smooth((ms - 3400) / 2200);
    const agitation = ms < 2600 ? Math.sin(clamp(ms / 2600) * Math.PI) : ms > 3100 ? Math.sin(drain * Math.PI) * .7 : .05;
    const level = ms < 2600 ? h * (1.16 - smooth(ms / 2600) * 1.48) : h * (-.32 + drain * 1.56);
    const amplitude = (12 + 38 * agitation) * scale;
    const surge = Math.exp(-x * 19) * Math.max(0, Math.sin(t * 6.2)) +
      Math.exp(-(1 - x) * 19) * Math.max(0, Math.sin(t * 6.2 - 2.4));
    const swell = Math.sin(x * 7.5 - t * 5.5) * .65 + Math.sin(x * 15 + t * 3.7) * .24 + Math.sin(x * 34 - t * 8) * .11;
    // Capillary rise at the glass and a little faster drainage in the centre.
    const wall = Math.exp(-x * 35) + Math.exp(-(1 - x) * 35);
    return level + amplitude * swell - surge * amplitude * 2.3 - wall * 9 * scale + Math.sin(x * Math.PI) * Math.sin(drain * Math.PI) * 18 * scale;
  }
  return function draw(ms) {
    const t = ms / 1000, filling = ms < 2600, draining = ms > 3100;
    const drain = smooth((ms - 3400) / 2200);
    const agitation = filling ? Math.sin(clamp(ms / 2600) * Math.PI) : draining ? Math.sin(drain * Math.PI) * .7 : .05;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i <= points; i++) {
      const x = i / points;
      surface[i] = surfaceAt(x, ms);
      const wall = Math.exp(-x * 13) + Math.exp(-(1 - x) * 13);
      const clusters = 5 * Math.sin(x * 21 - t * 1.1) + 2 * Math.sin(x * 73 + t * 2);
      foam[i] = surface[i] - (21 + agitation * 19 + 8 * Math.sin(x * 9 + t * 2) + clusters + wall * drain * 24) * scale;
    }
    // Opaque liquid ensures the scene swap cannot show through the full glass.
    ctx.save(); ctx.beginPath(); ctx.moveTo(0, surface[0]); line(surface);
    ctx.lineTo(w, h + 1); ctx.lineTo(0, h + 1); ctx.closePath(); ctx.clip();
    ctx.fillStyle = beer; ctx.fillRect(0, 0, w, h);
    if (surface.some(y => y < h)) refract(t, agitation, drain);
    for (const p of particles) {
      const x = p.x * w + Math.sin(t * 2 + p.y * 90) * 4 * scale;
      const y = ((p.y * h - t * p.speed * scale) % h + h) % h;
      const r = p.r * (1 + (1 - y / h) * .35);
      ctx.drawImage(bubble, x - r, y - r, r * 2, r * 2);
    }
    // An amber depth shadow and bright wet meniscus just below the beer head.
    ctx.beginPath(); ctx.moveTo(0, surface[0]); line(surface);
    ctx.strokeStyle = '#82450055'; ctx.lineWidth = 10 * scale; ctx.stroke();
    ctx.strokeStyle = '#ffe8a4aa'; ctx.lineWidth = 1.5 * scale; ctx.stroke();
    ctx.fillStyle = edge; ctx.fillRect(0, 0, w, h); ctx.restore();

    // Photographic foam follows the moving surface, with an irregular underside.
    ctx.save(); ctx.beginPath(); ctx.moveTo(0, foam[0]); line(foam);
    line(surface, true); ctx.closePath(); ctx.clip();
    ctx.fillStyle = '#efdfaf'; ctx.fillRect(0, 0, w, h);
    if (headMaterial) {
      for (let i = 0; i < points; i++) {
        if (Math.max(surface[i], surface[i + 1]) < 0 || Math.min(foam[i], foam[i + 1]) > h) continue;
        const x = i / points * w, span = w / points;
        const height = surface[i] - foam[i];
        ctx.save();
        // Shear adjacent foam strips along the same top edge; no tiled steps.
        ctx.transform(1, (foam[i + 1] - foam[i]) / span, 0, height / 160, x, foam[i]);
        ctx.drawImage(headMaterial, i / points * 960, 0, 960 / points, 160, 0, 0, span + .35, 160);
        ctx.restore();
      }
    }
    // Soft depth under the head; avoid the look of a uniform flat white ribbon.
    for (let band = 0; band < 10; band++) {
      const top = band / 10, bottom = (band + 1) / 10;
      ctx.beginPath(); ctx.moveTo(0, foam[0] + (surface[0] - foam[0]) * top);
      for (let i = 0; i <= points; i++) ctx.lineTo(i / points * w, foam[i] + (surface[i] - foam[i]) * top);
      for (let i = points; i >= 0; i--) ctx.lineTo(i / points * w, foam[i] + (surface[i] - foam[i]) * bottom);
      ctx.closePath();
      ctx.fillStyle = band < 4 ? 'rgba(255,252,236,' + (.18 * (1 - band / 4)) + ')' : 'rgba(131,85,28,' + ((band - 4) * .038) + ')';
      ctx.fill();
    }
    ctx.restore();
    for (const p of crown) {
      const x = (p.x * w + Math.sin(t * .8 + p.depth * 12) * 5 * scale);
      const y = at(foam, x) + p.depth * (at(surface, x) - at(foam, x));
      if (y < -20 || y > h + 20) continue;
      // Individual cells swell and collapse as the head rolls.
      const r = p.r * (.8 + .2 * Math.sin(t * 3 + p.x * 90));
      ctx.globalAlpha = .65; ctx.drawImage(froth, x - r, y - r * .7, r * 2, r * 1.4); ctx.globalAlpha = 1;
    }
    // Ballistic drops break free where the surge strikes either wall.
    for (let i = 0; i < 42; i++) {
      const age = (t + random(i + 700) * .75) % .75, left = i % 2 === 0;
      const birth = ms - age * 1000;
      if (birth < 250 || birth > 2300 && birth < 3650 || birth > 5100) continue;
      const vx = (left ? 1 : -1) * (45 + random(i) * 150) * scale;
      const vy = -(100 + random(i + 45) * 230) * scale;
      const x = (left ? 2 * scale : w - 2 * scale) + vx * age;
      const y = surfaceAt(left ? 0 : 1, birth) + vy * age + 400 * scale * age * age;
      if (y < 0 || y > h || y >= at(surface, x)) continue;
      const r = (1 + random(i + 6) * 3) * scale;
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(vy + 800 * scale * age, vx) - Math.PI / 2);
      const stretch = 1 + Math.min(.8, Math.abs(vy + 800 * scale * age) / (500 * scale));
      ctx.drawImage(bubble, -r, -r * stretch, 2 * r, 2 * r * stretch); ctx.restore();
    }
    if (draining) for (let i = 0; i < 36; i++) {
      const x = random(i + 850) * w;
      const slide = Math.max(0, drain - random(i + 710) * .7);
      const y = random(i + 940) * h + slide * slide * 65 * scale;
      if (y >= at(foam, x)) continue;
      ctx.globalAlpha = .55 * (1 - smooth((ms - 5600) / 350));
      const r = (1.2 + random(i + 73) * 2) * scale;
      if (r > 2.2 * scale && slide > .05) {
        ctx.beginPath(); ctx.moveTo(x, y - slide * 25 * scale); ctx.quadraticCurveTo(x - scale, y - 6 * scale, x, y);
        ctx.strokeStyle = '#f6e1af44'; ctx.lineWidth = scale; ctx.stroke();
      }
      ctx.drawImage(bubble, x - r, y - r * 1.6, r * 2, r * 3.2);
      ctx.globalAlpha = 1;
    }
  };
}
