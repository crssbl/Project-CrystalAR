#!/usr/bin/env python3
"""Check the page's paper tables, highlights and local cross-checks against arXiv v1.

Paths and unpublished receipts stay in the ignored local config and report directory.
Run with a Python environment providing PyMuPDF; no model or relaxation is run.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from decimal import Decimal, ROUND_HALF_UP
from html.parser import HTMLParser
from html import unescape
from html_tree import Tree
from paper_tables import SPECS, read_rows, read_headers
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TABLES = (1, 2, 3, 6, 7, 8, 9, 10)


def compact(text):
    text = unicodedata.normalize('NFKC', str(text)).replace('−', '-').replace('–', '-')
    text = re.sub(r'single-\s*\n\s*hypothesis', 'single-hypothesis', text)
    text = re.sub(r'(\w)-\s*\n\s*(\w)', r'\1\2', text)
    return re.sub(r'\s+', '', text)


def cell_id(table, row, column):
    return f't{table}-r{row}-c{column}'


def cells(data):
    out = {}
    for table in data['tables']:
        for ri, row in enumerate(table['rows']):
            if len(row['values']) != len(table['columns']) - 1:
                raise ValueError(f'Table {table["number"]}, row {ri}: wrong column count')
            for ci, value in enumerate(row['values'], 1):
                out[cell_id(table['number'], ri, ci)] = value
    return out


def verify_pdf(data, path):
    import pymupdf
    if tuple(t['number'] for t in data['tables']) != TABLES:
        raise ValueError('expected result tables 1–3 and 6–10, in paper order')
    doc = pymupdf.open(path)
    checked = 0
    for table in data['tables']:
        page = doc[table['page'] - 1]
        caption = next((b for b in page.get_text('blocks')
                        if re.match(rf'Table {table["number"]}:\s', b[4])), None)
        if not caption or compact(caption[4]) != compact(table['caption']):
            raise ValueError(f'Table {table["number"]}: caption or page differs from PDF')
        number = table['number']
        if table['page'] != SPECS[number][0]:
            raise ValueError(f'Table {number}: page differs from PDF geometry')
        def header(value):
            value = compact(value.replace('˚A', 'Å')).casefold().replace('_', '').replace('·', '')
            return value.replace('(%)', '') if number in (6, 7, 8) else value
        actual_headers = read_headers(page, number)
        if [header(h) for h in actual_headers] != [header(h) for h in table['columns']]:
            raise ValueError(f'Table {number}: column headers differ from PDF: {actual_headers}')
        rows = read_rows(page, number)
        if len(rows) != len(table['rows']):
            raise ValueError(f'Table {number}: row count differs from PDF')
        for ri, (row, actual) in enumerate(zip(table['rows'], rows)):
            if [compact(v) for v in actual] != [compact(v) for v in [row['label'], *row['values']]]:
                raise ValueError(f'Table {number}, row {ri}: values differ from PDF cell positions: {actual}')
            checked += len(row['values'])
    return checked


class NumberBindings(HTMLParser):
    def __init__(self):
        super().__init__()
        self.values = []
        self.active = None
        self.depth = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if self.active:
            self.depth += 1
        elif 'data-number' in attrs:
            self.active = [attrs['data-number'], '']
            self.depth = 1

    def handle_data(self, text):
        if self.active:
            self.active[1] += text

    def handle_endtag(self, tag):
        if self.active:
            self.depth -= 1
            if not self.depth:
                self.values.append(self.active)
                self.active = None


# These card identities are part of the page specification, independent of the
# editable data file. A table elsewhere cannot stand in for a missing card.
HIGHLIGHTS = {'stable': [1,4,9], 'wyformer': [1,3,9], 'plaid': [1,1,9],
              'parameters': [1,4,2], 'plaidParameters': [1,1,2], 'novel': [2,7,2],
              'ssun': [2,7,8], 'mp20': [3,5,1], 'mpts52': [3,5,3]}
CARD_SPECS = [
    ('De novo · with pre-relaxation', ['stable','stable','plaid','wyformer','parameters','plaidParameters'], '% stable', 1),
    ('Symmetry · MP-20', ['novel','ssun'], 'novel unique templates', 2),
    ('CSP · single hypothesis', ['mp20','mpts52'], '% MP-20 match rate', 3),
]


def verify_html(data, html):
    expected = cells(data)
    root = Tree(html).root
    for table in data['tables']:
        n = table['number']
        sections = root.find('section', id=f'table-{n}')
        if len(sections) != 1:
            raise ValueError(f'page is missing or duplicates Table {n}')
        section = sections[0]
        headings = section.find('th', scope='col')
        labels = section.find('th', scope='row')
        caption = section.find('p', **{'class': 'table-caption'})
        if ([compact(h.text) for h in headings] != [compact(h) for h in table['columns']]
                or [compact(h.text) for h in labels] != [compact(r['label']) for r in table['rows']]
                or len(caption) != 1 or compact(caption[0].text) != compact(table['caption'])):
            raise ValueError(f'page Table {n}: headings, row labels or caption differ from paper data')
        rows = [row for row in section.find('tr') if row.find('th', scope='row')]
        for ri, row in enumerate(rows):
            actual = row.find('td')
            if len(actual) != len(table['columns']) - 1:
                raise ValueError(f'page Table {n}, row {ri}: wrong cell count')
            for ci, cell in enumerate(actual, 1):
                key = cell_id(n, ri, ci)
                if cell.attrs.get('data-number') != key:
                    raise ValueError(f'page is missing or has swapped cell at {key}')
    if data['highlights'] != HIGHLIGHTS:
        raise ValueError('number card source references differ from the specification')
    cards = root.find('article', **{'class': 'number-card'})
    if len(cards) != len(CARD_SPECS):
        raise ValueError('page is missing or duplicates a number card')
    for card, (label, names, metric, table) in zip(cards, CARD_SPECS):
        bindings = [n for n in card.find() if 'data-number' in n.attrs]
        headings = card.find('h3')
        labels = card.find('p', **{'class': 'metric-label'})
        sources = card.find('a', **{'class': 'number-source'})
        if (len(labels) != 1 or compact(labels[0].text) != compact(label)
                or [n.attrs['data-number'] for n in bindings] != [cell_id(*HIGHLIGHTS[k]) for k in names]
                or len(headings) != 1
                or compact(headings[0].text) != compact(expected[cell_id(*HIGHLIGHTS[names[0]])] + metric)
                or len(sources) != 1
                or sources[0].attrs.get('href') != f'https://arxiv.org/pdf/2610.27762v1#page={SPECS[table][0]}'):
            raise ValueError(f'number card {label}: metric, source or binding differs from specification')
    for index, name, label in [(1, 'ssun', 'S.S.U.N.'), (2, 'mpts52', 'MPTS-52 match rate')]:
        secondary = cards[index].find('p', **{'class': 'metric-secondary'})
        if len(secondary) != 1 or compact(secondary[0].text) != compact(expected[cell_id(*HIGHLIGHTS[name])] + '%' + label):
            raise ValueError(f'number card secondary metric {name} differs from specification')
    comparisons = cards[0].find('li')
    for row, model in zip(comparisons, ['CrystalAR', 'PLaID++', 'WyFormer-DFT']):
        if not compact(row.text).startswith(compact(model)):
            raise ValueError('number card comparison model differs from specification')
    if len(comparisons) != 3:
        raise ValueError('number card is missing a comparison')
    for card, (_, _, _, table) in zip(cards, CARD_SPECS):
        if not compact(card.find('a', **{'class': 'number-source'})[0].text).startswith(f'Table{table}inthepaper'):
            raise ValueError('number card table source label differs from specification')
    parser = NumberBindings()
    parser.feed(html)
    for key, value in parser.values:
        if key not in expected or compact(value) != compact(expected[key]):
            raise ValueError(f'page binding {key}: {value!r} differs from paper data')
    if len(parser.values) != len(expected) + 10:
        raise ValueError('page is missing or duplicates paper cells or card bindings')
    return len(parser.values)


def rounded(value, digits):
    return format(Decimal(str(value)).quantize(Decimal(10) ** -digits, rounding=ROUND_HALF_UP), f'.{digits}f')


def verify_explanatory_numbers(html, path):
    """Check the new diagrams' dimensions and refinement depth, outside result cells."""
    import pymupdf
    paper = pymupdf.open(path)
    if compact('d(w) ∈ {0, 1, 2, 3}') not in compact(paper[3].get_text()):
        raise ValueError('positional dimensions differ from PDF page 4')
    ranks = re.findall(r'<li class="manifold-card">[\s\S]*?<p>(\d) free parameters?</p>', html)
    if ranks != ['0', '1', '2', '3']:
        raise ValueError('positional diagram dimensions differ from the paper')
    method = html.split('id="method"', 1)[1].split('id="story"', 1)[0]
    if compact('L = 9') not in compact(paper[16].get_text()) or len(re.findall(r'\bnine\b', method)) != 2:
        raise ValueError('method refinement depth differs from PDF page 17')
    if 'Figure 2:' not in paper[4].get_text() or 'Figure 2 from the paper.' not in html:
        raise ValueError('architecture figure reference differs from PDF page 5')
    return [{'claim': 'positional dimensions', 'values': [0, 1, 2, 3], 'page': 4},
            {'claim': 'dyadic refinement levels', 'value': 9, 'page': 17},
            {'claim': 'architecture figure', 'value': 2, 'page': 5}]


def cross_check_local(data, config):
    values = cells(data)
    checks = []
    sources = config['numbers_sources']

    def record(reference, local, source, pointer, digits=None):
        paper = values[cell_id(*reference)]
        shown = rounded(local, digits) if digits is not None else str(local)
        checks.append({'cell': cell_id(*reference), 'paper': paper, 'local': str(local),
                       'localDisplayed': shown, 'source': source, 'pointer': pointer,
                       'agrees': compact(paper) == compact(shown)})

    raw = json.loads(Path(sources['de_novo']).read_text())
    fields = {3: 'valid_percent', 4: 'unique_percent', 5: 'novel_percent',
              9: 'stable_percent', 11: 'meta_percent', 12: 'msun_percent'}
    for pre, ri in ((True, 4), (False, 13)):
        index, row = next((i, row) for i, row in enumerate(raw['rows']) if row['pre_relaxation'] is pre)
        for ci, key in fields.items():
            record((1, ri, ci), row[key], sources['de_novo'], f'/rows/{index}/{key}', 1)
        for ci, prefix in ((6, 'formation_energy'), (7, 'e_hull'), (8, 'rmsd')):
            suffix = '_A' if prefix == 'rmsd' else '_eV_atom'
            mean, std = row[prefix + '_mean' + suffix], row[prefix + '_std' + suffix]
            shown = f'{rounded(mean, 2)} ± {rounded(std, 2)}'
            record((1, ri, ci), shown, sources['de_novo'], f'/rows/{index}/{prefix}')
        record((1, ri, 10), f'{rounded(row["sun_percent"], 1)} ({row["sun_count"]})',
               sources['de_novo'], f'/rows/{index}/sun_count')
    markdown = Path(sources['symmetry']).read_text()
    line = next(line for line in markdown.splitlines() if line.startswith('| CrystalAR'))
    for ci, local in enumerate([v.strip() for v in line.strip('|').split('|')][1:], 2):
        record((2, 7, ci), local, sources['symmetry'], 'paper table row')
    mp = json.loads(Path(sources['csp_mp20']).read_text())
    for count, ri in (('1', 5), ('20', 10)):
        record((3, ri, 1), mp['curves_over_complete_slots'][count]['gated_rate'] * 100,
               sources['csp_mp20'], f'/curves_over_complete_slots/{count}/gated_rate', 2)
    mpts = json.loads(Path(sources['csp_mpts52']).read_text())
    for count, ri in (('1', 5), ('20', 10)):
        row = mpts['curves'][count]['gated']
        record((3, ri, 3), row['rate'] * 100, sources['csp_mpts52'], f'/curves/{count}/gated/rate', 2)
        record((3, ri, 4), row['matched_only_rmse'], sources['csp_mpts52'],
               f'/curves/{count}/gated/matched_only_rmse', 4)
    # The local typesetting source predates v1. Cross-check it as well, retaining
    # discrepancies in the private report while keeping the PDF values on the page.
    tex = Path(config['paper_tex']).read_text()
    active = re.sub(r'(?m)%.*$', '', tex)
    pattern = r'(?:\\method|CrystalAR)\s*\(Ours\)\s*&([\s\S]*?)\\\\'
    rows = list(re.finditer(pattern, active))
    if len(rows) != 3:
        raise ValueError('expected three main-result CrystalAR rows in the local typesetting source')
    for match, (table, ri) in zip(rows, ((1, 4), (1, 13), (2, 7))):
        for ci, value in enumerate(match[1].split('&'), 1):
            value = value.replace(r'\pm', '±').replace('$', '')
            value = re.sub(r'\\(?:textbf|mathbf|underline)\{([^{}]*)\}', r'\1', value)
            record((table, ri, ci), ' '.join(value.split()), config['paper_tex'],
                   f'line {active.count(chr(10), 0, match.start()) + 1}, column {ci}')
    return checks


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default=str(REPO / 'tools/local_config.json'))
    args = parser.parse_args(argv)
    config = json.loads(Path(args.config).read_text())
    report = Path(config['numbers_report'])
    if report.resolve().is_relative_to(REPO):
        raise ValueError('numbers_report must be outside the published repository')
    data = json.loads((REPO / 'data/numbers.json').read_text())
    checked = verify_pdf(data, config['paper_pdf'])
    html = (REPO / 'index.html').read_text()
    bindings = verify_html(data, html)
    explanatory = verify_explanatory_numbers(html, config['paper_pdf'])
    checks = cross_check_local(data, config)
    sources = {key: {'path': path, 'sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest()}
               for key, path in config['numbers_sources'].items()}
    sources['typesetting'] = {'path': config['paper_tex'],
                             'sha256': hashlib.sha256(Path(config['paper_tex']).read_bytes()).hexdigest()}
    payload = {'paper': data['paper'], 'paperSha256': hashlib.sha256(Path(config['paper_pdf']).read_bytes()).hexdigest(),
               'pdfCheckedCells': checked, 'htmlBindings': bindings, 'explanatoryClaims': explanatory, 'localChecks': checks,
               'localDisagreements': [c for c in checks if not c['agrees']], 'sources': sources}
    report.parent.mkdir(parents=True, exist_ok=True)
    report.with_suffix('.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    lines = ['# 论文数字核验', '', f'权威：{data["paper"]}。', '',
             f'- PDF：按独立坐标逐表、逐单元格核对 {checked} 个值单元格及 8 个完整表题，全部一致。',
             f'- 页面：核对 {bindings} 处 data-number 绑定，并检查所有结果单元格和数字卡片都出现。',
             '- 所有完整列头按 PDF 字符坐标核对，含纯文本指标、数据集和方向；页面再核对实际行列位置、三张卡片的指标和来源。',
             '- 解释图：0–3 个位置自由参数核对 PDF 第 4 页；两处九层细化核对第 17 页；架构图编号核对第 5 页。',
             '- 表 4、5 按要求不作为结果发布；表格标签中的 rank、updates、temperature 等数字也随整行核对。',
             '- 本地数据只含部分 CrystalAR 结果；其他模型和未存入这些结果文件的消融数值以 PDF 为唯一可核对来源。',
             '', '| 单元格 | PDF | 本地原值 | 按论文精度显示 | 一致 |', '|---|---|---|---|---|']
    lines += [f'| {c["cell"]} | {c["paper"]} | {c["local"]} | {c["localDisplayed"]} | {"是" if c["agrees"] else "否，页面采用 PDF"} |' for c in checks]
    lines += ['', '完整路径、指针及源 hash 仅保存在同名 JSON，不进入公开仓库。',
              '未公开运行目录、实验标识和本机路径没有写入 data/numbers.json。']
    report.write_text('\n'.join(lines) + '\n')
    print(f'{checked} PDF cells; {bindings} HTML bindings; {len(checks)} local checks; '
          f'{len(payload["localDisagreements"])} local disagreements')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
