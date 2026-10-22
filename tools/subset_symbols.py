#!/usr/bin/env python3
"""Create a tiny self-hosted symbol fallback from DejaVu Sans 2.37.

Usage: python tools/subset_symbols.py <DejaVuSans.ttf>
Use fonttools==4.55.3 and Brotli==1.0.9 in an external scratch environment.
"""
from pathlib import Path
import argparse

REPO = Path(__file__).resolve().parents[1]


def export(source):
    from fontTools import subset
    from fontTools.ttLib import TTFont
    font = TTFont(source, recalcTimestamp=False)
    if not any(name.nameID == 5 and name.toUnicode() == 'Version 2.37' for name in font['name'].names):
        raise ValueError('expected DejaVu Sans 2.37')
    codepoints = set(range(0x2080, 0x208A)) | {0x2020, 0x2197}
    if not codepoints <= font.getBestCmap().keys():
        raise ValueError('source is missing required symbols')
    options = subset.Options()
    options.recalc_timestamp = False
    if 'FFTM' in font:
        del font['FFTM']
    worker = subset.Subsetter(options=options)
    worker.populate(unicodes=codepoints)
    worker.subset(font)
    for name in font['name'].names:
        if name.nameID in (1, 2, 3, 4, 6):
            value = 'Regular' if name.nameID == 2 else 'CrystalAR Symbols'
            if name.nameID == 6:
                value = 'CrystalARSymbols'
            name.string = value.encode(name.getEncoding())
    font.flavor = 'woff2'
    destination = REPO / 'assets/fonts/dejavu-sans-symbols-2.37.woff2'
    font.save(destination)
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    print(export(parser.parse_args().source).name)
