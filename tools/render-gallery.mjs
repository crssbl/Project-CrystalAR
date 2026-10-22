// Writes generated markup into index.html between marker comments, so the page reads fully
// without JavaScript: the story's token sequence and (once exported) the 13 gallery cards.
// Usage: npm run gallery
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokensHtml } from '../js/lib/tokens.js';
import { cardsHtml } from '../js/lib/cards.js';
import { elementCss } from '../js/lib/palette.js';
import { configVisibility, safeHttpUrl, warnInvalidUrls } from '../js/lib/config.js';
import { escapeHtml } from '../js/lib/format.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (rel) => JSON.parse(await readFile(path.join(root, rel), 'utf8'));
const exists = (rel) => access(path.join(root, rel)).then(() => true, () => false);

export function replaceBetween(html, name, inner) {
  const begin = `<!-- ${name}:begin -->`;
  const end = `<!-- ${name}:end -->`;
  const i = html.indexOf(begin);
  const j = html.indexOf(end);
  if (i < 0 || j < i) throw new Error(`markers for ${name} not found`);
  return `${html.slice(0, i + begin.length)}\n${inner}\n${html.slice(j)}`;
}

/** Generate a link only after an explicit valid URL; unavailable Code is plain text. */
export function codeControlHtml(value, placement) {
  const href = safeHttpUrl(value);
  const className = { topbar: 'pill', hero: 'btn', paper: '' }[placement];
  if (className === undefined) throw new Error(`unknown Code placement: ${placement}`);
  if (!href) return placement === 'topbar' ? '' : `<span class="${className ? className + ' ' : ''}code-soon" data-code-label>Code · coming soon</span>`;
  const attrs = `${className ? `class="${className}" ` : ''}href="${escapeHtml(href)}" data-config-href="codeUrl" target="_blank" rel="noopener"`;
  const newTab = '<span class="sr-only"> (opens in a new tab)</span>';
  if (placement === 'paper') {
    const url = new URL(href);
    return `<a ${attrs}><span class="l-name">Code</span><span class="l-meta">${escapeHtml(url.pathname.replace(/^\/+|\/+$/g, '') || url.hostname)}</span>${newTab}</a>`;
  }
  const icon = placement === 'topbar'
    ? '<svg class="ext" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M4 2h6v6M10 2 3 9"/></svg>'
    : '<svg class="ico" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="m7 6-4 4 4 4M13 6l4 4-4 4M11.2 4.5 8.8 15.5"/></svg>';
  return `<a ${attrs}>${placement === 'hero' ? icon : ''}Code${placement === 'topbar' ? icon : ''}${newTab}</a>`;
}

/** Configuration is compiled into HTML; runtime responses cannot override this state. */
export function siteConfigHtml(html, site) {
  warnInvalidUrls(site);
  for (const placement of ['topbar', 'hero', 'paper']) {
    html = replaceBetween(html, `code-${placement}`, codeControlHtml(site.codeUrl, placement));
  }
  const visible = configVisibility(site);
  html = html.replace(/<([a-z][\w-]*)\b([^<>]*)>/gi, (tag, name, attrs) => {
    const requires = attrs.match(/\bdata-config-requires="([^"]+)"/)?.[1];
    const hrefKey = attrs.match(/\bdata-config-href="([^"]+)"/)?.[1];
    if (requires) {
      attrs = attrs.replace(/\s+hidden(?:="[^"]*")?(?=\s|$)/g, '');
      if (!visible[requires]) attrs += ' hidden';
    }
    const href = hrefKey && safeHttpUrl(site[hrefKey]);
    if (href) attrs = attrs.replace(/\bhref="[^"]*"/, `href="${escapeHtml(href)}"`);
    return `<${name}${attrs}>`;
  });
  return html.replace(/<([a-z][\w-]*)\b([^<>]*\bdata-config-text="([^"]+)"[^<>]*)>[\s\S]*?<\/\1>/gi,
    (_, name, attrs, key) => `<${name}${attrs}>${escapeHtml(site[key] ?? '')}</${name}>`);
}

async function main() {
  const file = path.join(root, 'index.html');
  let html = await readFile(file, 'utf8');
  const story = await read('data/crystals/denovo-75.json');
  html = replaceBetween(html, 'tokens', tokensHtml(story));
  if (await exists('data/crystals/index.json')) {
    const index = await read('data/crystals/index.json');
    html = replaceBetween(html, 'gallery', cardsHtml(index.crystals));
  }
  html = siteConfigHtml(html, await read('data/site.json'));
  await writeFile(file, html);
  const cssFile = path.join(root, 'assets/css/site.css');
  const css = await readFile(cssFile, 'utf8');
  const colours = /\/\* elements:begin \*\/[\s\S]*?\/\* elements:end \*\//;
  if (!colours.test(css)) throw new Error('element palette markers not found in site.css');
  await writeFile(cssFile, css.replace(colours, `/* elements:begin */\n${elementCss()}\n/* elements:end */`));
  console.log('index.html markup updated');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
