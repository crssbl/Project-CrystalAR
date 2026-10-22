// Re-create the self-hosted fonts in assets/fonts/ from the pinned Fontsource packages, the
// same way tools/vendor-three.mjs re-creates vendor/three/.
// Usage: npm run vendor:fonts   (fetches the packages with `npm pack`, so it needs the network)
// The woff2 files are copied unmodified; each package's LICENSE (SIL OFL 1.1) becomes
// OFL-<family>.txt, and assets/fonts/VERSION records the packages and their version.
// This is a one-off vendoring step, not a site build: the files are committed.
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The README's font table and tests/unit/tooling.test.mjs are checked against this version.
export const VERSION = '5.3.0';
export const FONTS = [
  { pkg: '@fontsource/sora', licence: 'OFL-Sora.txt', files: ['sora-latin-600-normal.woff2'] },
  {
    pkg: '@fontsource/ibm-plex-sans',
    licence: 'OFL-IBM-Plex-Sans.txt',
    files: [
      'ibm-plex-sans-latin-400-normal.woff2', 'ibm-plex-sans-latin-500-normal.woff2',
      'ibm-plex-sans-latin-600-normal.woff2', 'ibm-plex-sans-greek-400-normal.woff2',
      'ibm-plex-sans-greek-500-normal.woff2', 'ibm-plex-sans-greek-600-normal.woff2',
    ],
  },
  {
    pkg: '@fontsource/ibm-plex-mono',
    licence: 'OFL-IBM-Plex-Mono.txt',
    files: ['ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-latin-500-normal.woff2'],
  },
];

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = path.join(root, 'assets/fonts');
  const work = await mkdtemp(path.join(os.tmpdir(), 'vendor-fonts-'));
  try {
    for (const { pkg, licence, files } of FONTS) {
      const packed = JSON.parse(execFileSync('npm', ['pack', `${pkg}@${VERSION}`, '--json', '--pack-destination', work], {
        encoding: 'utf8', shell: process.platform === 'win32',
      }));
      const dir = path.join(work, path.basename(packed[0].filename, '.tgz'));
      await mkdir(dir, { recursive: true });
      execFileSync('tar', ['-xzf', path.join(work, packed[0].filename), '-C', dir]);
      const meta = JSON.parse(await readFile(path.join(dir, 'package/package.json'), 'utf8'));
      if (meta.name !== pkg || meta.version !== VERSION) throw new Error(`expected ${pkg}@${VERSION}, found ${meta.name}@${meta.version}`);
      for (const file of files) await copyFile(path.join(dir, 'package/files', file), path.join(outDir, file));
      await copyFile(path.join(dir, 'package/LICENSE'), path.join(outDir, licence));
      console.log(`${pkg}@${VERSION}: ${files.join(', ')} and ${licence}`);
    }
    await writeFile(
      path.join(outDir, 'VERSION'),
      `${FONTS.map(({ pkg }) => `${pkg} ${VERSION}`).join('\n')}\ncopied unmodified by tools/vendor-fonts.mjs\n`,
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
