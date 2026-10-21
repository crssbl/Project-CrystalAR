// Pure: the alt text of the story's pre-rendered stills (the stage without WebGL). Kept out of
// story-text.js so the 3D path does not load it: story.js imports it when the stills take over.
import { spaceGroupText, latticeToken, fixed } from './format.js';
import { STEPS } from './story-timeline.js';
import { regionLengthsA, siteKind, LEVELS } from './regions.js';

// Plain-text list: 'a', 'a and b', 'a, b and c'.
const listText = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items.join(''));

/**
 * A short sentence on what the still of step `index` shows (see stillProgress for the moment
 * each still pictures), from the same trace values as the readout.
 */
export function stillAltText(trace, index, steps = STEPS) {
  const { spaceGroup: sg, sites, lattice } = trace;
  const names = (list) => listText(list.map((s) => `${s.element} ${s.wyckoff}`));
  const free = sites.filter((s) => s.dof > 0);
  const manifolds = listText([...new Set(free.map((s) => `the ${siteKind(s.dof)} ${s.form.text}`))]);
  switch (steps[index]?.id) {
    case 'group':
      return `Space group ${spaceGroupText(sg.symbol)} (No. ${sg.number}): an empty cell, with dots where its ${sg.operations} symmetry operations send one general point.`;
    case 'template':
      return `The Wyckoff template: ${names(sites.filter((s) => s.dof === 0))} as atoms at fixed points, and ${manifolds} that holds ${names(free)}.`;
    case 'lattice': {
      const values = lattice.active.map(({ name, value }) => {
        const t = latticeToken(name, value);
        return `${t.label} = ${t.text}`;
      });
      return `The ${lattice.family} cell, ${listText(values)}, around the template sites.`;
    }
    case 'refine': {
      const w = Math.max(...sites.flatMap((s) => regionLengthsA(s, LEVELS)));
      return `Level ${LEVELS} of ${LEVELS}: ${names(free)} placed on ${manifolds}, each in a region of width 1/${2 ** LEVELS}, about ${fixed(w, w < 0.1 ? 3 : 2)} Å.`;
    }
    case 'expand':
      return `Symmetry expansion half-way: the copies of each site spread across its orbit, ${sites.map((s) => s.multiplicity).join(' + ')} = ${trace.atoms.length} atoms, some still growing.`;
    default:
      return `The finished ${trace.formula} unit cell: ${trace.atoms.length} atoms of ${listText(trace.formula.match(/[A-Z][a-z]?/g))} in a ${lattice.family} cell.`;
  }
}
