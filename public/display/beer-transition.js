import { rotationFor } from '../shared/theme.js';
import { liquidRenderer } from './beer-liquid.js';

export function shouldPourBeer(previous, next) {
  return !!previous?.board && previous.board.layout !== 'poster' &&
    next?.board?.layout === 'poster' && previous.theme?.posterTransition === 'beer';
}

/** Full-panel pour. Swap only under opaque beer; release resources on cancel. */
export function pourBeer(theme, reveal, { preview = false } = {}) {
  // A deliberate preview request should show the effect even when desktop OS
  // animation effects are off. Automatic TV transitions keep the default.
  if (!preview && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    reveal(); return { finished: Promise.resolve(), cancel() {} };
  }
  const overlay = document.createElement('div');
  overlay.className = 'beer-transition' + (preview ? ' beer-preview' : ''); overlay.setAttribute('aria-hidden', 'true');
  const glass = document.createElement('div'); glass.className = 'beer-glass';
  const rotation = rotationFor(theme);
  if (rotation) glass.classList.add('beer-rot-' + rotation);
  const canvas = document.createElement('canvas'); canvas.className = 'beer-liquid';
  glass.appendChild(canvas); overlay.appendChild(glass); document.body.appendChild(overlay);
  let raf, cancelled = false, revealed = false, done;
  const finished = new Promise(resolve => { done = resolve; });
  const finish = () => { cancelAnimationFrame(raf); overlay.remove(); done(); };
  const swap = () => { if (!revealed && !cancelled) { revealed = true; reveal(); } };
  try {
    // Bound canvas work to about 0.6 megapixels, independent of a TV's 4K signal.
    const ratio = rotation ? innerHeight / innerWidth : innerWidth / innerHeight;
    const width = Math.round(Math.min(1080, Math.sqrt(580000 * ratio)));
    const height = Math.round(width / ratio);
    const draw = liquidRenderer(canvas, width, height);
    let start, last = -100;
    const tick = now => {
      if (cancelled) return;
      if (start === undefined) start = now;
      const elapsed = now - start;
      if (elapsed - last >= 30) {
        last = elapsed;
        try {
          // Draw an opaque frame first even if the browser slept past fill time.
          if (elapsed >= 2600 && !revealed) { draw(2800); swap(); }
          draw(elapsed);
          overlay.dataset.phase = elapsed < 2600 ? 'fill' : elapsed < 3100 ? 'full' : 'drain';
        } catch (error) { console.warn('Beer transition skipped', error); swap(); finish(); return; }
      }
      if (elapsed >= 5950) { swap(); finish(); return; }
      raf = requestAnimationFrame(tick);
    };
    overlay.dataset.phase = 'fill'; raf = requestAnimationFrame(tick);
  } catch (error) { console.warn('Beer transition skipped', error); swap(); finish(); }
  return { finished, cancel() { cancelled = true; finish(); } };
}
