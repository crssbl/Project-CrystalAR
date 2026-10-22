"""Only author bot blocks may bypass an HTTP 200; Code has no exception."""
from urllib.error import HTTPError, URLError
import ssl

import check_links


def test_code_404_is_a_failure_like_any_other_missing_link(monkeypatch):
    def missing(request, timeout):
        raise HTTPError(request.full_url, 404, 'Not Found', {}, None)
    monkeypatch.setattr(check_links, 'urlopen', missing)
    code = check_links.fetch(('https://github.com/crssbl/CrystalAR', {}))
    other = check_links.fetch(('https://example.org/missing', {}))
    assert code['result'] == 'failure'
    assert other['result'] == 'failure'


def test_author_bot_block_is_distinguished_from_a_normal_failed_asset(monkeypatch):
    def blocked(request, timeout):
        raise HTTPError(request.full_url, 429, 'Too Many Requests', {}, None)
    monkeypatch.setattr(check_links, 'urlopen', blocked)
    scholar = check_links.fetch(('https://scholar.google.com/citations?user=example', {}))
    asset = check_links.fetch(('https://example.org/asset.webp', {}))
    assert scholar['result'] == 'author-link-bot-exception'
    assert asset['result'] == 'failure'


def test_scholar_handshake_block_is_explicitly_unverified_not_a_success(monkeypatch):
    def handshake(request, timeout):
        raise URLError(ssl.SSLError('ssl/tls alert handshake failure'))
    monkeypatch.setattr(check_links, 'urlopen', handshake)
    scholar = check_links.fetch(('https://scholar.google.com/citations?user=example', {}))
    code = check_links.fetch(('https://github.com/crssbl/CrystalAR', {}))
    other = check_links.fetch(('https://example.org/asset.webp', {}))
    assert scholar['result'] == 'author-link-bot-exception'
    assert scholar['status'] is None and scholar['unverified'] is True
    assert code['result'] == other['result'] == 'failure'


def test_scholar_dns_and_certificate_errors_are_not_silently_ignored(monkeypatch):
    for message in ['Name or service not known', 'certificate verify failed: expired']:
        def failed(request, timeout):
            raise URLError(message)
        monkeypatch.setattr(check_links, 'urlopen', failed)
        assert check_links.fetch(('https://scholar.google.com/citations?user=example', {}))['result'] == 'failure'
