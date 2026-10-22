#!/usr/bin/env python3
"""Static local preview with the same custom-404 fallback as the hosted project subpath."""
import argparse
import gzip
from io import BytesIO
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Handler(SimpleHTTPRequestHandler):
    def send_error(self, code, message=None, explain=None):
        page = Path(self.directory) / 'Project-CrystalAR' / '404.html'
        if code == 404 and page.is_file():
            body = page.read_bytes()
            self.send_response(404)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)
        else:
            super().send_error(code, message, explain)


class GzipHandler(Handler):
    """Opt-in transport matching the hosted site's text compression."""
    def send_head(self):
        path = Path(self.translate_path(self.path))
        if path.is_dir():
            path = path / 'index.html'
        accepts_gzip = False
        for part in self.headers.get('Accept-Encoding', '').lower().split(','):
            name, *parameters = [value.strip() for value in part.split(';')]
            if name != 'gzip':
                continue
            try:
                quality = float(next((p.split('=', 1)[1] for p in parameters if p.startswith('q=')), '1'))
            except ValueError:
                quality = 0
            accepts_gzip = quality > 0
            break
        if path.is_file() and path.suffix in {'.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.xml'} and accepts_gzip:
            body = gzip.compress(path.read_bytes(), compresslevel=6, mtime=0)
            self.send_response(200)
            self.send_header('Content-Type', self.guess_type(str(path)))
            self.send_header('Content-Encoding', 'gzip')
            self.send_header('Vary', 'Accept-Encoding')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            return BytesIO(body)
        return super().send_head()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8791)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--gzip', action='store_true', help='compress text responses like the hosted site')
    args = parser.parse_args()
    ThreadingHTTPServer(('127.0.0.1', args.port), partial(GzipHandler if args.gzip else Handler, directory=args.directory)).serve_forever()
