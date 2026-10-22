// Parameter-space schematics: no decorative cell or subdivision grid.
import { escapeHtml } from './format.js';

const svg = (label, body, extra = '') => `<svg viewBox="0 0 280 160" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(label)}" ${extra}>${body}</svg>`;
const atom = '<circle class="diagram-atom" cx="140" cy="80" r="8"/>';

export function manifoldSvg(rank) {
  if (!Number.isInteger(rank) || rank < 0 || rank > 3) throw new RangeError('rank must be 0, 1, 2 or 3');
  const names = ['A fixed point: no free coordinate', 'A line: one free coordinate', 'A plane: two free coordinates', 'A volume: three free coordinates'];
  const shapes = [
    '<path class="diagram-guide" d="M120 80h40M140 60v40"/>',
    '<path class="diagram-region" d="M38 80h204"/>',
    '<path class="diagram-area" d="M58 106 100 48 228 54 186 112Z"/>',
    '<ellipse class="diagram-area" cx="140" cy="80" rx="96" ry="48"/><path class="diagram-guide" d="M44 80h192M140 32v96M88 116 192 44"/>',
  ];
  return svg(names[rank], shapes[rank] + atom, `data-rank="${rank}"`);
}

export function methodSvg(kind) {
  if (kind === 'template') return svg('Elements and Wyckoff positions are written in generation order',
    ['Cl · 2b', 'La · 4d', 'La · 6g', 'Bi · 6g'].map((text, i) => `<g class="method-token cycle-${i}"><rect x="${16 + (i % 2) * 132}" y="${32 + Math.floor(i / 2) * 56}" width="116" height="40" rx="20"/><text x="${74 + (i % 2) * 132}" y="${57 + Math.floor(i / 2) * 56}" text-anchor="middle">${text}</text></g>`).join(''));
  if (kind === 'lattice') return svg('The hexagonal example uses volume and the c over a ratio',
    '<path class="diagram-guide" d="M42 116h196M60 130V30"/><g class="lattice-cycle"><ellipse class="diagram-area" cx="150" cy="80" rx="65" ry="38"/><path class="diagram-region" d="M85 80h130"/></g><text x="150" y="145" text-anchor="middle">V · c/a</text>');
  if (kind === 'coordinates') return svg('Nine levels narrow each free Wyckoff coordinate from coarse to fine',
    '<path class="diagram-guide" d="M32 58h216M32 108h216"/><g class="coordinate-cycle"><path class="diagram-region" d="M40 58h200M40 108h200"/></g><circle class="diagram-atom" cx="140" cy="58" r="7"/><circle class="diagram-atom" cx="140" cy="108" r="7"/>');
  throw new RangeError('unknown method illustration');
}
