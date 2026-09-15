import { pourBeer } from './beer-transition.js';
import { iceRenderer, curtainRenderer } from './glass-curtain.js';
import { smokeRenderer, whiskeyRenderer, champagneRenderer } from './atmosphere-drinks.js';
import { rotationFor } from '../shared/theme.js';
import { POSTER_TRANSITIONS } from '../shared/transitions.js';

const renderers = { ice: iceRenderer, curtain: curtainRenderer, smoke: smokeRenderer, whiskey: whiskeyRenderer, champagne: champagneRenderer };

export function posterTransitionFor(previous, next) {
  const key = previous?.theme?.posterTransition;
  return previous?.board && previous.board.layout !== 'poster' && next?.board?.layout === 'poster' &&
    key !== 'none' && Object.prototype.hasOwnProperty.call(POSTER_TRANSITIONS, key) ? key : 'none';
}

export function runPosterTransition(key, theme, reveal, { preview = false } = {}) {
  if (key === 'beer') return pourBeer(theme, reveal, { preview });
  if (!Object.prototype.hasOwnProperty.call(renderers, key) || (!preview && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    reveal(); return { finished: Promise.resolve(), cancel() {} };
  }
  const overlay = document.createElement('div');
  overlay.className = 'poster-transition effect-' + key + (preview ? ' requested-preview' : '');
  overlay.setAttribute('aria-hidden', 'true');
  const panel = document.createElement('div'), rotation = rotationFor(theme);
  panel.className = 'transition-panel' + (rotation ? ' transition-rot-' + rotation : '');
  const canvas = document.createElement('canvas'); panel.appendChild(canvas); overlay.appendChild(panel); document.body.appendChild(overlay);
  let raf, cancelled = false, revealed = false, done;
  const finished = new Promise(resolve => { done = resolve; });
  const finish = () => { cancelAnimationFrame(raf); overlay.remove(); done(); };
  const swap = () => { if (!cancelled && !revealed) { revealed = true; reveal(); } };
  try {
    const ratio = rotation ? innerHeight / innerWidth : innerWidth / innerHeight;
    canvas.width = Math.round(Math.min(1080, Math.sqrt(580000 * ratio)));
    canvas.height = Math.round(canvas.width / ratio);
    const effect = renderers[key](canvas);
    let start, last = -100;
    const tick = now => {
      if (cancelled) return;
      if (start === undefined) start = now;
      const elapsed = now - start;
      try {
        if (elapsed - last >= 30) {
          last = elapsed;
          if (elapsed >= effect.coverAt && !revealed) { effect.draw(effect.coverAt); swap(); }
          effect.draw(elapsed);
          overlay.dataset.phase = elapsed < effect.coverAt ? 'cover' : elapsed < effect.openAt ? 'full' : 'reveal';
        }
        if (elapsed >= effect.duration) { swap(); finish(); return; }
        raf = requestAnimationFrame(tick);
      } catch (error) { console.warn('Poster transition skipped', error); swap(); finish(); }
    };
    overlay.dataset.phase = 'cover'; raf = requestAnimationFrame(tick);
  } catch (error) { console.warn('Poster transition skipped', error); swap(); finish(); }
  return { finished, cancel() { cancelled = true; finish(); } };
}
