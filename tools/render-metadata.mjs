import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { replaceBetween } from './render-gallery.mjs';
import { escapeHtml as esc } from '../js/lib/format.js';
import { transform, build } from 'esbuild';

const root = new URL('../', import.meta.url);
// Keep readable sources alongside generated delivery files. The story's pure
// helpers share one request; the renderer and WebGL capability cache stay external.
await build({ entryPoints: [new URL('js/render/crystal-view.js', root).pathname],
  outfile: new URL('js/render/crystal-view.min.js', root).pathname,
  minify: true, format: 'esm', target: ['chrome100', 'safari15'], legalComments: 'none' });
await build({ entryPoints: [new URL('js/story.js', root).pathname],
  outfile: new URL('js/story.min.js', root).pathname, bundle: true, minify: true,
  format: 'esm', target: ['chrome100', 'safari15'], legalComments: 'none',
  external: ['./render/crystal-view.min.js', './render/three-loader.js'] });
await build({ entryPoints: [new URL('js/gallery.js', root).pathname],
  outfile: new URL('js/gallery.min.js', root).pathname,
  minify: true, format: 'esm', target: ['chrome100', 'safari15'], legalComments: 'none' });
await build({ entryPoints: [new URL('js/main.js', root).pathname],
  outfile: new URL('js/main.min.js', root).pathname, bundle: true, minify: true,
  format: 'esm', target: ['chrome100', 'safari15'], legalComments: 'none',
  external: ['./illustrations.js', './results.js'] });
const site = JSON.parse(await readFile(new URL('data/site.json', root), 'utf8'));
const canonical = site.canonicalUrl;
const css = await readFile(new URL('assets/css/site.css', root), 'utf8');
const compressed = await transform(css, { loader: 'css', minify: true, target: ['chrome100', 'safari15'] });
await writeFile(new URL('assets/css/site.min.css', root), compressed.code);
export function scholarlyArticle(site) {
  return { '@context': 'https://schema.org', '@type': 'ScholarlyArticle', headline: site.title,
    description: site.description, author: site.authors.map((a) => ({ '@type': 'Person', name: a.name, url: a.url })),
    url: site.canonicalUrl, sameAs: site.arxivUrl, identifier: 'arXiv:2610.27762' };
}
const article = JSON.stringify(scholarlyArticle(site)).replaceAll('<', '\\u003c');
const hash = createHash('sha256').update(article).digest('base64');
const csp = `default-src 'self'; script-src 'self' 'sha256-${hash}'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-src 'none'; worker-src 'none'`;
const tags = `<link rel="canonical" href="${esc(canonical)}">
<link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png" sizes="180x180">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:title" content="${esc(site.title)}">
<meta property="og:description" content="${esc(site.description)}">
<meta property="og:image" content="${esc(new URL('assets/img/og.png', canonical).href)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="CrystalAR: one autoregressive sequence from a Wyckoff template to a symmetric crystal.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(site.title)}">
<meta name="twitter:description" content="${esc(site.description)}">
<meta name="twitter:image" content="${esc(new URL('assets/img/og.png', canonical).href)}">
<meta name="twitter:image:alt" content="CrystalAR: one autoregressive sequence from a Wyckoff template to a symmetric crystal.">
<script type="application/ld+json">${article}</script>`;
let html = await readFile(new URL('index.html', root), 'utf8');
html = replaceBetween(html, 'security', `<meta http-equiv="Content-Security-Policy" content="${esc(csp)}">`);
html = replaceBetween(html, 'metadata', tags);
html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(site.description)}">`);
html = html.replace('src="js/main.js"', 'src="js/main.min.js"');
html = html.replace('href="assets/css/site.css"', 'href="assets/css/site.min.css"');
if (!html.includes('<!-- styles:begin -->')) {
  html = html.replace('<link rel="stylesheet" href="assets/css/site.min.css">', '<!-- styles:begin -->\n<!-- styles:end -->');
}
// Inline the complete generated sheet to avoid a blocking stylesheet request.
html = replaceBetween(html, 'styles', `<style>${compressed.code.trim().replaceAll('../fonts/', 'assets/fonts/')}</style>`);
await writeFile(new URL('index.html', root), html);
const posterUrl = new URL('tools/poster.html', root);
const poster = await readFile(posterUrl, 'utf8');
await writeFile(posterUrl, replaceBetween(poster, 'security', `<meta http-equiv="Content-Security-Policy" content="${esc(csp)}">`));
await writeFile(new URL('robots.txt', root), `User-agent: *\nAllow: /Project-CrystalAR/\nSitemap: ${canonical}sitemap.xml\n`);
await writeFile(new URL('sitemap.xml', root), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${canonical}</loc></url></urlset>\n`);
await writeFile(new URL('404.html', root), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${esc(csp)}"><meta name="robots" content="noindex">
<title>Page not found · CrystalAR</title><link rel="icon" href="/Project-CrystalAR/assets/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/Project-CrystalAR/assets/css/site.min.css"></head>
<body><main class="not-found"><p class="kicker">CrystalAR</p><h1>This page is missing.</h1><p>The project page is still here; return to explore the method, crystals and paper.</p><a class="btn btn--primary" href="/Project-CrystalAR/">Back to CrystalAR</a></main></body></html>\n`);
