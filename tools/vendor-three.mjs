// Re-create vendor/three/ from the pinned npm package (three@0.186.1).
// Usage: npm run vendor:three
// This is a one-off vendoring step, not a site build: the generated file is committed.
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const threePkg = JSON.parse(await readFile(path.join(root, 'node_modules/three/package.json'), 'utf8'));
if (threePkg.version !== '0.186.1') {
  throw new Error(`expected three@0.186.1, found ${threePkg.version}`);
}
const outDir = path.join(root, 'vendor/three');
await mkdir(outDir, { recursive: true });
const outfile = path.join(outDir, 'three.min.js');
await build({
  entryPoints: [path.join(root, 'tools/three-entry.mjs')],
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'es2020',
  legalComments: 'eof',
  outfile,
  banner: {
    js: `/* three.js ${threePkg.version} (npm "three"), tree-shaken subset listed in tools/three-entry.mjs. MIT License, see LICENSE. */`,
  },
});
await copyFile(path.join(root, 'node_modules/three/LICENSE'), path.join(outDir, 'LICENSE'));
await writeFile(
  path.join(outDir, 'VERSION'),
  `three ${threePkg.version}\nbundled by tools/vendor-three.mjs with esbuild\n`,
);
console.log(`wrote ${path.relative(root, outfile)}`);
