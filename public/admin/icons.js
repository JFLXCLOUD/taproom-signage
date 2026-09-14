// Inline SVG icon set for the control PWA.
//
// Drawn as plain <path> elements on a 24x24 grid with currentColor strokes, so
// icons inherit text colour, scale cleanly, and cost no network request. That
// matters here: the PWA has to work on venue wifi that may have no internet,
// and the artifact CSP would block an icon-font CDN anyway.

const NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  // Menu — a list, clearer at 22px than any beer glass silhouette.
  list: ['M4 6h.01', 'M4 12h.01', 'M4 18h.01', 'M9 6h11', 'M9 12h11', 'M9 18h11'],

  // Design — a paint droplet reads as "colour/theme".
  droplet: ['M12 3c3.5 4 6 7 6 10a6 6 0 0 1-12 0c0-3 2.5-6 6-10z'],

  // Screens — a monitor on a stand.
  monitor: [
    'M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    'M12 17v4',
    'M8 21h8'
  ],

  // Settings — sliders, not a cog. A stroke-only gear needs teeth thin enough
  // that at 22px it just reads as a sunburst; sliders stay legible and say
  // "controls" just as clearly. The tracks break around each handle so the
  // line does not run straight through it.
  sliders: [
    'M4 8h8.6', 'M17.4 8H20',
    'M15 5.6a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 1 1 0-4.8',
    'M4 16h2.6', 'M11.4 16H20',
    'M9 13.6a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 1 1 0-4.8'
  ],

  chevronUp: ['M6 14l6-6 6 6'],
  chevronDown: ['M6 10l6 6 6-6'],
  x: ['M6 6l12 12', 'M18 6L6 18'],
  plus: ['M12 5v14', 'M5 12h14'],

  trash: [
    'M4 7h16',
    'M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
    'M6.5 7l.9 12.1a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9L17.5 7',
    'M10 11.5v5',
    'M14 11.5v5'
  ],

  pencil: ['M4 20h4L18.5 9.5a2.83 2.83 0 1 0-4-4L4 16v4z', 'M13.5 6.5l4 4'],

  image: [
    'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
    'M8.5 10.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
    'M21 16l-5.5-5.5L5 21'
  ],

  upload: ['M12 16V4', 'M8 8l4-4 4 4', 'M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3'],

  refresh: ['M20.5 12a8.5 8.5 0 1 1-2.6-6.1', 'M20.5 4v5h-5'],

  external: [
    'M14 4h6v6',
    'M20 4l-8.5 8.5',
    'M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4'
  ],

  power: ['M12 4v8', 'M7.5 6.6a7 7 0 1 0 9 0']

};

/** Build an icon element. Returns an empty span for an unknown name. */
export function icon(name, size = 20) {
  const paths = PATHS[name];
  if (!paths) return document.createElement('span');

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  for (const d of paths) {
    const node = document.createElementNS(NS, 'path');
    node.setAttribute('d', d);
    svg.appendChild(node);
  }
  return svg;
}
