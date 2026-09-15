// Shared design-token system. Pure JS: imported by the Node server AND the browser.
// No DOM and no node APIs in this file.

export const FONT_STACKS = {
  system:    'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  condensed: '"Oswald", "Archivo Narrow", "Arial Narrow", "Haettenschweiler", Impact, system-ui, sans-serif',
  grotesk:   '"Inter", "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif',
  serif:     '"Playfair Display", Georgia, "Times New Roman", Times, serif',
  slab:      '"Roboto Slab", Rockwell, Georgia, serif',
  mono:      '"JetBrains Mono", Consolas, "SF Mono", Menlo, "Courier New", monospace',
  marker:    '"Permanent Marker", "Bradley Hand", "Segoe Script", cursive'
};

// Families we can pull from Google Fonts when the screen has internet.
// Falls back silently to the stacks above when offline (e.g. venue wifi drops).
export const WEBFONT_FAMILIES = {
  condensed: 'Oswald:wght@400;500;600;700',
  grotesk:   'Inter:wght@400;500;600;700;800',
  serif:     'Playfair+Display:wght@500;600;700;800',
  slab:      'Roboto+Slab:wght@400;500;700',
  mono:      'JetBrains+Mono:wght@400;500;700',
  marker:    'Permanent+Marker'
};

export const DEFAULT_THEME = {
  preset: 'midnight',

  // palette
  bg: '#0b0e13',
  bgAlt: '#12171f',
  surface: '#151b24',
  text: '#f4f7fa',
  muted: '#93a1b3',
  accent: '#e8b04b',
  accentText: '#14181f',
  border: '#242c38',

  // type
  headingFont: 'condensed',
  bodyFont: 'grotesk',
  headingWeight: 700,
  uppercaseHeadings: true,
  letterSpacing: 0.01,
  webfonts: true,

  // layout
  orientation: 'landscape',  // landscape | portrait | portraitLeft | auto
  columns: 2,      // 0 = auto-fit
  density: 1,      // global type scale multiplier
  radius: 14,
  safeArea: 2.2,   // % inset for TV overscan
  rowDividers: true,
  zebra: false,
  accentBar: true,

  // fields shown on the display
  showTapNumbers: true,
  showAbv: true,
  showIbu: true,
  showOrigin: true,
  showStyle: true,
  showDescription: false,
  showImages: false,
  showColorSwatch: true,

  // behaviour
  rotateSeconds: 12,   // page rotation when content overflows
  showClock: true,
  showHeader: true,
  showFooter: true,
  transition: 'fade',   // fade | slide | none
  posterTransition: 'none' // none | beer | ice | curtain; outgoing menu to poster only
};

export const PRESETS = {
  bistro: {
    label: 'Parisian Bistro', description: 'Classic cream, serif headings and fine rules',
    bg: '#f5efdf', bgAlt: '#e9dfc8', surface: '#fffaf0', text: '#272820', muted: '#62624d',
    accent: '#365847', accentText: '#ffffff', border: '#c9c1aa', headingFont: 'serif', bodyFont: 'serif',
    uppercaseHeadings: false, accentBar: false, rowDividers: true, zebra: false, radius: 0, menuStyle: 'bistro'
  },
  coastal: {
    label: 'Coastal', description: 'Airy blue panels with rounded menu rows',
    bg: '#edf6f7', bgAlt: '#d5e9ed', surface: '#ffffff', text: '#123943', muted: '#486974',
    accent: '#096e82', accentText: '#ffffff', border: '#b8d4db', headingFont: 'grotesk', bodyFont: 'grotesk',
    uppercaseHeadings: false, accentBar: false, rowDividers: false, zebra: true, radius: 20, menuStyle: 'coastal'
  },
  marquee: {
    label: 'Marquee', description: 'Bold gold headings for a late-night venue',
    bg: '#171116', bgAlt: '#30202b', surface: '#241b22', text: '#fff1d6', muted: '#c8ac91',
    accent: '#edc16e', accentText: '#201519', border: '#70583a', headingFont: 'serif', bodyFont: 'grotesk',
    uppercaseHeadings: true, accentBar: false, rowDividers: true, zebra: false, radius: 0, menuStyle: 'marquee'
  },
  market: {
    label: 'Fresh Market', description: 'Warm green with framed section headings',
    bg: '#f0f1e5', bgAlt: '#e0e6ce', surface: '#fafbef', text: '#253b28', muted: '#59694d',
    accent: '#426b32', accentText: '#ffffff', border: '#bcc8a9', headingFont: 'slab', bodyFont: 'grotesk',
    uppercaseHeadings: false, accentBar: false, rowDividers: false, zebra: true, radius: 8, menuStyle: 'market'
  },
  stadium: {
    label: 'Stadium', description: 'Big block headings and high-contrast rows',
    bg: '#101b30', bgAlt: '#172d49', surface: '#1b304b', text: '#f6f8ff', muted: '#aabbd0',
    accent: '#ffce45', accentText: '#101b30', border: '#3a5270', headingFont: 'condensed', bodyFont: 'mono',
    uppercaseHeadings: true, accentBar: true, rowDividers: false, zebra: true, radius: 2, menuStyle: 'stadium'
  },
  midnight: {
    label: 'Midnight',
    bg: '#0b0e13', bgAlt: '#12171f', surface: '#151b24',
    text: '#f4f7fa', muted: '#93a1b3', accent: '#e8b04b', accentText: '#14181f', border: '#242c38',
    headingFont: 'condensed', bodyFont: 'grotesk', zebra: false, accentBar: true
  },
  chalkboard: {
    label: 'Chalkboard',
    bg: '#161a17', bgAlt: '#1b201c', surface: '#1e231f',
    text: '#f3efe4', muted: '#a8b0a2', accent: '#e6ddc4', accentText: '#1b201c', border: '#2f362f',
    headingFont: 'marker', bodyFont: 'serif', zebra: false, accentBar: false, rowDividers: true
  },
  neon: {
    label: 'Neon',
    bg: '#05060d', bgAlt: '#0a0c18', surface: '#0d1020',
    text: '#f2f4ff', muted: '#7c86b5', accent: '#31e5ff', accentText: '#05060d', border: '#1b2140',
    headingFont: 'grotesk', bodyFont: 'grotesk', zebra: false, accentBar: true, uppercaseHeadings: true
  },
  taproom: {
    label: 'Taproom',
    bg: '#17110c', bgAlt: '#1f1710', surface: '#241a12',
    text: '#f6ecdf', muted: '#b29a80', accent: '#d98324', accentText: '#17110c', border: '#3a2a1c',
    headingFont: 'slab', bodyFont: 'slab', zebra: true, accentBar: false
  },
  paper: {
    label: 'Paper (light)',
    bg: '#f7f4ee', bgAlt: '#efeae0', surface: '#ffffff',
    text: '#1a1a18', muted: '#6b6659', accent: '#8c1d18', accentText: '#ffffff', border: '#ddd6c8',
    headingFont: 'serif', bodyFont: 'serif', zebra: false, accentBar: false, rowDividers: true
  },
  industrial: {
    label: 'Industrial',
    bg: '#101214', bgAlt: '#16191c', surface: '#1a1e22',
    text: '#e8ecef', muted: '#8d979f', accent: '#f2f2f2', accentText: '#101214', border: '#2a3036',
    headingFont: 'condensed', bodyFont: 'mono', zebra: false, accentBar: true, uppercaseHeadings: true
  },
  sunset: {
    label: 'Sunset',
    bg: '#1a0f1d', bgAlt: '#241428', surface: '#28162d',
    text: '#fdeef5', muted: '#b891ad', accent: '#ff7a59', accentText: '#1a0f1d', border: '#3d2142',
    headingFont: 'grotesk', bodyFont: 'grotesk', zebra: false, accentBar: true
  },
  forest: {
    label: 'Forest',
    bg: '#0c1410', bgAlt: '#111c16', surface: '#13201a',
    text: '#eef5f0', muted: '#8aa697', accent: '#7ed6a5', accentText: '#0c1410', border: '#1f3229',
    headingFont: 'slab', bodyFont: 'grotesk', zebra: false, accentBar: true
  }
};

export const ORIENTATIONS = {
  landscape:    { label: 'Landscape', rotate: 0 },
  portrait:     { label: 'Portrait — rotate right', rotate: 90 },
  portraitLeft: { label: 'Portrait — rotate left', rotate: 270 },
  auto:         { label: 'Match the screen', rotate: 0 }
};

/** Degrees the board must be rotated to sit upright on a physical panel. */
export function rotationFor(theme) {
  const o = ORIENTATIONS[theme && theme.orientation];
  return o ? o.rotate : 0;
}

export const STATUSES = {
  on:   { label: 'Pouring' },
  low:  { label: 'Almost gone' },
  soon: { label: 'Coming soon' },
  off:  { label: 'Kicked' }
};

export const SECTION_KINDS = {
  draft:    { label: 'Draft' },
  can:      { label: 'Cans & Bottles' },
  cocktail: { label: 'Cocktails' },
  wine:     { label: 'Wine' },
  na:       { label: 'Non-alcoholic' },
  food:     { label: 'Food' },
  custom:   { label: 'Custom' }
};

function clean(o) {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) {
    if (v !== null && v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

/** Merge DEFAULT_THEME <- preset <- global theme <- board overrides. */
export function resolveTheme(globalTheme, boardTheme) {
  const g = clean(globalTheme);
  const b = clean(boardTheme);
  const preset = b.preset || g.preset || DEFAULT_THEME.preset;
  const presetVals = PRESETS[preset] ? { ...PRESETS[preset] } : {};
  delete presetVals.label;
  return { ...DEFAULT_THEME, ...presetVals, ...g, ...b, preset };
}

/** Turn a resolved theme into the CSS custom properties the display consumes. */
export function themeToCssVars(t) {
  return {
    '--bg': t.bg,
    '--bg-alt': t.bgAlt,
    '--surface': t.surface,
    '--text': t.text,
    '--muted': t.muted,
    '--accent': t.accent,
    '--accent-text': t.accentText,
    '--border': t.border,
    '--font-heading': FONT_STACKS[t.headingFont] || FONT_STACKS.system,
    '--font-body': FONT_STACKS[t.bodyFont] || FONT_STACKS.system,
    '--heading-weight': String(t.headingWeight == null ? 700 : t.headingWeight),
    '--heading-transform': t.uppercaseHeadings ? 'uppercase' : 'none',
    '--tracking': (t.letterSpacing == null ? 0 : t.letterSpacing) + 'em',
    '--radius': (t.radius == null ? 12 : t.radius) + 'px',
    '--safe': (t.safeArea == null ? 2 : t.safeArea) + '%',
    '--density': String(t.density == null ? 1 : t.density)
  };
}

/** Bare family names in use ("Oswald", "Inter"), for document.fonts.load(). */
export function webfontFamilies(t) {
  if (!t.webfonts) return [];
  return [t.headingFont, t.bodyFont]
    .map(k => WEBFONT_FAMILIES[k])
    .filter(Boolean)
    .map(f => f.split(':')[0].replace(/\+/g, ' '));
}

/** Google Fonts href for the families in use, or null when webfonts are off. */
export function webfontHref(t) {
  if (!t.webfonts) return null;
  const fams = new Set();
  if (WEBFONT_FAMILIES[t.headingFont]) fams.add(WEBFONT_FAMILIES[t.headingFont]);
  if (WEBFONT_FAMILIES[t.bodyFont]) fams.add(WEBFONT_FAMILIES[t.bodyFont]);
  if (!fams.size) return null;
  return 'https://fonts.googleapis.com/css2?' +
    [...fams].map(f => 'family=' + f).join('&') + '&display=swap';
}
