import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formulaHtml, spaceGroupHtml, spaceGroupText, signed, sortCards, meanHull, ssunLabel, escapeHtml, latticeToken } from '../../js/lib/format.js';
import { cardModel, cardHtml, cardsHtml } from '../../js/lib/cards.js';

const index = JSON.parse(await readFile(new URL('../../data/crystals/index.json', import.meta.url), 'utf8'));
const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

test('formula, space group and signed-number formatting', () => {
  assert.equal(formulaHtml('La5Bi3Cl'), 'La<sub>5</sub>Bi<sub>3</sub>Cl');
  assert.equal(formulaHtml('Sc7FeBr12'), 'Sc<sub>7</sub>FeBr<sub>12</sub>');
  assert.equal(spaceGroupHtml('P6_3/mcm'), 'P6<sub>3</sub>/mcm');
  assert.equal(spaceGroupHtml('Pmn2_1'), 'Pmn2<sub>1</sub>');
  assert.equal(spaceGroupHtml('Pm-3'), 'Pm<span class="bar">3</span>');
  assert.equal(spaceGroupHtml('P-62m'), 'P<span class="bar">6</span>2m');
  assert.equal(spaceGroupHtml('R-3'), 'R<span class="bar">3</span>');
  assert.equal(spaceGroupText('P6_3/mcm'), 'P6₃/mcm');
  assert.equal(signed(-54.53390545315351), '−54.5');
  assert.equal(signed(4.3), '+4.3');
  assert.equal(signed(-0.04), '0.0');
  assert.equal(signed(0.04), '0.0');
  assert.equal(escapeHtml('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
  assert.deepEqual(latticeToken('V', 562.68), { label: 'V', text: '562.7 Å³' });
  assert.deepEqual(latticeToken('beta', 90.0457), { label: 'β', text: '90.05°' });
  assert.equal(ssunLabel(3), 'S.S.U.N. by 3 of 3 MLIPs');
});

test('gallery order: La5Bi3Cl first, then MLIP count (desc), then mean hull distance (asc)', () => {
  const order = sortCards(index.crystals).map((c) => c.id);
  assert.deepEqual(order, [
    'denovo:75',
    'denovo:1798', 'denovo:2219',
    'denovo:1431', 'denovo:2006',
    'denovo:570', 'denovo:143', 'denovo:53', 'denovo:2435', 'denovo:766', 'denovo:2002', 'denovo:1559', 'denovo:1190',
  ]);
  // Without the pin, EuP would come first: its mean is lower than La5Bi3Cl's.
  const eup = index.crystals.find((c) => c.id === 'denovo:1798');
  const lbc = index.crystals.find((c) => c.id === 'denovo:75');
  assert.ok(meanHull(eup) < meanHull(lbc));
  assert.equal(sortCards(index.crystals, null)[0].id, 'denovo:1798');
  const sorted = sortCards(index.crystals).slice(1);
  for (let i = 1; i < sorted.length; i += 1) {
    const [a, b] = [sorted[i - 1], sorted[i]];
    assert.ok(a.ssunCount > b.ssunCount || (a.ssunCount === b.ssunCount && meanHull(a) <= meanHull(b)));
  }
});

test('all 13 candidates, none filtered', () => {
  assert.equal(index.crystals.length, 13);
  const counts = index.crystals.reduce((m, c) => ({ ...m, [c.ssunCount]: (m[c.ssunCount] ?? 0) + 1 }), {});
  assert.deepEqual(counts, { 1: 8, 2: 2, 3: 3 });
});

test('card model and markup carry poster, formula, space group, three hull values and the count', () => {
  const entry = index.crystals[0];
  const m = cardModel(entry);
  assert.deepEqual(m.hull.map((h) => h.text), ['−54.5', '−28.8', '−47.7']);
  assert.deepEqual(m.hull.map((h) => h.ssun), [true, true, true]);
  const card = cardHtml(entry);
  assert.match(card, /<img src="assets\/img\/posters\/denovo-75\.webp" alt="" width="640" height="640" loading="lazy"/);
  assert.match(card, /La<sub>5<\/sub>Bi<sub>3<\/sub>Cl/);
  assert.match(card, /P6<sub>3<\/sub>\/mcm <span>#193<\/span>/);
  assert.match(card, /aria-haspopup="dialog" data-open="denovo-75"/);
  assert.match(card, /S\.S\.U\.N\. by 3 of 3 MLIPs/);
  assert.match(card, /href="assets\/cif\/denovo-75\.cif" download/);
  const mace = cardModel(index.crystals.find((c) => c.id === 'denovo:570'));
  assert.deepEqual(mace.hull.map((h) => h.ssun), [false, true, false]);
  for (const entry2 of index.crystals) assert.ok(!/novel template/i.test(cardHtml(entry2)));
});

test('index.html carries the generated cards in gallery order (npm run gallery)', () => {
  assert.ok(html.includes(cardsHtml(index.crystals)));
  const ids = [...html.matchAll(/<li class="card" data-id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, sortCards(index.crystals).map((c) => c.id));
  assert.match(html, /judged S\.S\.U\.N\. by at least one of three MLIPs \(Orb, MACE, UMA\), and 3 of them by all three/);
  assert.match(html, /There is no DFT or experimental validation\./);
  const gallery = html.slice(html.indexOf('id="crystals"'), html.indexOf('id="results"'));
  assert.ok(!/novel template/i.test(gallery));
});
