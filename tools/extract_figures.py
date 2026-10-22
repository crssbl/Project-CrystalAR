#!/usr/bin/env python3
"""Export the architecture vector, its preview and the authoritative paper thumbnail."""
import argparse
import hashlib
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def export_figures(config):
    import pymupdf
    from PIL import Image

    source = pymupdf.open(config['architecture_source'])
    paper = pymupdf.open(config['paper_pdf'])
    source_stream = b''.join(source.xref_stream(x) for x in source[0].get_contents())
    match = None
    for pi, page in enumerate(paper):
        if 'Figure 2:' not in page.get_text():
            continue
        for xref, name, parent, bbox in page.get_xobjects():
            if paper.xref_stream(xref) == source_stream:
                match = {'figure': 2, 'page': pi + 1, 'vectorStreamIdentical': True}
    if not match:
        raise ValueError('architecture vector does not match arXiv v1 Figure 2')
    out = REPO / 'assets/img'
    out.mkdir(exist_ok=True)
    svg = source[0].get_svg_image(text_as_path=True)
    svg = svg.replace('<svg ', '<svg role="img" aria-labelledby="figure-title" aria-describedby="figure-desc" ', 1)
    start = svg.index('>') + 1
    svg = (svg[:start] + '<title id="figure-title">Figure 2: CrystalAR architecture</title>'
           '<desc id="figure-desc">One decoder-only Transformer models the template, lattice and '
           'coordinate regions, with causal attention across refinement levels and parallel '
           'interaction between sites within each level.</desc>' + svg[start:])
    (out / 'architecture.svg').write_text(svg)
    for page, file, scale in ((source[0], 'architecture.webp', 2), (paper[0], 'paper-v1.webp', 0.7)):
        pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
        image = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
        image.save(out / file, 'WEBP', quality=86, method=6)
        match[file] = {'width': pix.width, 'height': pix.height, 'bytes': (out / file).stat().st_size}
    match.update(sourceSha256=hashlib.sha256(Path(config['architecture_source']).read_bytes()).hexdigest(),
                 paperSha256=hashlib.sha256(Path(config['paper_pdf']).read_bytes()).hexdigest(),
                 pymupdf=pymupdf.__version__, svgBytes=len(svg.encode()))
    report = Path(config['figure_report'])
    if report.resolve().is_relative_to(REPO):
        raise ValueError('figure_report must be outside the published repository')
    report.write_text(json.dumps(match, indent=2) + '\n')
    return match


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default=str(REPO / 'tools/local_config.json'))
    args = parser.parse_args()
    print(json.dumps(export_figures(json.loads(Path(args.config).read_text()))))
