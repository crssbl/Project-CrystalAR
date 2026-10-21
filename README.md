# Project-CrystalAR

Project page for **CrystalAR: Autoregressive Modeling for Symmetric Crystal Generation**.

A static site: plain HTML, CSS and native ES modules, no build step. GitHub Pages serves the
repository root, so every URL in the site is relative.

## Layout

- `index.html` — all body text; gallery cards and the story's token list are generated offline
  between marker comments (`npm run gallery`).
- `assets/` — CSS, self-hosted fonts (OFL licences next to them), posters, stills, CIF files.
- `js/` — page modules; `js/lib/` holds the pure functions covered by `node --test`.
- `data/site.json` — the one place for links: `codeUrl`, `arxivUrl`, `bibtex`, `venue`.
  - `arxivUrl`, `bibtex` and `venue` are optional: their UI stays hidden while the value is `null`.
  - The Code links always show. `codeUrl` only re-points them; while it is missing or not an
    http(s) URL they keep the `https://github.com/crssbl/CrystalAR` written in `index.html`.
  - A link value (a key ending in `Url`) that is set but is not an http(s) URL is ignored, with a
    `[crystalar] ignoring site.json …` warning in the browser console.
  - After editing this config, run `npm run gallery` to refresh the static links and citation
    for readers without JavaScript. The arXiv URL is intentionally unversioned.
- `data/crystals/` — one generation trace per crystal, exported by `tools/export_crystals.py`.
- `vendor/three/` — a tree-shaken build of three@0.186.1 (`npm run vendor:three`), MIT licence.

## Local preview

```sh
mkdir -p ../serve && ln -sfn "$PWD" ../serve/Project-CrystalAR
python3 -m http.server --bind 127.0.0.1 8790 --directory ../serve
# open http://127.0.0.1:8790/Project-CrystalAR/
```

## Tests

Node.js `^20.17.0 || >=22.0.0` (the range that every pinned tool accepts; tested on 20.17.0).
The tools are pinned exactly in `package.json`: `@playwright/test@1.64.1`, `html-validate@10.0.0`
(10.1 and later need Node ≥ 20.19), `esbuild@0.28.2` and `three@0.186.1`.

```sh
npm ci
node --test tests/unit/                 # pure functions
npx html-validate index.html tools/poster.html   # markup, html-validate:standard (.htmlvalidate.json)
npx playwright test                     # end-to-end, serves the site under /Project-CrystalAR/
python -m pytest tests/python -q        # exporter (needs the source artefacts, see below)
```

`npm test` runs the unit tests, html-validate and Playwright in that order.

Lighthouse is installed outside the repository for local scoring. The pinned
`lighthouse@12.8.2` works on this host's Node 20.17; Lighthouse 13.x requires Node ≥ 22.19.
Use a fresh scratch directory instead of adding it to the site's dependencies:

```sh
lh_scratch=$(mktemp -d)
npm install --prefix "$lh_scratch" --no-save --package-lock=false lighthouse@12.8.2
"$lh_scratch/node_modules/.bin/lighthouse" http://127.0.0.1:8790/Project-CrystalAR/ --only-categories=performance,accessibility,best-practices,seo
```

After launch, score the live site URL with [PageSpeed Insights](https://pagespeed.web.dev/).

## Re-exporting crystal data

`tools/export_crystals.py` reads the generation records, the Wyckoff tables and the MLIP
assessment. Paths are passed as arguments or read from `tools/local_config.json`
(git-ignored; copy `tools/local_config.example.json`). Run it in an environment that can import
pymatgen and the generator's `crystalformer` package:

```sh
python tools/export_crystals.py --ids gallery          # all 13, plus data/crystals/index.json
python tools/export_crystals.py --ids denovo:75 --print-regions
npm run gallery                                         # cards and token list → index.html
node tools/render-assets.mjs http://127.0.0.1:8790/Project-CrystalAR/   # posters and stills
python tools/check_crystals.py --out <report.md>        # report-only plausibility checks
```

`tools/poster.html` renders the same images by hand in any browser with WebGL2.

Published traces contain one short provenance line. The exporter writes source paths, source
line numbers (one-based), SHA-256 hashes and the archived relaxation checks to the local-only
`provenance_manifest` path in the ignored config. Set that path to an unpublished notes
directory outside this repository. The exporter refuses a manifest path inside the site.
The symmetry note is generated from stored relaxation endpoints at 0.01 Å and 0.1 Å; no
models or relaxations run during export. `npm run gallery` also generates the element-dot
CSS from `js/lib/palette.js`, which supplies the renderer's colours.

## Fonts

The seven woff2 files in `assets/fonts/` are unmodified copies of the `files/` in three
Fontsource npm packages (all SIL OFL 1.1; each package's `LICENSE` sits next to the fonts as
`OFL-<family>.txt`):

| File | Package | Weight | Subset |
|---|---|---|---|
| `sora-latin-600-normal.woff2` | `@fontsource/sora@5.3.0` | 600 | latin |
| `ibm-plex-sans-latin-400-normal.woff2` | `@fontsource/ibm-plex-sans@5.3.0` | 400 | latin |
| `ibm-plex-sans-latin-500-normal.woff2` | `@fontsource/ibm-plex-sans@5.3.0` | 500 | latin |
| `ibm-plex-sans-latin-600-normal.woff2` | `@fontsource/ibm-plex-sans@5.3.0` | 600 | latin |
| `ibm-plex-sans-greek-400-normal.woff2` | `@fontsource/ibm-plex-sans@5.3.0` | 400 (serves 400–600) | greek |
| `ibm-plex-mono-latin-400-normal.woff2` | `@fontsource/ibm-plex-mono@5.3.0` | 400 | latin |
| `ibm-plex-mono-latin-500-normal.woff2` | `@fontsource/ibm-plex-mono@5.3.0` | 500 | latin |

The `unicode-range` of each `@font-face` rule in `assets/css/site.css` is Fontsource's range
for that subset:

- latin: `U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD`
- greek: `U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF`

`npm run vendor:fonts` (`tools/vendor-fonts.mjs`) fetches the three packages with `npm pack`
and copies these files and licences again, byte for byte, and writes the packages and their
version to `assets/fonts/VERSION`. The version is `VERSION` in that script; `node --test`
checks the table above and `assets/fonts/VERSION` against it. To add a weight or a subset, add
the file name to the list in that script, run it, and add an `@font-face` rule with the subset's
range from the package's CSS (for example `package/400.css`).
