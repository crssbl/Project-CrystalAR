"""Paper values are checked against the actual PDF, rather than copied expectations."""
import copy
import json
from pathlib import Path

import pytest

import extract_figures
import verify_numbers as numbers


@pytest.fixture
def paper_data():
    return json.loads((numbers.REPO / 'data/numbers.json').read_text())


def test_all_eight_tables_and_captions_match_authoritative_pdf(config, paper_data):
    assert numbers.verify_pdf(paper_data, config['paper_pdf']) == 434


def test_pdf_check_rejects_a_changed_value_and_missing_table(config, paper_data):
    altered = copy.deepcopy(paper_data)
    altered['tables'][0]['rows'][4]['values'][8] = '13.8'
    with pytest.raises(ValueError, match='values differ'):
        numbers.verify_pdf(altered, config['paper_pdf'])
    altered = copy.deepcopy(paper_data)
    altered['tables'].pop()
    with pytest.raises(ValueError, match='expected result tables'):
        numbers.verify_pdf(altered, config['paper_pdf'])
    altered = copy.deepcopy(paper_data)
    altered['tables'][1]['columns'][3] = 'P1 (%) · ref = 99999.99'
    with pytest.raises(ValueError, match='column headers'):
        numbers.verify_pdf(altered, config['paper_pdf'])


def test_pdf_check_rejects_a_changed_caption(config, paper_data):
    paper_data['tables'][-1]['caption'] += ' changed'
    with pytest.raises(ValueError, match='caption or page differs'):
        numbers.verify_pdf(paper_data, config['paper_pdf'])


def test_every_result_cell_and_card_is_bound_to_paper_data(paper_data):
    html = (numbers.REPO / 'index.html').read_text()
    assert numbers.verify_html(paper_data, html) == 444
    with pytest.raises(ValueError, match='number card|page binding'):
        numbers.verify_html(paper_data, html.replace('>13.7<', '>13.8<', 1))
    with pytest.raises(ValueError, match='page is missing'):
        numbers.verify_html(paper_data, html.replace('data-number="t10-r3-c3"', 'data-missing="cell"'))


def test_page_check_also_rejects_mislabeled_columns_and_models(paper_data):
    html = (numbers.REPO / 'index.html').read_text()
    with pytest.raises(ValueError, match='headings, row labels or caption'):
        numbers.verify_html(paper_data, html.replace('P1 (%) · ref = 2.23', 'P1 (%) · ref = 2.24'))
    with pytest.raises(ValueError, match='headings, row labels or caption'):
        numbers.verify_html(paper_data, html.replace('<th scope="row">MatterGen</th>', '<th scope="row">Different model</th>'))


def test_local_cross_checks_cover_both_csp_settings_and_keep_pdf_precedence(config, paper_data):
    original = copy.deepcopy(paper_data)
    checks = numbers.cross_check_local(paper_data, config)
    result_checks = [c for c in checks if c['source'] != config['paper_tex']]
    assert len(result_checks) == 33
    assert all(c['agrees'] for c in result_checks)
    for ri in (5, 10):
        for ci in (1, 3, 4):
            assert any(c['cell'] == f't3-r{ri}-c{ci}' for c in result_checks)
    assert any(not c['agrees'] for c in checks), 'stale typesetting values are reported'
    assert paper_data == original, 'a local disagreement must never overwrite the paper'


def test_local_rounding_preserves_paper_precision():
    assert numbers.rounded(13.68, 1) == '13.7'
    assert numbers.rounded(0.1304813067, 4) == '0.1305'
    assert numbers.rounded(25.24703557, 2) == '25.25'
    assert numbers.rounded(-0.785, 2) == '-0.79'


def test_explanatory_numbers_are_checked_against_paper_prose(config):
    html = (numbers.REPO / 'index.html').read_text()
    assert len(numbers.verify_explanatory_numbers(html, config['paper_pdf'])) == 3
    with pytest.raises(ValueError, match='diagram dimensions'):
        numbers.verify_explanatory_numbers(html.replace('>3 free parameters<', '>4 free parameters<'), config['paper_pdf'])
    with pytest.raises(ValueError, match='refinement depth'):
        numbers.verify_explanatory_numbers(html.replace('across nine dyadic', 'across eight dyadic'), config['paper_pdf'])


def test_figure_source_matches_pdf_and_exports_preview_and_thumbnail(config, tmp_path, monkeypatch):
    from PIL import Image
    root = tmp_path / 'published'
    (root / 'assets/img').mkdir(parents=True)
    monkeypatch.setattr(extract_figures, 'REPO', root)
    local = dict(config, figure_report=str(tmp_path / 'figure-report.json'))
    report = extract_figures.export_figures(local)
    assert report['figure'] == 2 and report['vectorStreamIdentical']
    assert report['page'] == 5
    svg = (root / 'assets/img/architecture.svg').read_text()
    assert svg.startswith('<svg') and 'role="img"' in svg
    assert 'aria-labelledby="figure-title" aria-describedby="figure-desc"' in svg
    assert '<title id="figure-title">Figure 2:' in svg and '<desc id="figure-desc">' in svg
    for file, dimensions in [('architecture.webp', (1860, 406)), ('paper-v1.webp', (429, 555))]:
        with Image.open(root / 'assets/img' / file) as image:
            assert image.size == dimensions


def test_figure_export_rejects_an_unrelated_vector(config, tmp_path):
    import pymupdf
    unrelated = tmp_path / 'unrelated.pdf'
    doc = pymupdf.open()
    doc.new_page().insert_text((30, 30), 'unrelated')
    doc.save(unrelated)
    with pytest.raises(ValueError, match='does not match'):
        extract_figures.export_figures(dict(config, architecture_source=str(unrelated)))


def test_swapped_entire_cells_cannot_move_between_datasets(paper_data):
    import re
    html = (numbers.REPO / 'index.html').read_text()
    left = re.search(r'<td data-number="t3-r5-c1">.*?</td>', html)[0]
    right = re.search(r'<td data-number="t3-r5-c3">.*?</td>', html)[0]
    swapped = html.replace(left, 'CELL_PLACEHOLDER').replace(right, left).replace('CELL_PLACEHOLDER', right)
    with pytest.raises(ValueError, match='swapped cell'):
        numbers.verify_html(paper_data, swapped)


def test_wrong_text_column_headers_fail_even_when_html_and_data_agree(config, paper_data):
    altered = copy.deepcopy(paper_data)
    altered['tables'][0]['columns'][9] = 'S.U.N. (%) ↑'
    html = (numbers.REPO / 'index.html').read_text().replace('<th scope="col">Stable (%) ↑</th>', '<th scope="col">S.U.N. (%) ↑</th>')
    assert numbers.verify_html(altered, html) == 444
    with pytest.raises(ValueError, match='column headers'):
        numbers.verify_pdf(altered, config['paper_pdf'])
    altered = copy.deepcopy(paper_data)
    altered['tables'][2]['columns'][1], altered['tables'][2]['columns'][3] = altered['tables'][2]['columns'][3], altered['tables'][2]['columns'][1]
    with pytest.raises(ValueError, match='column headers'):
        numbers.verify_pdf(altered, config['paper_pdf'])


def test_missing_card_wrong_metric_and_wrong_source_are_rejected(paper_data):
    import re
    html = (numbers.REPO / 'index.html').read_text()
    card = re.search(r'<article class="number-card">.*?</article>', html)[0]
    for altered in [html.replace(card, ''), html.replace('De novo · with pre-relaxation', 'De novo · without pre-relaxation'),
                    html.replace('pdf/2610.27762v1#page=7', 'pdf/2610.27762v1#page=9', 1),
                    html.replace('% <span>MPTS-52 match rate</span>', '% <span>MP-20 match rate</span>', 1)]:
        with pytest.raises(ValueError, match='number card'):
            numbers.verify_html(paper_data, altered)


def test_caption_keeps_semantic_hyphen(config, paper_data):
    assert numbers.compact('single-\nhypothesis') == 'single-hypothesis'
    assert 'single-hypothesis' in paper_data['tables'][2]['caption']
    paper_data['tables'][2]['caption'] = paper_data['tables'][2]['caption'].replace('single-hypothesis', 'singlehypothesis')
    with pytest.raises(ValueError, match='caption'):
        numbers.verify_pdf(paper_data, config['paper_pdf'])
