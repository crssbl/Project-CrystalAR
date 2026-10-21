// Design tokens and element data. The CSS custom properties in assets/css/site.css
// mirror UI below; tests/unit/palette.test.mjs keeps the two in sync.

export const UI = Object.freeze({
  porcelain: '#F3F5F7', // page background, light cool porcelain
  porcelainDeep: '#E6EAEF',
  paper: '#FBFCFD',
  ink: '#111821',
  ink2: '#2B3542',
  muted: '#55606C',
  faint: '#8B95A1', // decoration only, never body text
  rule: '#D5DBE2',
  accent: '#00753F', // deep jade: the single accent colour
  accentDeep: '#005A30',
  accentTint: '#DCEFE5',
  stage: '#0E1218', // the dark stage, story section only
  stage2: '#161C24',
  stageText: '#E9EEF3',
  stageMuted: '#9DA8B4',
  stageFaint: '#7C8794', // not-yet-written tokens; still ≥ 4.5:1 on the stage
});

// Muted Jmol hues for the 27 gallery elements: OKLCH chroma capped at 0.13.
// Low-chroma colours stay unchanged; S, Cl and Ca are slightly darker for the light cards.
// This is the single element palette for live views, exported images and token/caption dots.
export const ELEMENT_COLORS = Object.freeze({
  Li: '#C18FE4', N: '#4A66B6', O: '#CC675A', Al: '#BFA6A6', Si: '#F0C8A0', P: '#E79055',
  S: '#D0D267', Cl: '#8BD385', Ca: '#8DD383', Sc: '#E6E6E6', Ti: '#BFC2C7', V: '#A6A6AB',
  Mn: '#9C7AC7', Fe: '#D1724D', Co: '#F090A0', Ni: '#7DC679', Cu: '#C88033', Ga: '#C28F8F',
  Br: '#9A3A35', Y: '#94FFFF', Rh: '#0A7D8C', La: '#70D4FF', Pr: '#D9FFC7', Sm: '#8FFFC7',
  Eu: '#80FACB', Ho: '#89F1B4', Bi: '#955BA7',
});

// Covalent radii in Å (Cordero et al. 2008, as tabulated in pymatgen).
export const COVALENT_RADII = Object.freeze({
  Li: 1.28, N: 0.71, O: 0.66, Al: 1.21, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Ca: 1.76,
  Sc: 1.7, Ti: 1.6, V: 1.53, Mn: 1.5, Fe: 1.42, Co: 1.38, Ni: 1.24, Cu: 1.32, Ga: 1.22,
  Br: 1.2, Y: 1.9, Rh: 1.42, La: 2.07, Pr: 2.03, Sm: 1.98, Eu: 1.98, Ho: 1.92, Bi: 1.48,
});

export const FALLBACK_ELEMENT_COLOR = '#B4BCC6';

export function elementColor(symbol) {
  return ELEMENT_COLORS[symbol] ?? FALLBACK_ELEMENT_COLOR;
}

/** Static dot classes, generated into site.css by npm run gallery for no-JS readers too. */
export function elementCss() {
  return Object.entries(ELEMENT_COLORS).map(([el, color]) => `.el-${el} { background: ${color}; }`).join('\n');
}

/** Display radius of an atom sphere in Å (a compact ball model, not space filling). */
export function atomDisplayRadius(symbol) {
  const r = COVALENT_RADII[symbol] ?? 1.3;
  return 0.3 * r + 0.18;
}
