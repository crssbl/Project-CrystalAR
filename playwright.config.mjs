// End-to-end tests run against a plain static server under the same /Project-CrystalAR/
// subpath that GitHub Pages uses. No absolute paths are committed: the serve directory is
// CRYSTALAR_SERVE_DIR (or a temp dir) holding a symlink named Project-CrystalAR → this repo.
import { defineConfig, devices } from '@playwright/test';
import { lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const serveDir = process.env.CRYSTALAR_SERVE_DIR || path.join(os.tmpdir(), 'crystalar-serve');
const port = Number(process.env.CRYSTALAR_PORT || 8791);
const python = process.env.CRYSTALAR_PYTHON || 'python3';

mkdirSync(serveDir, { recursive: true });
const link = path.join(serveDir, 'Project-CrystalAR');
const existing = lstatSync(link, { throwIfNoEntry: false });
if (existing?.isSymbolicLink() && path.resolve(serveDir, readlinkSync(link)) !== repoRoot) unlinkSync(link);
if (!lstatSync(link, { throwIfNoEntry: false })) symlinkSync(repoRoot, link, 'dir');

const gpuArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 2,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}/Project-CrystalAR/`,
    launchOptions: { args: gpuArgs },
    trace: 'off',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: `${python} -m http.server --bind 127.0.0.1 ${port} --directory "${serveDir}"`,
    url: `http://127.0.0.1:${port}/Project-CrystalAR/index.html`,
    reuseExistingServer: true,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
