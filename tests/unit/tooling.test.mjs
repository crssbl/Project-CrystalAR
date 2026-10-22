// Tooling: exact pins, one Node baseline that every pinned tool accepts (and the README states),
// the font provenance in the README, and review notes kept out of git.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { FONTS, VERSION as FONT_VERSION } from '../../tools/vendor-fonts.mjs';

const read = (rel) => readFile(new URL(`../../${rel}`, import.meta.url), 'utf8');
const pkg = JSON.parse(await read('package.json'));
const lock = JSON.parse(await read('package-lock.json'));
const readme = await read('README.md');

// Just enough semver for "engines" fields: ">=x.y", ">= x.*", "^x.y.z", "~x.y", "x", "x.*", "a b", "||".
const parseVersion = (text) => {
  const parts = text.replace(/^v/, '').split('.');
  return [0, 1, 2].map((i) => (parts[i] === undefined || /^[*x]$/i.test(parts[i]) ? null : Number(parts[i])));
};
const compare = (a, b) => {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
};
function matches(v, comparator) {
  const m = comparator.match(/^(>=|<=|>|<|\^|~|=)?v?(\d+(?:\.(?:\d+|[*x]))*)$/i);
  if (!m) throw new Error(`unsupported engines range "${comparator}"`);
  const target = parseVersion(m[2]);
  const floor = target.map((x) => x ?? 0);
  switch (m[1] ?? '') {
    case '>=': return compare(v, floor) >= 0;
    case '>': return compare(v, floor) > 0;
    case '<=': return compare(v, floor) <= 0;
    case '<': return compare(v, floor) < 0;
    case '^': return compare(v, floor) >= 0 && v[0] === floor[0];
    case '~': return compare(v, floor) >= 0 && v[0] === floor[0] && (target[1] === null || v[1] === floor[1]);
    default: return target.every((x, i) => x === null || x === v[i]);
  }
}
function satisfies(version, range) {
  const v = parseVersion(version).map((x) => x ?? 0);
  if (['', '*'].includes(range.trim())) return true;
  return range.split('||').some((alt) => alt.trim().replace(/(>=|<=|>|<|\^|~|=)\s+/g, '$1').split(/\s+/)
    .every((comparator) => matches(v, comparator)));
}

test('the engines helper reads the ranges used by the pinned tools', () => {
  assert.ok(satisfies('20.17.0', '>=18.16'));
  assert.ok(!satisfies('20.17.0', '>=22.19'));
  assert.ok(satisfies('20.17.0', '20 || >=22') && !satisfies('21.1.0', '20 || >=22'));
  assert.ok(satisfies('20.17.0', '>= 20.6.0') && !satisfies('20.5.1', '>= 20.6.0'));
  assert.ok(!satisfies('20.17.0', '^20.19.0 || >= 22.12.0'));
  assert.ok(satisfies('14.18.0', '>=16 || 14 >=14.17') && satisfies('9.0.0', '6.* || 8.* || >= 10.*') === false);
});

test('dev dependencies are pinned to exact versions', () => {
  for (const [name, version] of Object.entries(pkg.devDependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name}@${version}`);
    assert.equal(lock.packages[`node_modules/${name}`]?.version, version, `${name} in package-lock.json`);
  }
});

test('every pinned tool accepts every Node version that package.json declares', () => {
  const declared = pkg.engines.node;
  assert.equal(lock.packages[''].engines?.node, declared, 'package-lock.json is in sync with package.json');
  assert.ok(satisfies(process.version, declared), `this Node (${process.version}) is outside ${declared}`);
  assert.ok(satisfies('20.17.0', declared), 'the host baseline, Node 20.17.0, is accepted');
  const ranges = Object.entries(lock.packages)
    .filter(([key, meta]) => key && meta.engines?.node)
    .map(([key, meta]) => [key.replace(/^.*node_modules\//, ''), meta.engines.node]);
  assert.ok(ranges.length > 20);
  const probes = ['20.17.0', '20.18.3', '20.19.5', '21.0.0', '21.7.3', '22.0.0', '22.12.0', '22.19.0', '24.0.0', '25.1.0'];
  for (const probe of probes.filter((v) => satisfies(v, declared))) {
    for (const [name, range] of ranges) assert.ok(satisfies(probe, range), `${name} (node ${range}) rejects Node ${probe}`);
  }
  assert.ok(satisfies('20.17.0', lock.packages['node_modules/html-validate'].engines.node));
});

test('README states the Node range and the pinned tool versions', () => {
  assert.ok(readme.includes(pkg.engines.node), 'Node range');
  for (const name of ['html-validate', '@playwright/test']) {
    assert.ok(readme.includes(`${name}@${pkg.devDependencies[name]}`), name);
  }
});

test('Lighthouse stays outside repository dependencies and README pins the scratch install', () => {
  assert.equal(pkg.devDependencies.lighthouse, undefined);
  assert.equal(lock.packages[''].devDependencies.lighthouse, undefined);
  assert.ok(!Object.keys(lock.packages).some((name) => /(?:^|\/)lighthouse(?:\/|$)/.test(name)));
  assert.match(readme, /npm install --prefix "\$lh_scratch" --no-save --package-lock=false lighthouse@12\.8\.2/);
  assert.match(readme, /13\.x requires Node ≥ 22\.19/);
  assert.match(readme, /PageSpeed Insights.*https:\/\/pagespeed\.web\.dev\//);
});

test('README records where every self-hosted font file comes from', async () => {
  const fonts = (await readdir(new URL('../../assets/fonts/', import.meta.url))).filter((f) => f.endsWith('.woff2'));
  assert.equal(fonts.length, FONTS.flatMap((f) => f.files).length + 1);
  for (const file of fonts) assert.ok(readme.includes(file), file);
  // One version, from tools/vendor-fonts.mjs: the README names it for every package and no
  // other, and assets/fonts/VERSION (written by the script) records the same.
  for (const { pkg } of FONTS) assert.ok(readme.includes(`${pkg}@${FONT_VERSION}`), `${pkg}@${FONT_VERSION}`);
  const named = [...readme.matchAll(/@fontsource\/[a-z0-9-]+@([^\s`|]+)/g)].map((m) => m[1]);
  assert.ok(named.length >= FONTS.length);
  for (const version of named) assert.equal(version, FONT_VERSION, 'README names another Fontsource version');
  const recorded = (await read('assets/fonts/VERSION')).split('\n').filter((line) => line.startsWith('@fontsource/'));
  assert.deepEqual(recorded, FONTS.map(({ pkg }) => `${pkg} ${FONT_VERSION}`));
  // The subset ranges match the @font-face rules.
  const css = await read('assets/css/site.css');
  const ranges = new Set([...css.matchAll(/unicode-range:\s*([^;]+);/g)].map((m) => m[1].trim()));
  assert.equal(ranges.size, 3);
  for (const range of ranges) assert.ok(readme.includes(range), range);
  // tools/vendor-fonts.mjs re-creates exactly these files, and every one is used by the CSS.
  assert.deepEqual([...FONTS.flatMap((f) => f.files), 'dejavu-sans-symbols-2.37.woff2'].sort(), [...fonts].sort());
  const licences = (await readdir(new URL('../../assets/fonts/', import.meta.url))).filter((f) => f.startsWith('OFL-'));
  assert.deepEqual(FONTS.map((f) => f.licence).sort(), licences.sort());
  for (const file of fonts) assert.ok(css.includes(`../fonts/${file}`), `${file} in site.css`);
});

test('agent and review notes stay out of git', async () => {
  const ignore = (await read('.gitignore')).split('\n').map((line) => line.trim());
  assert.ok(ignore.includes('.agents/'));
});
