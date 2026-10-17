let instanceCount = 0;

const STAGES = [
  { title: 'Symmetry context', short: 'Symmetry', step: 0 },
  { title: 'Wyckoff template', short: 'Template', step: 1 },
  { title: 'Lattice', short: 'Lattice', step: 2 },
  { title: 'Coordinate refinement', short: 'Refinement', step: 3 },
  { title: 'Symmetry expansion', short: 'Expansion', step: 7 },
];

const STEPS = [
  {
    stage: 0,
    title: 'Begin with symmetry.',
    body: 'The symmetry group defines the transformations a crystal must respect. This square-cell illustration uses fourfold rotations and mirror reflections.',
    equation: 'Symmetry context: G ≃ p4mm',
    detail: 'Fourfold rotation · mirror symmetry',
    caption: 'A 2D symmetry group provides the context for every subsequent decision.',
  },
  {
    stage: 1,
    title: 'Generate the symmetry template.',
    body: 'The model sequentially assigns an element and a Wyckoff position to each inequivalent site. The template determines where each site is allowed to lie, before its free coordinates are localized.',
    equation: 'T = {(element, Wyckoff position)}',
    detail: 'A fixed point · two lines · a plane',
    caption: 'Colored domains show the allowed positions; free coordinates have not yet been selected.',
  },
  {
    stage: 2,
    title: 'Establish the lattice.',
    body: 'Lattice parameters are generated within the family permitted by the symmetry. The lattice sets the cell geometry before fractional coordinates are refined.',
    equation: 'G → T → L',
    detail: 'Square-cell analogy: a = b, γ = 90°',
    caption: 'The illustrated square cell stays fixed during coordinate refinement.',
  },
  ...[1, 2, 3, 4].map((level) => ({
    stage: 3,
    level,
    title: level === 1 ? 'Localize, then refine.' : 'Refine every site together.',
    body: 'Each level narrows the allowed region of every inequivalent site. Sites interact within a level; the next level is conditioned on the previous refinement history. A fixed site needs no coordinate refinement.',
    equation: 'R⁽¹⁾ → R⁽²⁾ → R⁽³⁾ → R⁽⁴⁾',
    detail: `Illustrative level ${level} / 4 · free-parameter width 1/${2 ** level}`,
    caption: 'Dots mark region centers, not atom motion. Every site advances to the same resolution level.',
  })),
  {
    stage: 4,
    title: 'Expand by symmetry.',
    body: 'Apply the group operations to each localized representative. A small set of inequivalent sites produces the complete, symmetric pattern within the periodic cell.',
    equation: 'Representatives + symmetry → full pattern',
    detail: '1 fixed + 4 line + 4 diagonal + 8 general sites',
    caption: 'Periodic copies of the fixed site appear at the four corners of the cell.',
  },
];

const SITES = [
  { key: 'fixed', symbol: 'A', name: 'Fixed site', form: '(0, 0)', dof: '0 free parameters', color: '#243f56' },
  { key: 'line', symbol: 'B', name: 'Line-constrained', form: '(u, ½)', dof: '1 free parameter', color: '#bd613f' },
  { key: 'diagonal', symbol: 'C', name: 'Line-constrained', form: '(u, u)', dof: '1 free parameter', color: '#b69435' },
  { key: 'plane', symbol: 'D', name: 'Plane-constrained', form: '(u, v)', dof: '2 free parameters', color: '#057f7a' },
];

const CELL = { x: 126, y: 70, size: 340 };
const bottom = CELL.y + CELL.size;
const px = (x) => CELL.x + x * CELL.size;
const py = (y) => bottom - y * CELL.size;
const svg = (content, attrs = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${attrs}>${content}</svg>`;
const ICONS = {
  play: svg('<path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/>'),
  pause: svg('<path d="M8 5v14M16 5v14" stroke-width="3"/>'),
  prev: svg('<path d="m14 6-6 6 6 6"/>'),
  next: svg('<path d="m10 6 6 6-6 6"/>'),
  reset: svg('<path d="M5 9a8 8 0 1 1-.1 6M5 4v5h5"/>'),
};

function regionFor(value, level) {
  const width = 1 / (2 ** level);
  const start = Math.floor(value / width) * width;
  return { start, end: start + width, center: start + width / 2, width };
}

function orbit(x, y) {
  const wrapped = (value) => ((value % 1) + 1) % 1;
  const seen = new Set();
  return [[x, y], [-y, x], [-x, -y], [y, -x], [-x, y], [x, -y], [y, x], [-y, -x]]
    .map(([a, b]) => [wrapped(a), wrapped(b)])
    .filter(([a, b]) => {
      const key = `${a.toFixed(7)},${b.toFixed(7)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function circle(x, y, color, { representative = false, symbol = '', small = false } = {}) {
  return `<g class="method-site${representative ? ' method-site--representative' : ''}">
    ${representative ? `<circle cx="${px(x)}" cy="${py(y)}" r="12.5" fill="white" stroke="${color}" stroke-opacity=".25"/>` : ''}
    <circle cx="${px(x)}" cy="${py(y)}" r="${small ? 5.6 : 7}" fill="${color}" stroke="white" stroke-width="2"/>
    ${symbol ? `<text x="${px(x) + 16}" y="${py(y) - 11}" class="method-svg-site-label" fill="${color}">${symbol}</text>` : ''}
  </g>`;
}

function drawDiagram(stepIndex, id) {
  const step = STEPS[stepIndex];
  const level = step.level || (step.stage === 4 ? 4 : 0);
  const domainsVisible = step.stage > 0;
  const refining = step.stage === 3;
  const expanded = step.stage === 4;
  const divisions = refining ? 2 ** level : (expanded ? 8 : 4);
  const b = regionFor(.235, level);
  const c = regionFor(.38, level);
  const dx = regionFor(.16, level);
  const dy = regionFor(.72, level);
  const grid = Array.from({ length: divisions - 1 }, (_, i) => (i + 1) / divisions)
    .map((v) => `<path d="M${px(v)} ${CELL.y}V${bottom}M${CELL.x} ${py(v)}H${px(1)}"/>`).join('');
  const mirrors = `<path d="M${px(.5)} ${CELL.y}V${bottom}M${CELL.x} ${py(.5)}H${px(1)}M${CELL.x} ${CELL.y}L${px(1)} ${bottom}M${CELL.x} ${bottom}L${px(1)} ${CELL.y}"/>`;

  let sites = '';
  if (domainsVisible) {
    sites += circle(0, 0, SITES[0].color, { representative: !expanded, symbol: !expanded ? 'A' : '' });
  }
  if (refining) {
    sites += circle(b.center, .5, SITES[1].color, { representative: true, symbol: 'B' });
    sites += circle(c.center, c.center, SITES[2].color, { representative: true, symbol: 'C' });
    sites += circle(dx.center, dy.center, SITES[3].color, { representative: true, symbol: 'D' });
  }
  if (expanded) {
    sites += [[1, 0], [0, 1], [1, 1]].map(([x, y]) => circle(x, y, SITES[0].color)).join('');
    [[b.center, .5, SITES[1].color], [c.center, c.center, SITES[2].color], [dx.center, dy.center, SITES[3].color]]
      .forEach(([x, y, color]) => {
        sites += orbit(x, y).map(([a, bb], i) => circle(a, bb, color, { representative: i === 0, small: i !== 0 })).join('');
      });
  }

  const domainMarkup = domainsVisible ? `<g clip-path="url(#${id}-cell)" opacity="${expanded ? '.32' : '1'}">
    <rect x="${px(dx.start)}" y="${py(dy.end)}" width="${dx.width * CELL.size}" height="${dy.width * CELL.size}" fill="url(#${id}-hatch)" stroke="#057f7a" stroke-opacity=".55" stroke-width="1.3"/>
    <path d="M${px(0)} ${py(.5)}H${px(1)}" stroke="#bd613f" stroke-width="1.5" stroke-dasharray="3 5" opacity=".46"/>
    <path d="M${px(0)} ${py(0)}L${px(1)} ${py(1)}" stroke="#b69435" stroke-width="1.5" stroke-dasharray="3 5" opacity=".55"/>
    <path d="M${px(b.start)} ${py(.5)}H${px(b.end)}" stroke="#bd613f" stroke-width="7" stroke-opacity=".52"/>
    <path d="M${px(c.start)} ${py(c.start)}L${px(c.end)} ${py(c.end)}" stroke="#b69435" stroke-width="7" stroke-opacity=".55"/>
    ${refining ? `<path d="M${px(b.start)} ${py(.5) - 7}v14M${px(b.end)} ${py(.5) - 7}v14" stroke="#bd613f" stroke-width="1.5"/>
    <path d="M${px(c.start) - 5} ${py(c.start) - 5}l10 10M${px(c.end) - 5} ${py(c.end) - 5}l10 10" stroke="#b69435" stroke-width="1.5"/>` : ''}
  </g>` : '';

  return `<svg class="method-diagram" viewBox="0 0 590 480" role="img" aria-labelledby="${id}-svg-title ${id}-svg-desc">
    <title id="${id}-svg-title">${STAGES[step.stage].title}${level && !expanded ? `, level ${level}` : ''}: 2D pedagogical illustration</title>
    <desc id="${id}-svg-desc">${step.caption} Blue marks a fixed site, rust a horizontal-line site, gold a diagonal-line site, and teal a plane-constrained site. This is an illustration, not a recorded model trajectory.</desc>
    <defs>
      <clipPath id="${id}-cell"><rect x="${CELL.x}" y="${CELL.y}" width="${CELL.size}" height="${CELL.size}"/></clipPath>
      <pattern id="${id}-hatch" width="9" height="9" patternUnits="userSpaceOnUse"><rect width="9" height="9" fill="#057f7a" fill-opacity=".045"/><path d="M-2 2 2-2M0 9 9 0M7 11l4-4" stroke="#057f7a" stroke-width=".65" stroke-opacity=".16"/></pattern>
      <marker id="${id}-arrow" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="m1 1 6 3-6 3" fill="none" stroke="currentColor"/></marker>
    </defs>
    <text x="${CELL.x}" y="36" class="method-svg-eyebrow">FRACTIONAL-COORDINATE CELL</text>
    <text x="${px(1)}" y="36" text-anchor="end" class="method-svg-group">p4mm</text>
    <rect x="${CELL.x}" y="${CELL.y}" width="${CELL.size}" height="${CELL.size}" fill="#fff"/>
    <g class="method-svg-grid">${grid}</g>
    <g class="method-svg-mirrors" opacity="${step.stage === 0 ? '.75' : '.18'}">${mirrors}</g>
    ${domainMarkup}
    <rect x="${CELL.x}" y="${CELL.y}" width="${CELL.size}" height="${CELL.size}" class="method-svg-cell"/>
    ${step.stage === 0 ? `<g class="method-svg-rotation" transform="translate(${px(.5)} ${py(.5)})">
      <circle r="35" fill="#fff" stroke="#057f7a" stroke-opacity=".18"/>
      <path d="M-17-8a19 19 0 1 1 0 17M-22-17l5 9 9-5" fill="none" stroke="#057f7a" stroke-width="1.7"/>
      <text y="5" text-anchor="middle" class="method-svg-four">4</text>
    </g>
    <text x="${px(.5) + 10}" y="${CELL.y + 20}" class="method-svg-mirror-label">m</text>
    <text x="${px(1) - 22}" y="${py(.5) - 11}" class="method-svg-mirror-label">m</text>` : ''}
    ${step.stage === 2 ? `<g class="method-svg-dimensions">
      <path d="M${CELL.x} ${bottom + 24}H${px(1)}" marker-start="url(#${id}-arrow)" marker-end="url(#${id}-arrow)"/>
      <path d="M${CELL.x - 25} ${CELL.y}V${bottom}" marker-start="url(#${id}-arrow)" marker-end="url(#${id}-arrow)"/>
      <text x="${px(.5)}" y="${bottom + 43}" text-anchor="middle">a</text>
      <text x="${CELL.x - 41}" y="${py(.5) + 4}" text-anchor="middle">a</text>
      <path d="M${CELL.x} ${bottom - 20}h20v20"/>
    </g>` : `<g class="method-svg-axis-labels">
      <text x="${CELL.x - 13}" y="${bottom + 19}">0</text>
      <text x="${px(1)}" y="${bottom + 21}" text-anchor="middle">1</text>
      <text x="${CELL.x - 19}" y="${CELL.y + 4}" text-anchor="middle">1</text>
      <text x="${px(.5)}" y="${bottom + 39}" text-anchor="middle">fractional x</text>
      <text transform="translate(${CELL.x - 45} ${py(.5)}) rotate(-90)" text-anchor="middle">fractional y</text>
    </g>`}
    ${sites}
    ${step.stage === 1 ? `<g class="method-svg-domain-labels">
      <text x="${px(.84)}" y="${py(.8)}" text-anchor="middle" fill="#057f7a">(u, v)</text>
      <text x="${px(.82)}" y="${py(.5) - 12}" text-anchor="middle" fill="#bd613f">(u, ½)</text>
      <text x="${px(.27)}" y="${py(.27) + 25}" text-anchor="middle" fill="#9a7929">(u, u)</text>
    </g>` : ''}
    ${refining ? `<g transform="translate(${px(1) + 22} ${CELL.y + 4})" class="method-svg-levels">
      <text y="0">LEVEL</text>
      ${[1, 2, 3, 4].map((n) => `<rect x="0" y="${17 + (n - 1) * 13}" width="20" height="6" rx="1" fill="${n <= level ? '#057f7a' : '#dce7e2'}"/>`).join('')}
      <text y="87" class="method-svg-level-count">${level}/4</text>
    </g>` : ''}
  </svg>`;
}

/** Mount the self-contained, illustrative method figure. No model runs are performed. */
export function mountMethod(container) {
  if (!container || typeof container.replaceChildren !== 'function') {
    throw new TypeError('mountMethod requires a DOM container.');
  }
  const id = `crystalar-method-${++instanceCount}`;
  const root = document.createElement('div');
  root.className = 'method-demo';
  root.innerHTML = `
    <div class="method-demo__topline"><span class="method-demo__label"><i aria-hidden="true"></i>2D pedagogical illustration</span><span class="method-demo__source">Adapted from Fig. 1</span></div>
    <nav class="method-demo__stages" aria-label="Method stages">${STAGES.map((stage, i) => `<button type="button" data-stage="${i}" title="${stage.title}"><span class="method-demo__stage-number">0${i + 1}</span><span>${stage.short}</span></button>`).join('')}</nav>
    <div class="method-demo__body">
      <figure class="method-demo__figure"><div class="method-demo__drawing"></div><figcaption class="method-demo__caption"></figcaption></figure>
      <div class="method-demo__narrative">
        <div class="method-demo__explanation" aria-live="polite" aria-atomic="true">
          <p class="method-demo__stage-title"></p><h3 class="method-demo__title"></h3><p class="method-demo__description"></p><div class="method-demo__equation"></div><p class="method-demo__detail"></p>
        </div>
        <div class="method-demo__legend"><p class="method-demo__legend-title">INEQUIVALENT SITES <span>Illustrative species</span></p>
        ${SITES.map((site) => `<div class="method-demo__legend-row"><span class="method-demo__site-symbol method-demo__site-symbol--${site.key}">${site.symbol}</span><span class="method-demo__site-name">${site.name}<small>${site.dof}</small></span><span class="method-demo__site-form">${site.form}</span></div>`).join('')}
        <p class="method-demo__legend-note">Free parameters are mapped onto their Wyckoff-constrained positions.</p></div>
      </div>
    </div>
    <div class="method-demo__player">
      <div class="method-demo__buttons"><button type="button" class="method-demo__play" data-action="play" aria-label="Play illustration">${ICONS.play}<span>Play</span></button><button type="button" class="method-demo__icon-button" data-action="prev" aria-label="Previous step" title="Previous step">${ICONS.prev}</button><button type="button" class="method-demo__icon-button" data-action="next" aria-label="Next step" title="Next step">${ICONS.next}</button><button type="button" class="method-demo__reset" data-action="reset" aria-label="Reset illustration">${ICONS.reset}<span>Reset</span></button></div>
      <div class="method-demo__scrubber"><div class="method-demo__scrubber-heading"><label for="${id}-range">Explore the generation stages</label><output for="${id}-range" class="method-demo__step-count"></output></div><input id="${id}-range" type="range" min="0" max="7" step="1" value="0" aria-label="Illustration step"/><div class="method-demo__scrubber-labels" aria-hidden="true"><span>Symmetry</span><span>Full pattern</span></div></div>
    </div>
    <p class="method-demo__footnote">A schematic explanation of the method, not a recorded model trajectory. Real generated 3D crystals are presented separately.</p>`;
  container.replaceChildren(root);

  const drawing = root.querySelector('.method-demo__drawing');
  const range = root.querySelector('input[type="range"]');
  const playButton = root.querySelector('[data-action="play"]');
  const prevButton = root.querySelector('[data-action="prev"]');
  const nextButton = root.querySelector('[data-action="next"]');
  const resetButton = root.querySelector('[data-action="reset"]');
  const fields = Object.fromEntries(['stage-title', 'title', 'description', 'equation', 'detail', 'caption', 'step-count'].map((name) => [name, root.querySelector(`.method-demo__${name}`)]));
  let index = 0;
  let timer = null;
  let destroyed = false;

  function updatePlayButton() {
    const playing = timer !== null;
    playButton.innerHTML = `${playing ? ICONS.pause : ICONS.play}<span>${playing ? 'Pause' : 'Play'}</span>`;
    playButton.setAttribute('aria-label', playing ? 'Pause illustration' : 'Play illustration');
    playButton.setAttribute('aria-pressed', String(playing));
    resetButton.disabled = index === 0 && !playing;
  }

  function pause() {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    updatePlayButton();
  }

  function render() {
    if (destroyed) return;
    const step = STEPS[index];
    drawing.innerHTML = drawDiagram(index, id);
    root.dataset.stage = String(step.stage);
    root.dataset.level = String(step.level || 0);
    fields['stage-title'].textContent = `0${step.stage + 1} / ${STAGES[step.stage].title}`;
    fields.title.textContent = step.title;
    fields.description.textContent = step.body;
    fields.equation.textContent = step.equation;
    fields.detail.textContent = step.detail;
    fields.caption.textContent = step.caption;
    fields['step-count'].textContent = `${index + 1} / ${STEPS.length}`;
    range.value = String(index);
    range.style.setProperty('--method-progress', `${index / (STEPS.length - 1) * 100}%`);
    range.setAttribute('aria-valuetext', `${STAGES[step.stage].title}${step.level ? `, refinement level ${step.level} of 4` : ''}, step ${index + 1} of ${STEPS.length}`);
    prevButton.disabled = index === 0;
    nextButton.disabled = index === STEPS.length - 1;
    root.querySelectorAll('[data-stage]').forEach((button) => {
      const active = Number(button.dataset.stage) === step.stage;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    updatePlayButton();
  }

  function goTo(nextIndex, manual = true) {
    if (manual) pause();
    index = Math.max(0, Math.min(STEPS.length - 1, nextIndex));
    if (index === STEPS.length - 1) pause();
    render();
  }

  function play() {
    if (timer !== null) return pause();
    if (index === STEPS.length - 1) goTo(0);
    timer = window.setInterval(() => goTo(index + 1, false), 2400);
    updatePlayButton();
  }

  function handleClick(event) {
    const button = event.target.closest('button');
    if (!button || !root.contains(button) || button.disabled) return;
    if (button.dataset.stage !== undefined) return goTo(STAGES[Number(button.dataset.stage)].step);
    if (button.dataset.action === 'play') play();
    if (button.dataset.action === 'prev') goTo(index - 1);
    if (button.dataset.action === 'next') goTo(index + 1);
    if (button.dataset.action === 'reset') goTo(0);
  }

  function handleInput() { goTo(Number(range.value)); }

  function handleKeydown(event) {
    if (event.target === range || event.altKey || event.ctrlKey || event.metaKey) return;
    const keys = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: STEPS.length - 1 };
    if (Object.hasOwn(keys, event.key)) {
      event.preventDefault();
      goTo(keys[event.key]);
    }
    if (event.key === 'Escape') pause();
  }

  function handleVisibility() { if (document.hidden) pause(); }

  root.addEventListener('click', handleClick);
  root.addEventListener('keydown', handleKeydown);
  range.addEventListener('input', handleInput);
  document.addEventListener('visibilitychange', handleVisibility);
  render();

  return {
    destroy() {
      if (destroyed) return;
      pause();
      destroyed = true;
      root.removeEventListener('click', handleClick);
      root.removeEventListener('keydown', handleKeydown);
      range.removeEventListener('input', handleInput);
      document.removeEventListener('visibilitychange', handleVisibility);
      root.remove();
    },
  };
}
