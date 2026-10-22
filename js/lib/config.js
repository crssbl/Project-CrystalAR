// Build-time configuration. The delivered page never fetches or applies site.json.
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

/** Report mistyped URL values during generation, once per key. */
export function warnInvalidUrls(site) {
  for (const [key, value] of Object.entries(site ?? {})) {
    if (isHrefKey(key) && present(value) && safeHttpUrl(value) === null) {
      console.warn(`[crystalar] ignoring site.json ${key}: ${JSON.stringify(value)} is not an http(s) URL`);
    }
  }
}
