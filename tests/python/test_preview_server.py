"""The optional hosted-transport preview must preserve response content and fallback."""
from functools import partial
import gzip
from http.server import ThreadingHTTPServer
from threading import Thread
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest
from preview_server import GzipHandler


def test_compressed_identity_and_deep_missing_responses(tmp_path):
    project = tmp_path / 'Project-CrystalAR'
    project.mkdir()
    html = ('<!doctype html><title>CrystalAR</title>' + '<p>CrystalAR</p>' * 100).encode()
    (project / 'index.html').write_bytes(html)
    (project / '404.html').write_text('<h1>Missing</h1>')
    (project / 'font.woff2').write_bytes(b'not-a-compression-target')
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(GzipHandler, directory=str(tmp_path)))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f'http://127.0.0.1:{server.server_port}/Project-CrystalAR/'
    try:
        with urlopen(Request(base, headers={'Accept-Encoding': 'gzip'})) as response:
            assert response.headers['Content-Encoding'] == 'gzip'
            assert response.headers['Vary'] == 'Accept-Encoding'
            body = response.read()
            assert int(response.headers['Content-Length']) == len(body) < len(html)
            assert gzip.decompress(body) == html
        for encoding in ['', 'gzip;q=0']:
            with urlopen(Request(base, headers={'Accept-Encoding': encoding})) as response:
                assert response.headers['Content-Encoding'] is None
                assert response.read() == html
        with urlopen(Request(base + 'font.woff2', headers={'Accept-Encoding': 'gzip'})) as response:
            assert response.headers['Content-Encoding'] is None
            assert response.read() == b'not-a-compression-target'
        with pytest.raises(HTTPError) as error:
            urlopen(Request(base + 'missing/deep/page', headers={'Accept-Encoding': 'gzip'}))
        assert error.value.code == 404
        assert error.value.read() == b'<h1>Missing</h1>'
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
