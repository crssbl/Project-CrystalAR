"""Independent geometry of the result tables in arXiv v1.

Coordinates are PDF points. Read cells and column labels from the PDF itself,
so changing the website data cannot redefine what a column means.
"""
SPECS = {
    1: (7, (108, 209, 505, 313), [108,149,177,198,226,258,289,324,356,391,416,445,474,505]),
    2: (7, (108,433,505,508), [108,177,249,280,309,340,377,424,469,505]),
    3: (9, (266,520,505,635), [266,340,380,425,466,505]),
    6: (23, (150,131,462,181), [150,262,297,333,367,398,426,462]),
    7: (23, (170,246,440,326), [170,275,310,341,374,402,440]),
    8: (24, (160,131,450,172), [160,291,324,358,389,417,450]),
    9: (25, (185,382,425,572), [185,280,320,348,384,425]),
    10: (26, (160,403,451,446), [160,300,332,400,451]),
}
HEADERS = {
    1: ([108,149,177,198,226,258,289,324,356,385,415,442.3,470,505], (194,201), (199.7,207)),
    2: ([108,177,225,275,309,340,370,414,456,505], (414,430)),
    3: (SPECS[3][2], (506,519)),
    6: (SPECS[6][2], (112,130)),
    7: (SPECS[7][2], (227,245)),
    8: (SPECS[8][2], (111,130)),
    9: ([185,270,302,344,384,425], (362,381)),
    10: ([160,290,334,374,451], (383,402)),
}


def read_rows(page, number):
    import pymupdf
    _, rect, cuts = SPECS[number]
    words = page.get_text('words', clip=pymupdf.Rect(rect))
    lines = []
    for word in sorted(words, key=lambda w: ((w[1] + w[3]) / 2, w[0])):
        y = (word[1] + word[3]) / 2
        if not lines or abs(y - lines[-1][0]) > 1.8:
            lines.append((y, []))
        lines[-1][1].append(word)
    rows = []
    for _, line in lines:
        cells = ['' for _ in cuts[1:]]
        for word in sorted(line, key=lambda w: w[0]):
            x = (word[0] + word[2]) / 2
            for i, (left, right) in enumerate(zip(cuts, cuts[1:])):
                if left <= x < right:
                    cells[i] += word[4] + ' '
                    break
        if any(c.isdigit() for c in ''.join(cells[1:])):
            rows.append([c.strip() for c in cells])
    return rows


def read_headers(page, number):
    cuts, *ranges = HEADERS[number]
    chars = [c for b in page.get_text('rawdict')['blocks'] if b['type'] == 0
             for line in b['lines'] for span in line['spans'] for c in span['chars']]

    def text(left, right, top, bottom):
        return ''.join(c['c'] for c in chars
                       if left <= (c['bbox'][0] + c['bbox'][2]) / 2 < right
                       and top <= (c['bbox'][1] + c['bbox'][3]) / 2 < bottom)
    headers = [text(left, right, *(ranges[1] if number == 1 and i >= 6 else ranges[0]))
               for i, (left, right) in enumerate(zip(cuts, cuts[1:]))]
    if number == 3:
        for start, end, indices in [(340,425,(1,2)), (425,505,(3,4))]:
            dataset = text(start, end, 494, 505)
            for i in indices:
                headers[i] = dataset + headers[i]
    return headers
