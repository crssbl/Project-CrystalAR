// Repository-wide content rules: no venue or review-status wording, no absolute local paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'test-results', 'playwright-report', '.pytest_cache', '__pycache__']);
const TEXT = /\.(html|css|js|mjs|json|md|txt|cif|svg|py|cfg|toml|ini)$/i;

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (TEXT.test(entry.name) && entry.name !== 'local_config.json') out.push(full);
  }
  return out;
}

const files = await walk(root);
const rel = (f) => path.relative(root, f);

// Built from fragments so this file does not contain the words itself.
const FORBIDDEN = [
  new RegExp(['IC', 'LR'].join(''), 'i'),
  new RegExp(['Open', 'Review'].join(''), 'i'),
  new RegExp(['under', '\\s+', 'review'].join(''), 'i'),
  new RegExp(['sub', 'mission'].join(''), 'i'),
  new RegExp(['\\b', '20', '27', '\\b'].join('')),
];
// Third-party code is not page content; its minified numbers can contain any digits.
const isThirdParty = (f) => rel(f).startsWith(`vendor${path.sep}`) || /OFL-.*\.txt$/.test(f);

test('the permanent results anchor occurs once on the Benchmarks section and the top bar links to it', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const targets = [...html.matchAll(/<([a-z][\w-]*)\b[^>]*\sid\s*=\s*(["'])results\2[^>]*>/gi)];
  assert.equal(targets.length, 1, 'exactly one element has id="results"');
  assert.equal(targets[0][1], 'section');
  assert.match(targets[0][0], /aria-labelledby="results-title"/);
  const section = html.slice(targets[0].index).match(/^[\s\S]*?<\/section>/)[0];
  assert.match(section, /<p class="kicker"><span class="num">06<\/span>Benchmarks<\/p>/);
  assert.match(section, /<h2 id="results-title">/);
  assert.match(section, /class="number-cards"/);
  assert.match(section, /id="paper-tables"/);
  const topbar = html.match(/<header\b[^>]*\sid="topbar"[^>]*>[\s\S]*?<\/header>/)[0];
  assert.match(topbar, /<nav\b[^>]*>[\s\S]*?<a href="#results">Results<\/a>[\s\S]*?<\/nav>/);
});

test('no venue or review-status wording anywhere in the site', async () => {
  const hits = [];
  for (const file of files) {
    if (isThirdParty(file)) continue;
    const text = await readFile(file, 'utf8');
    for (const pattern of FORBIDDEN) {
      const m = text.match(pattern);
      if (m) hits.push(`${rel(file)}: "${m[0]}"`);
    }
  }
  assert.deepEqual(hits, []);
});

test('committed files contain no absolute local paths', async () => {
  const LOCAL = [/\/public\/home\//, /\/tmp\/crystalar/i, new RegExp(['chen', 'rs'].join('') + '\\b'), /[A-Z]:\\\\Users\\\\/];
  const hits = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    for (const pattern of LOCAL) if (pattern.test(text)) hits.push(`${rel(file)}: ${pattern}`);
  }
  assert.deepEqual(hits, []);
});

test('every file eligible for commit keeps private source identifiers and hashes local', async () => {
  // Scan the entire publishable working tree, including new files, binary assets and
  // extensionless files. Use .gitignore directly so this test needs no Git subprocess.
  const rules = (await readFile(path.join(root, '.gitignore'), 'utf8')).split('\n')
    .map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map((rule) => {
      const directory = rule.endsWith('/');
      const body = (directory ? rule.slice(0, -1) : rule)
        .replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
      return new RegExp(`${rule.includes('/') && !directory ? '^' : '(?:^|/)'}${body}${directory ? '(?:/|$)' : '$'}`);
    });
  const names = [];
  async function publishable(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      const name = rel(file).split(path.sep).join('/');
      if (entry.name === '.git' || rules.some((rule) => rule.test(name))) continue;
      if (entry.isDirectory()) await publishable(file);
      else if (entry.isFile()) names.push(name);
    }
  }
  await publishable(root);
  const privatePatterns = [
    new RegExp(['benchmark', '/', 'artifacts'].join(''), 'i'),
    new RegExp(['crystalar_', '(?:ablation|a\\d+)', '_'].join(''), 'i'),
    new RegExp(['native', '_sgbs'].join(''), 'i'),
    new RegExp(['\\b', '[a-f0-9]', '{64}', '\\b'].join(''), 'i'),
  ];
  const identifiers = [
    new RegExp(['(?<![A-Za-z0-9_])', 'A', '\\d{1,3}', '(?![A-Za-z0-9])'].join('')),
    new RegExp(['(?<![.\\d])', '20', '\\d{2}[-_]?(?:0[1-9]|1[0-2])[-_]?(?:0[1-9]|[12]\\d|3[01])(?![.\\d])'].join('')),
  ];
  const hits = [];
  for (const name of names) {
    const file = path.join(root, name);
    const bytes = await readFile(file);
    const text = bytes.toString('utf8');
    for (const pattern of privatePatterns) if (pattern.test(`${name}\n${text}`)) hits.push(`${name}: ${pattern}`);
    // Short letter/digit combinations in compressed font/image payloads are not identifiers.
    // Check their filenames; apply identifier/date rules to valid UTF-8 content as well.
    let readable = '';
    try { readable = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* binary payload */ }
    for (const pattern of identifiers) if (pattern.test(`${name}\n${readable}`)) hits.push(`${name}: ${pattern}`);
  }
  assert.ok(names.includes('tests/unit/site-content.test.mjs'), 'this test also scans itself');
  assert.deepEqual(hits, []);
});

test('no third-party scripts, CDNs or analytics in the page', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  for (const src of scripts) assert.ok(!/^(https?:)?\/\//.test(src), src);
  const styles = [...html.matchAll(/<link\s+rel="(?:stylesheet|preload|icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  for (const href of styles) assert.ok(!/^(https?:)?\/\//.test(href), href);
  assert.doesNotMatch(html, /googletagmanager|google-analytics|plausible|gtag\(/i);
});
