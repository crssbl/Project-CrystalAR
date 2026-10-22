#!/usr/bin/env python3
"""Check page links and assets; resolve new canonical assets against the local preview.

External paper, author and repository links are fetched as written. A preview cannot
verify the production status of assets that have not been published yet.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urldefrag, urljoin, urlparse
from urllib.request import Request, urlopen

REPO = Path(__file__).resolve().parents[1]


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls, self.ids = set(), set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id'):
            self.ids.add(attrs['id'])
        for key in ('href', 'src'):
            if attrs.get(key):
                self.urls.add(attrs[key])
        if attrs.get('srcset'):
            self.urls.update(item.strip().split()[0] for item in attrs['srcset'].split(','))
        if tag == 'meta' and attrs.get('property', attrs.get('name')) in ('og:image', 'twitter:image'):
            self.urls.add(attrs['content'])


def inspect(base, canonical):
    urls = {}
    for file in ('index.html', '404.html', 'tools/poster.html'):
        parsed = Links()
        parsed.feed((REPO / file).read_text())
        for href in parsed.urls:
            if href.startswith('#'):
                if href != '#' and href[1:] not in parsed.ids:
                    raise ValueError(f'{file}: missing fragment {href}')
                continue
            # Canonical page is already public; new social assets are previewed locally.
            target = urljoin(urljoin(base, file), href)
            preview_asset = target.startswith(canonical) and target != canonical
            if preview_asset:
                target = urljoin(base, target[len(canonical):])
            urls[urldefrag(target)[0]] = {'href': href, 'previewAsset': preview_asset}
    css = (REPO / 'assets/css/site.css').read_text()
    for match in re.finditer(r'url\([\'\"]?([^\)\'\"]+)', css):
        target = urljoin(urljoin(base, 'assets/css/site.css'), match[1])
        urls[target] = {'href': match[1], 'previewAsset': True}
    for name in ('robots.txt', 'sitemap.xml'):
        urls[urljoin(base, name)] = {'href': name, 'previewAsset': True}
    return urls


def fetch(item):
    url, info = item
    record = dict(info, url=url)
    try:
        req = Request(url, headers={'User-Agent': 'CrystalAR-project-link-check/1.0'})
        with urlopen(req, timeout=30) as response:
            record.update(status=response.status, finalUrl=response.url)
    except HTTPError as error:
        record.update(status=error.code, finalUrl=error.url)
    except (URLError, TimeoutError) as error:
        record.update(status=None, error=str(error))
    host = urlparse(url).hostname
    # Scholar also rejects automated TLS handshakes on some hosts. Preserve the
    # transport error as explicitly unverified, rather than claiming an HTTP 200.
    scholar_handshake = host == 'scholar.google.com' and record['status'] is None and 'handshake' in record.get('error', '').lower()
    if scholar_handshake:
        record.update(result='author-link-bot-exception', unverified=True,
                      reason='Scholar TLS handshake blocked; no HTTP status was verified')
    elif host == 'scholar.google.com' and record['status'] in (200, 302, 403, 429):
        record['result'] = 'author-link-bot-exception' if record['status'] != 200 else 'ok'
    else:
        record['result'] = 'ok' if record['status'] == 200 else 'failure'
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    report = Path(args.report)
    if report.resolve().is_relative_to(REPO):
        raise ValueError('the link report must stay outside the published repository')
    canonical = json.loads((REPO / 'data/site.json').read_text())['canonicalUrl']
    with ThreadPoolExecutor(max_workers=6) as pool:
        records = list(pool.map(fetch, sorted(inspect(args.base_url, canonical).items())))
    payload = {'baseUrl': args.base_url, 'links': records,
               'unverified': 'Production status of newly added assets awaits the approved launch.'}
    report.write_text(json.dumps(payload, indent=2) + '\n')
    counts = {key: sum(r['result'] == key for r in records)
              for key in ('ok', 'author-link-bot-exception', 'failure')}
    print(json.dumps(counts))
    return int(counts['failure'] > 0)


if __name__ == '__main__':
    raise SystemExit(main())
