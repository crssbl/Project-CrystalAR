import { readFile, writeFile } from 'node:fs/promises';
import { manifoldSvg, methodSvg } from '../js/lib/illustrations.js';
import { replaceBetween } from './render-gallery.mjs';

const file = new URL('../index.html', import.meta.url);
let html = await readFile(file, 'utf8');
const names = ['Point', 'Line', 'Plane', 'Volume'];
html = replaceBetween(html, 'manifolds', names.map((name, i) => `<li class="manifold-card">${manifoldSvg(i)}<h3>${name}</h3><p>${i} free ${i === 1 ? 'parameter' : 'parameters'}</p></li>`).join('\n'));
const titles = ['Template first', 'Lattice next', 'Coordinates, coarse to fine'];
const text = ['Write an element and a Wyckoff position for each site.', 'Generate the active lattice variables for the crystal family.', 'Refine all free sites jointly across nine dyadic levels.'];
html = replaceBetween(html, 'method-cards', ['template', 'lattice', 'coordinates'].map((kind, i) => `<li class="method-card" data-method-cycle>${methodSvg(kind)}<h3>${titles[i]}</h3><p>${text[i]}</p></li>`).join('\n'));
await writeFile(file, html);
