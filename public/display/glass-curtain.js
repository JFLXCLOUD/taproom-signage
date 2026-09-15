const clamp = x => Math.max(0, Math.min(1, x));
const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const rnd = n => { const v = Math.sin(n * 127.1 + 51.7) * 43758.5453; return v - Math.floor(v); };
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

export function iceRenderer(c) {
  const ctx = c.getContext('2d'), w = c.width, h = c.height, unit = Math.min(w, h) / 540;
  const mist = canvas(512, 512), m = mist.getContext('2d');
  m.fillStyle = '#dcebf0'; m.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 70; i++) {
    const x = rnd(i) * 512, y = rnd(i + 40) * 512, r = 30 + rnd(i + 70) * 150;
    const g = m.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, i % 3 ? '#ffffff35' : '#668d9e18'); g.addColorStop(1, '#fff0');
    m.fillStyle = g; m.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Fine condensation texture, prepared once rather than per frame.
  for (let i = 0; i < 12000; i++) {
    m.fillStyle = i % 2 ? '#ffffff24' : '#7599a51c'; m.fillRect(rnd(i + 130) * 512, rnd(i + 1100) * 512, 1, 1);
  }
  const drop = canvas(48, 64), d = drop.getContext('2d');
  const g = d.createRadialGradient(17, 21, 2, 23, 31, 23);
  g.addColorStop(0, '#ffffffaa'); g.addColorStop(.32, '#cfe9f11a');
  g.addColorStop(.74, '#547c9020'); g.addColorStop(.88, '#24495f99'); g.addColorStop(1, '#dcf6ff00');
  d.fillStyle = g; d.beginPath(); d.ellipse(24, 32, 21, 29, 0, 0, Math.PI * 2); d.fill();
  d.fillStyle = '#fff9'; d.beginPath(); d.ellipse(16, 17, 4, 7, .6, 0, Math.PI * 2); d.fill();
  const drops = Array.from({ length: 150 }, (_, i) => ({ x: rnd(i + 500), y: rnd(i + 1500), r: (1 + rnd(i + 900) ** 3 * 7) * unit, delay: rnd(i + 400) * 1.8 }));
  return {
    coverAt: 1700, openAt: 2200, duration: 4700,
    draw(ms) {
      const t = ms / 1000, fog = smooth(ms / 1700), clear = smooth((ms - 2200) / 2050);
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = fog;
      // An opaque base at the cover point hides the scene change completely.
      ctx.drawImage(mist, 0, 0, 512, 512, 0, 0, w, h);
      ctx.globalAlpha = fog * .24;
      ctx.drawImage(mist, 20 + Math.sin(t * .7) * 16, 25 + Math.cos(t * .6) * 12, 440, 440, 0, 0, w, h);
      ctx.globalAlpha = 1;
      if (clear > 0) {
        // A broad clearing sweep has a soft, slightly bowed edge like wet glass.
        ctx.globalCompositeOperation = 'destination-out';
        const edge = -w * .18 + clear * w * 1.5;
        const fade = ctx.createLinearGradient(edge - w * .13, 0, edge + w * .03, 0);
        fade.addColorStop(0, '#fff'); fade.addColorStop(1, '#fff0');
        ctx.fillStyle = fade; ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
      }
      const vanish = 1 - smooth((ms - 4150) / 550);
      for (const p of drops) {
        const age = Math.max(0, t - p.delay), slide = p.r > 3 * unit ? age * age * 7 * unit : age * 1.3 * unit;
        const x = p.x * w, y = p.y * h + slide;
        ctx.globalAlpha = fog * vanish * .75;
        if (p.r > 4 * unit && age > .6) {
          ctx.beginPath(); ctx.moveTo(x, y - Math.min(40 * unit, slide)); ctx.quadraticCurveTo(x + unit, y - 8 * unit, x, y);
          ctx.strokeStyle = '#f1fbff88'; ctx.lineWidth = 1.2 * unit; ctx.stroke();
        }
        ctx.drawImage(drop, x - p.r, y - p.r * 1.3, p.r * 2, p.r * 2.6);
      }
      ctx.globalAlpha = 1;
    }
  };
}

export function curtainRenderer(c) {
  const ctx = c.getContext('2d'), w = c.width, h = c.height, half = Math.ceil(w / 2) + 3;
  const cloth = canvas(half + 12, h), f = cloth.getContext('2d');
  // Irregular pleats with a narrow soft highlight and deep shaded troughs.
  for (let x = 0; x < cloth.width; x++) {
    const u = x / half, phase = u * Math.PI * 19 + Math.sin(u * 9) * .65;
    const fold = Math.pow((Math.sin(phase) + 1) / 2, 1.5);
    const sheen = Math.pow((Math.sin(phase + .7) + 1) / 2, 13);
    const r = Math.round(45 + fold * 84 + sheen * 30);
    f.fillStyle = `rgb(${r},${Math.round(5 + fold * 10)},${Math.round(17 + fold * 18)})`;
    f.fillRect(x, 0, 1, h);
  }
  const light = f.createLinearGradient(0, 0, half * .4, h);
  light.addColorStop(0, '#080006dd'); light.addColorStop(.25, '#21000a22');
  light.addColorStop(.6, '#eb878b12'); light.addColorStop(1, '#160009aa');
  f.fillStyle = light; f.fillRect(0, 0, cloth.width, h);
  for (let i = 0; i < 15000; i++) {
    f.fillStyle = i % 2 ? '#ffc0c00a' : '#00000013';
    f.fillRect(rnd(i + 21) * cloth.width, rnd(i + 600) * h, 1, 2);
  }
  return {
    coverAt: 1500, openAt: 2150, duration: 4300,
    draw(ms) {
      ctx.clearRect(0, 0, w, h);
      const closed = smooth(ms / 1500) * (1 - smooth((ms - 2150) / 2150));
      if (closed <= 0) return;
      const reach = half * closed;
      // The cloth gently stretches while traveling, like fabric hanging on a rail.
      const panelWidth = half + Math.sin(closed * Math.PI) * half * .025;
      ctx.drawImage(cloth, reach - panelWidth, 0, panelWidth, h);
      ctx.save(); ctx.translate(w, 0); ctx.scale(-1, 1);
      ctx.drawImage(cloth, reach - panelWidth, 0, panelWidth, h); ctx.restore();
      // Soft inner-edge shadows add depth without obscuring the open centre.
      for (const x of [reach, w - reach]) {
        const g = ctx.createLinearGradient(x - 5, 0, x + 5, 0);
        g.addColorStop(0, '#0000'); g.addColorStop(.5, '#08000366'); g.addColorStop(1, '#0000');
        ctx.fillStyle = g; ctx.fillRect(x - 5, 0, 10, h);
      }
    }
  };
}
