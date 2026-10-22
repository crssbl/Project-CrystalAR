# Project-CrystalAR

Project page for **CrystalAR: Autoregressive Modeling for Symmetric Crystal Generation**.

A static site: plain HTML, CSS and native ES modules, no build step. GitHub Pages serves the
repository root. Page links and assets are relative; canonical/social URLs are absolute.
Only `404.html` uses root-relative `/Project-CrystalAR/` links so it works at any depth.

## Layout

- `index.html` — all body text; marked blocks are generated offline (`npm run content`).
- `assets/` — CSS, self-hosted fonts (OFL licences next to them), posters, stills, CIF files.
  Edit `assets/css/site.css`; `npm run content` inlines the minified CSS in the single
  project page and generates `site.min.css` for the 404. Both stay readable without JS.
  The hero uses 600/800/1200 px posters from the same renderer and camera preset.
- `js/` — page modules; `js/lib/` holds the pure functions covered by `node --test`.
- `data/site.json` — change Paper links in `arxivUrl`, Code links in `codeUrl`, the entire
  citation in `bibtex`, and a future venue badge in `venue` (currently `null`).
  - `arxivUrl`, `bibtex` and `venue` are optional: their UI stays hidden while the value is `null`.
  - `codeUrl` is currently `null`: the hero and paper show the muted, non-focusable text
    **Code · coming soon**, with no Code link. The top bar omits Code so it stays on one line
    at 360 px; arXiv stays visible. A valid http(s) URL generates all three working Code
    links; an invalid non-empty value generates the same labels and a
    `[crystalar] ignoring site.json …` warning during generation.
  - Configuration is compiled into static HTML. The browser never fetches `data/site.json`,
    so cached older responses cannot hide Paper links or restore an unavailable Code link.
  - After editing this config, run `npm run content` to refresh static links, citation,
    metadata and its CSP hash for readers without JavaScript. The arXiv URL is intentionally
    unversioned. `canonicalUrl` and `description` also live here; do not hand-edit generated
    head metadata, `robots.txt`, `sitemap.xml` or `404.html`.
  - To enable Code later: make the repository public, set `codeUrl` to its https URL, run
    `npm run content`, `npm test`, Python tests and `tools/check_links.py` with the local preview
    arguments below, then commit the generated files and push `main`. Runtime edits alone do
    not enable links. The link checker has no Code 404 exception.
- `data/numbers.json` — arXiv v1 Tables 1–3 and 6–10; every displayed result refers to a
  table, row and column. `npm run content` refreshes cards and tables from this source.
- `data/crystals/` — one generation trace per crystal, exported by `tools/export_crystals.py`.
- `vendor/three/` — a tree-shaken build of three@0.186.1 (`npm run vendor:three`), MIT licence.

## Local preview

```sh
mkdir -p ../serve && ln -sfn "$PWD" ../serve/Project-CrystalAR
python3 tools/preview_server.py --port 8790 --directory ../serve
# open http://127.0.0.1:8790/Project-CrystalAR/
```

## Tests

Node.js `^20.17.0 || >=22.0.0` (the range that every pinned tool accepts; tested on 20.17.0).
The tools are pinned exactly in `package.json`: `@playwright/test@1.64.1`, `html-validate@10.0.0`
(10.1 and later need Node ≥ 20.19), `esbuild@0.28.2`, `three@0.186.1` and `axe-core@4.10.3`.

```sh
npm ci
node --test tests/unit/                 # pure functions
npx html-validate index.html 404.html tools/poster.html # markup, html-validate:standard
npx playwright test                     # end-to-end, serves the site under /Project-CrystalAR/
python -m pytest tests/python -q        # exporter and paper tools (local sources, see below)
```

`npm test` runs the unit tests, html-validate and Playwright in that order.

With the local preview running, check every published link and asset; write the report
outside this repository. Scholar bot blocks are distinguished from failed links. A rejected
Scholar TLS handshake is explicitly reported as unverified, never as HTTP 200; DNS and
certificate validation errors still fail. Code has no 404 exception.

```sh
python tools/check_links.py --base-url http://127.0.0.1:8790/Project-CrystalAR/ --report ../link-check.json
```

After enabling Code and passing the checks above, commit the configuration and generated
page, then publish from `main`:

```sh
git add data/site.json index.html
git commit -m "Enable Code links"
git push origin main
```

Lighthouse is installed outside the repository for local scoring. The pinned
`lighthouse@12.8.2` works on this host's Node 20.17; Lighthouse 13.x requires Node ≥ 22.19.
Use a fresh scratch directory instead of adding it to the site's dependencies:

```sh
lh_scratch=$(mktemp -d)
npm install --prefix "$lh_scratch" --no-save --package-lock=false lighthouse@12.8.2
"$lh_scratch/node_modules/.bin/lighthouse" http://127.0.0.1:8790/Project-CrystalAR/ --only-categories=performance,accessibility,best-practices,seo
```

After launch, score the live site URL with [PageSpeed Insights](https://pagespeed.web.dev/).

For a desktop Lighthouse run add `--preset=desktop`; the default run is mobile. Both use
`--only-categories=performance,accessibility,best-practices,seo`. The browser tests run axe
on the page, expanded tables, crystal dialog and custom 404, rejecting serious/critical issues.

## Paper figures and numbers

Set `paper_pdf`, `paper_tex`, `architecture_source`, `numbers_sources`, `numbers_report`
and `figure_report` in the ignored `tools/local_config.json`, using the generic example.
Reports must live outside this published repository. In a fresh scratch virtual environment,
install `PyMuPDF==1.28.2` and `Pillow==11.3.0` (plus the exporter requirements below when
running its tests); do not alter an existing environment.

```sh
python tools/extract_figures.py        # compare Figure 2 vector streams, export SVG/WebP and page 1
npm run content                       # gallery, illustrations, results, metadata
python tools/verify_numbers.py        # PDF cells + captions + page bindings + local cross-checks
```

arXiv v1 is authoritative. The number report lists disagreements with local result files
or typesetting sources without changing the page to those values. It records full local
paths and hashes only in the private report. Tables 4 and 5 are not result tables.
The architecture preview is lazy-loaded; its full vector opens separately. Method loops
pause off screen and stay static with reduced motion.

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

The nine Fontsource woff2 files in `assets/fonts/` are unmodified copies of the `files/` in three
Fontsource npm packages (all SIL OFL 1.1; each package's `LICENSE` sits next to the fonts as
`OFL-<family>.txt`):

| File | Package | Weight | Subset |
|---|---|---|---|
| `sora-latin-600-normal.woff2` | `@fontsource/sora@5.3.0` | 600 | latin |
| `ibm-plex-sans-latin-400-normal.woff2` | `@fontsource/ibm-plex-sans@5.3.0` | 400 | latin |
| `ibm-plex-sans-latin-500-normal.woff2` | `@fontsource/ibm-plex-sans@5.3.0` | 500 | latin |
| `ibm-plex-sans-latin-600-normal.woff2` | `@fontsource/ibm-plex-sans@5.3.0` | 600 | latin |
| `ibm-plex-sans-greek-400-normal.woff2` | `@fontsource/ibm-plex-sans@5.3.0` | 400 | greek |
| `ibm-plex-sans-greek-500-normal.woff2` | `@fontsource/ibm-plex-sans@5.3.0` | 500 | greek |
| `ibm-plex-sans-greek-600-normal.woff2` | `@fontsource/ibm-plex-sans@5.3.0` | 600 | greek |
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

`dejavu-sans-symbols-2.37.woff2` is a 3 KB subset of DejaVu Sans **2.37**, licensed
under `assets/fonts/LICENSE-DejaVu.txt`. Its `U+2020, U+2080-2089, U+2197` range supplies the Unicode
subscripts, dagger and external-link arrow missing from the Plex subsets; body text still uses IBM Plex Sans. Reproduce it with
`python tools/subset_symbols.py <DejaVuSans.ttf>` using `fonttools==4.55.3` and
`Brotli==1.0.9` in a scratch environment. The script rejects other source versions.

The Greek subsets use matching static 400, 500 and 600 faces; none is declared as a variable weight range. Browser tests verify actual custom-font rendering as well as font loading.
The image preload precedes the Latin text faces needed for initial layout.
`npm run content` also bundles the bootstrap and its synchronous helpers into
`js/main.min.js`, bundles the story’s pure helpers into `js/story.min.js`, and
minifies the shared renderer and gallery. Readable sources stay alongside them;
optional feature loading and the hero start rule stay the same. Re-run this command
after editing JavaScript or CSS.

## Sitemap discovery on Project Pages

Keep this project’s `robots.txt`, but crawlers discover robots rules at the origin root,
`https://crssbl.github.io/robots.txt`, rather than `/Project-CrystalAR/robots.txt`. Its local
HTTP 200 does not prove crawler discovery. If the user site can be maintained, add
`Sitemap: https://crssbl.github.io/Project-CrystalAR/sitemap.xml` to its root robots file.
Otherwise, verify the property in Google Search Console and submit the absolute URL
`https://crssbl.github.io/Project-CrystalAR/sitemap.xml` through **Sitemaps → Add a new sitemap**.
These publication/account actions require the owner’s approval; the site tools do not perform these actions.

For Lighthouse, run the preview server with `--gzip` on a separate test port to
match GitHub Pages text compression; keep the ordinary preview running. Reports
also retain the uncompressed local score, which uses a different transport.
The live release still needs PageSpeed Insights verification after launch.
