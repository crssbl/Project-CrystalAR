// Site configuration (data/site.json) → page state.
// Optional links (arXiv, BibTeX, venue) stay hidden while their value is null.
// npm run gallery mirrors the published config into static HTML for readers without JS too.
// The Code links always show: codeUrl only re-points them (they have no data-config-requires),
// and while it is missing or not an http(s) URL they keep the href written in index.html.

export const OPTIONAL_KEYS = ['arxivUrl', 'bibtex', 'venue'];

const present = (value) => value !== null && value !== undefined && String(value).trim() !== '';

/** Link keys (codeUrl, arxivUrl, …) end in "Url"; their value must be an http(s) URL. */
export const isHrefKey = (key) => /Url$/.test(key);

/**
 * Pure: which optional UI pieces (OPTIONAL_KEYS) should be visible for a given config. A link is
 * visible only when it is a usable http(s) URL, so a mistyped value hides its button instead of
 * showing a dead one; text values (bibtex, venue) only need to be non-empty.
 */
export function configVisibility(site) {
  const out = {};
  for (const key of OPTIONAL_KEYS) {
    out[key] = isHrefKey(key) ? safeHttpUrl(site?.[key]) !== null : present(site?.[key]);
  }
  return out;
}

/** Only http(s) links are accepted from the config file. */
export function safeHttpUrl(value) {
  if (!present(value)) return null;
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * DOM: apply the config to every element that declares a binding. A link value that is set but
 * not http(s) is ignored and reported once per key, so a typo in site.json shows in the console.
 */
export function applyConfig(root, site) {
  for (const [key, value] of Object.entries(site ?? {})) {
    if (isHrefKey(key) && present(value) && safeHttpUrl(value) === null) {
      console.warn(`[crystalar] ignoring site.json ${key}: ${JSON.stringify(value)} is not an http(s) URL`);
    }
  }
  const visible = configVisibility(site);
  root.querySelectorAll('[data-config-requires]').forEach((el) => {
    const key = el.getAttribute('data-config-requires');
    el.hidden = !visible[key];
  });
  root.querySelectorAll('[data-config-href]').forEach((el) => {
    const href = safeHttpUrl(site?.[el.getAttribute('data-config-href')]);
    if (href) el.setAttribute('href', href);
  });
  root.querySelectorAll('[data-config-text]').forEach((el) => {
    const value = site?.[el.getAttribute('data-config-text')];
    if (present(value)) el.textContent = String(value);
  });
  return visible;
}
