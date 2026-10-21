// One renderer for every 3D view on the page: hero loop, story stage and gallery dialog.
// Atoms are instanced spheres, the cell and region segments are instanced cylinders.
// It renders only on demand, pauses off-screen or in hidden tabs, and caps the pixel ratio.
import { loadThree, hasWebGL2 } from './three-loader.js';
import { fracToCart, cellEdgesFrac, cellCenterCart, cellBoundingRadius, periodicImages } from '../lib/crystal-math.js';
import { elementColor, atomDisplayRadius, UI } from '../lib/palette.js';

const THEMES = {
  light: { cell: '#8B95A1', cellOpacity: 0.85, manifoldOpacity: 0.32, haloOpacity: 0.18, additive: false, probe: '#8B95A1', label: 'light' },
  stage: { cell: '#5F6B78', cellOpacity: 0.95, manifoldOpacity: 0.5, haloOpacity: 0.6, additive: true, probe: '#7D8996', label: 'stage' },
};

export function pixelRatioCap() {
  const narrow = window.matchMedia('(max-width: 767px)').matches || window.matchMedia('(pointer: coarse)').matches;
  return Math.min(window.devicePixelRatio || 1, narrow ? 1.5 : 2);
}

// Scratch objects for writing instance matrices. setDisplay runs every frame in the hero loop,
// the scroll story and the replay, so the per-instance path reuses these and allocates nothing.
let scratch = null;
function scratchFor(T) {
  if (scratch?.T !== T) {
    scratch = {
      T,
      from: new T.Vector3(),
      dir: new T.Vector3(),
      mid: new T.Vector3(),
      scale: new T.Vector3(),
      up: new T.Vector3(0, 1, 0),
      turn: new T.Quaternion(),
      none: new T.Quaternion(),
      matrix: new T.Matrix4(),
      label: new T.Vector3(),
    };
  }
  return scratch;
}

/** Writes instance `i` of `mesh` as a cylinder of `radius` from a to b (Cartesian). */
export function writeCylinder(T, mesh, i, a, b, radius) {
  const s = scratchFor(T);
  s.from.set(a[0], a[1], a[2]);
  s.dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = Math.max(s.dir.length(), 1e-6);
  s.dir.divideScalar(len);
  s.turn.setFromUnitVectors(s.up, s.dir);
  s.mid.copy(s.from).addScaledVector(s.dir, len * 0.5);
  s.scale.set(radius, len, radius);
  mesh.setMatrixAt(i, s.matrix.compose(s.mid, s.turn, s.scale));
}

/** Writes instance `i` of `mesh` as a sphere of `radius` at p (Cartesian). */
export function writeSphere(T, mesh, i, p, radius) {
  const s = scratchFor(T);
  s.mid.set(p[0], p[1], p[2]);
  s.scale.set(radius, radius, radius);
  mesh.setMatrixAt(i, s.matrix.compose(s.mid, s.none, s.scale));
}

/** Creates a view inside `container`, or returns null when WebGL2 is unavailable. */
export async function createCrystalView(container, options = {}) {
  if (!hasWebGL2()) return null;
  const THREE = await loadThree();
  return new CrystalView(THREE, container, options);
}

export class CrystalView {
  constructor(THREE, container, options) {
    this.T = THREE;
    this.container = container;
    this.options = { theme: 'light', interactive: true, preserveDrawingBuffer: false, label: 'Crystal structure', ...options };
    this.theme = THEMES[this.options.theme] ?? THEMES.light;
    this.yaw = this.options.yaw ?? -0.62;
    this.pitch = this.options.pitch ?? 0.32;
    this.autoRotate = 0;
    this.visible = true;
    this.frameQueued = false;
    this.lastTime = 0;
    this.tickers = new Set();
    this.disposed = false;

    const T = THREE;
    const canvas = document.createElement('canvas');
    canvas.className = this.options.canvasClass ?? 'crystal-canvas';
    this.canvas = canvas;
    // A lost context (GPU reset, memory pressure, a mobile tab sent to the background) leaves
    // a blank canvas. Rendering stops and the owner falls back to its still image through
    // onContextLost; preventDefault() keeps the context restorable.
    this.contextLost = false;
    this.onLost = (event) => {
      event.preventDefault();
      if (this.disposed) return;
      this.contextLost = true;
      this.onContextLost?.();
    };
    this.onRestored = () => {
      if (this.disposed) return;
      this.contextLost = false;
      this.onContextRestored?.();
    };
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.renderer = new T.WebGLRenderer({
      canvas, antialias: true, alpha: true, powerPreference: 'low-power',
      preserveDrawingBuffer: this.options.preserveDrawingBuffer,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.NoToneMapping;
    this.renderer.setPixelRatio(this.options.pixelRatio ?? pixelRatioCap());

    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(26, 1, 0.1, 400);
    this.world = new T.Group(); // user rotation
    this.crystal = new T.Group(); // crystal z axis up
    this.crystal.rotation.x = -Math.PI / 2;
    this.content = new T.Group(); // centred on the cell
    this.crystal.add(this.content);
    this.world.add(this.crystal);
    this.scene.add(this.world);

    this.scene.add(new T.HemisphereLight(0xffffff, 0x404858, 1.55));
    const key = new T.DirectionalLight(0xffffff, 2.3);
    key.position.set(-4, 7, 9);
    const rim = new T.DirectionalLight(0xdfe9ff, 0.9);
    rim.position.set(6, -2, -6);
    this.scene.add(key, rim);

    this.unitSphere = new T.SphereGeometry(1, 32, 22);
    this.unitCylinder = new T.CylinderGeometry(1, 1, 1, 14, 1, false);
    this.mats = {
      cell: new T.MeshBasicMaterial({ color: this.theme.cell, transparent: true, opacity: this.theme.cellOpacity }),
      region: new T.MeshBasicMaterial({ color: UI.accent }),
      gate: new T.MeshBasicMaterial({ color: UI.accent, transparent: true, opacity: this.theme.additive ? 0.5 : 0.38, depthWrite: false, side: T.DoubleSide }),
      halo: new T.MeshBasicMaterial({
        color: UI.accent, transparent: true, opacity: this.theme.haloOpacity, depthWrite: false,
        blending: this.theme.additive ? T.AdditiveBlending : T.NormalBlending,
      }),
      manifold: new T.MeshBasicMaterial({
        color: UI.accent, transparent: true, opacity: this.theme.manifoldOpacity, depthWrite: false, side: T.DoubleSide,
      }),
      patch: new T.MeshBasicMaterial({ color: UI.accent, transparent: true, opacity: 0.55, depthWrite: false, side: T.DoubleSide }),
      probe: new T.MeshBasicMaterial({ color: this.theme.probe, transparent: true, opacity: 0.9 }),
    };
    this.pools = {};
    this.atomMeshes = new Map();

    container.appendChild(canvas);
    if (this.options.overlay !== false) {
      this.overlay = document.createElement('div');
      this.overlay.className = 'crystal-labels';
      this.overlay.setAttribute('aria-hidden', 'true');
      container.appendChild(this.overlay);
    }
    if (this.options.interactive) this.attachControls();
    this.observe();
    this.resize();
  }

  // ------------------------------------------------------------------ lifecycle
  observe() {
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.io = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible) this.requestRender();
    }, { rootMargin: '120px 0px' });
    this.io.observe(this.container);
    this.onVisibility = () => { if (!document.hidden) this.requestRender(); };
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  get running() {
    return this.visible && !document.hidden && !this.disposed && !this.contextLost;
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.camera.aspect = w / h;
    this.fitCamera();
    this.requestRender();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.resizeObserver?.disconnect();
    this.io?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.detachControls?.();
    this.scene.traverse((o) => { o.geometry?.dispose?.(); });
    Object.values(this.mats).forEach((m) => m.dispose());
    this.atomMeshes.forEach(({ mesh }) => mesh.material.dispose());
    this.renderer.dispose();
    if (!this.contextLost) this.renderer.forceContextLoss?.();
    this.canvas.remove();
    this.overlay?.remove();
  }
  // ------------------------------------------------------------------ rendering
  /** Schedules one frame; frames keep coming while a ticker or auto-rotation is active. */
  requestRender() {
    if (this.frameQueued || this.disposed) return;
    this.frameQueued = true;
    requestAnimationFrame((time) => this.frame(time));
  }

  frame(time) {
    this.frameQueued = false;
    if (!this.running) return;
    // Wall-clock steps (capped) so timed sequences keep their pace on slow GPUs.
    const dt = this.lastTime ? Math.min(0.25, (time - this.lastTime) / 1000) : 0;
    this.lastTime = time;
    let again = false;
    for (const tick of this.tickers) if (tick(dt, time) !== false) again = true;
    if (this.autoRotate && !this.dragging) {
      this.yaw += this.autoRotate * dt;
      again = true;
    }
    this.applyRotation();
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    this.rendered = (this.rendered ?? 0) + 1;
    if (again) this.requestRender();
    else this.lastTime = 0;
  }

  /** A ticker is called every frame with (dt, time); returning false lets the loop rest. */
  addTicker(fn) {
    this.tickers.add(fn);
    this.requestRender();
    return () => this.tickers.delete(fn);
  }

  setAutoRotate(speed) {
    this.autoRotate = speed;
    if (speed) this.requestRender();
  }

  applyRotation() {
    if (Math.abs(this.pitch - (this.fitPitch ?? this.pitch)) > 0.01) this.fitCamera();
    this.world.rotation.set(this.pitch, this.yaw, 0, 'XYZ');
  }

  /**
   * Frames the final cell for the current tilt. The crystal turns about its vertical c axis,
   * so the fit uses a cylinder bound: radius `rxy` around the axis, half height `hz`.
   */
  fitCamera() {
    const { rxy = 6, hz = 6 } = this.extent ?? {};
    const fov = (this.camera.fov * Math.PI) / 180;
    const aspect = Math.max(0.2, this.camera.aspect || 1);
    const tanV = Math.tan(fov / 2);
    const tanH = tanV * aspect;
    const p = Math.min(1.3, Math.abs(this.pitch));
    const vert = hz * Math.cos(p) + rxy * Math.sin(p);
    const depth = rxy * Math.cos(p) + hz * Math.sin(p);
    let distance = (Math.max(vert / tanV, rxy / tanH) + depth * 0.42) * (this.options.margin ?? 1.06);
    if (this.options.fit === 'view' && this.fitPoints) {
      // Exact framing for a fixed view (posters, hero): every point must satisfy
      // |x| / (D − z) ≤ tan(fov/2) horizontally and vertically.
      const T = this.T;
      const m = new T.Matrix4().makeRotationFromEuler(new T.Euler(this.pitch, this.yaw, 0, 'XYZ'))
        .multiply(new T.Matrix4().makeRotationX(-Math.PI / 2));
      const v = new T.Vector3();
      distance = 0;
      for (const [x, y, z, r] of this.fitPoints) {
        v.set(x, y, z).applyMatrix4(m);
        distance = Math.max(distance, v.z + r + Math.max((Math.abs(v.x) + r) / tanH, (Math.abs(v.y) + r) / tanV));
      }
      distance *= this.options.margin ?? 1.04;
    }
    this.fitPitch = this.pitch;
    this.camera.position.set(0, 0, distance);
    this.camera.near = Math.max(0.1, distance - depth * 3);
    this.camera.far = distance + depth * 3;
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ controls
  attachControls() {
    const c = this.canvas;
    c.tabIndex = 0;
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', `${this.options.label}. Drag, or use the arrow keys, to rotate.`);
    let last = null;
    const down = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      this.dragging = true;
      last = [e.clientX, e.clientY];
      c.setPointerCapture?.(e.pointerId);
      this.onInteract?.();
    };
    const move = (e) => {
      if (!this.dragging || !last) return;
      const dx = e.clientX - last[0];
      const dy = e.clientY - last[1];
      last = [e.clientX, e.clientY];
      this.yaw += dx * 0.0085;
      this.pitch = Math.max(-1.25, Math.min(1.25, this.pitch + dy * 0.0065));
      this.requestRender();
    };
    const up = (e) => {
      this.dragging = false;
      last = null;
      c.releasePointerCapture?.(e.pointerId);
      this.requestRender();
    };
    const key = (e) => {
      const steps = { ArrowLeft: [-0.14, 0], ArrowRight: [0.14, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] };
      const s = steps[e.key];
      if (!s) return;
      e.preventDefault();
      this.yaw += s[0];
      this.pitch = Math.max(-1.25, Math.min(1.25, this.pitch + s[1]));
      this.onInteract?.();
      this.requestRender();
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('keydown', key);
    this.detachControls = () => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up);
      c.removeEventListener('keydown', key);
    };
  }
  // ------------------------------------------------------------------ geometry
  /** Prepares atom meshes and the camera for one crystal trace. */
  setTrace(trace) {
    const T = this.T;
    this.trace = trace;
    this.atomMeshes.forEach(({ mesh }) => { this.content.remove(mesh); mesh.material.dispose(); });
    this.atomMeshes.clear();
    const counts = new Map();
    for (const atom of trace.atoms) counts.set(atom.element, (counts.get(atom.element) ?? 0) + 8);
    for (const site of trace.sites) counts.set(site.element, (counts.get(site.element) ?? 0) + 2);
    for (const [element, capacity] of counts) {
      const material = new T.MeshStandardMaterial({ color: elementColor(element), roughness: 0.42, metalness: 0.0 });
      const mesh = new T.InstancedMesh(this.unitSphere, material, capacity);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.content.add(mesh);
      this.atomMeshes.set(element, { mesh, radius: atomDisplayRadius(element) });
    }
    const maxAtom = Math.max(...[...this.atomMeshes.values()].map((a) => a.radius));
    this.maxAtomRadius = maxAtom;
    this.boundRadius = cellBoundingRadius(trace.lattice.matrix) + maxAtom;
    const m = trace.lattice.matrix;
    const centre = cellCenterCart(m);
    let rxy = 0;
    let hz = 0;
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) {
      const q = fracToCart([x, y, z], m);
      rxy = Math.max(rxy, Math.hypot(q[0] - centre[0], q[1] - centre[1]));
      hz = Math.max(hz, Math.abs(q[2] - centre[2]));
    }
    this.extent = { rxy: rxy + maxAtom, hz: hz + maxAtom };
    // Points that must stay in frame for a fixed view: cell corners and every displayed atom.
    this.fitPoints = [];
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) {
      const q = fracToCart([x, y, z], m);
      this.fitPoints.push([q[0] - centre[0], q[1] - centre[1], q[2] - centre[2], 0]);
    }
    for (const atom of trace.atoms) {
      for (const f of periodicImages(atom.frac)) {
        const q = fracToCart(f, m);
        this.fitPoints.push([q[0] - centre[0], q[1] - centre[1], q[2] - centre[2], atomDisplayRadius(atom.element)]);
      }
    }
    this.fitCamera();
  }

  pool(role, kind, capacity) {
    const T = this.T;
    let entry = this.pools[role];
    if (!entry || entry.capacity < capacity) {
      if (entry) { this.content.remove(entry.mesh); }
      const geometry = kind === 'cyl' ? this.unitCylinder : this.unitSphere;
      const material = this.mats[role] ?? this.mats.region;
      const mesh = new T.InstancedMesh(geometry, material, Math.max(capacity, 8));
      mesh.frustumCulled = false;
      mesh.renderOrder = material.transparent ? 2 : 1;
      this.content.add(mesh);
      entry = { mesh, capacity: Math.max(capacity, 8) };
      this.pools[role] = entry;
    }
    return entry.mesh;
  }

  setCylinder(mesh, i, a, b, radius) {
    writeCylinder(this.T, mesh, i, a, b, radius);
  }

  setSphere(mesh, i, p, radius) {
    writeSphere(this.T, mesh, i, p, radius);
  }

  patchMesh(i) {
    const T = this.T;
    this.patches = this.patches ?? [];
    if (!this.patches[i]) {
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(8 * 3), 3));
      const mesh = new T.Mesh(geometry, this.mats.patch);
      mesh.renderOrder = 3;
      mesh.frustumCulled = false;
      this.content.add(mesh);
      this.patches[i] = mesh;
    }
    return this.patches[i];
  }

  /**
   * Declarative frame: { matrix, cell, atoms: [{element, frac, scale}], lines: [{from, to, role, width}],
   * polys: [{corners, box}], dots: [{frac, radius}], labels: [{text, frac}] }. Coordinates are fractional.
   */
  setDisplay(display) {
    this.display = display;
    this.applyDisplay();
    this.requestRender();
  }

  applyDisplay() {
    const d = this.display;
    if (!d || !this.trace) return;
    const m = d.matrix;
    const R = this.boundRadius;
    const cart = (f) => fracToCart(f, m);
    const centre = cellCenterCart(m);
    this.content.position.set(-centre[0], -centre[1], -centre[2]);

    const cell = this.pool('cell', 'cyl', 12);
    const edges = d.cell === false ? [] : cellEdgesFrac();
    edges.forEach(([a, b], i) => this.setCylinder(cell, i, cart(a), cart(b), R * 0.0042));
    cell.count = edges.length;
    cell.material.opacity = this.theme.cellOpacity * (d.cellOpacity ?? 1);
    cell.instanceMatrix.needsUpdate = true;

    const perElement = new Map();
    for (const atom of d.atoms ?? []) {
      if (!(atom.scale > 0.001)) continue;
      if (!perElement.has(atom.element)) perElement.set(atom.element, []);
      perElement.get(atom.element).push(atom);
    }
    for (const [element, { mesh, radius }] of this.atomMeshes) {
      const list = perElement.get(element) ?? [];
      const n = Math.min(list.length, mesh.instanceMatrix.count);
      for (let i = 0; i < n; i += 1) this.setSphere(mesh, i, cart(list[i].frac), radius * list[i].scale);
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }

    const byRole = { region: [], halo: [], manifold: [] };
    const ticks = [];
    for (const line of d.lines ?? []) {
      const role = line.role ?? 'region';
      const w = (line.width ?? 1) * (line.opacity ?? 1);
      if (role === 'region') {
        byRole.region.push([line.from, line.to, R * 0.012 * w]);
        byRole.halo.push([line.from, line.to, R * 0.032 * w]);
        ticks.push(line.from, line.to);
      } else {
        byRole.manifold.push([line.from, line.to, R * 0.0055 * w]);
      }
    }
    for (const [role, items] of Object.entries(byRole)) {
      const mesh = this.pool(role, 'cyl', items.length);
      items.forEach(([a, b, r], i) => this.setCylinder(mesh, i, cart(a), cart(b), r));
      mesh.count = items.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
    // Interval ends as gates: thin discs across the line that close in on the atom level by
    // level, so the region stays readable even when it is smaller than the atom itself.
    const gates = this.pool('gate', 'cyl', ticks.length);
    const gateRadius = Math.max(this.maxAtomRadius * 1.25, R * 0.07);
    for (let i = 0; i + 1 < ticks.length; i += 2) {
      const a = cart(ticks[i]);
      const b = cart(ticks[i + 1]);
      const dir = b.map((x, k) => x - a[k]);
      const len = Math.hypot(...dir) || 1;
      const u = dir.map((x) => (x / len) * R * 0.0025);
      this.setCylinder(gates, i, a.map((x, k) => x - u[k]), a.map((x, k) => x + u[k]), gateRadius);
      this.setCylinder(gates, i + 1, b.map((x, k) => x - u[k]), b.map((x, k) => x + u[k]), gateRadius);
    }
    gates.count = ticks.length;
    gates.instanceMatrix.needsUpdate = true;

    const dots = d.dots ?? [];
    const probe = this.pool('probe', 'sphere', dots.length);
    dots.forEach((dot, i) => this.setSphere(probe, i, cart(dot.frac), R * (dot.radius ?? 0.012)));
    probe.count = dots.length;
    probe.instanceMatrix.needsUpdate = true;
    this.mats.probe.opacity = d.dotOpacity ?? 0.9;

    const polys = d.polys ?? [];
    (this.patches ?? []).forEach((mesh, i) => { mesh.visible = i < polys.length; });
    polys.forEach((poly, i) => {
      const mesh = this.patchMesh(i);
      const pts = poly.corners.map(cart);
      const attr = mesh.geometry.getAttribute('position');
      const index = poly.box ? BOX_FACES : polyFan(pts.length);
      pts.forEach((p, k) => attr.setXYZ(k, p[0], p[1], p[2]));
      attr.needsUpdate = true;
      mesh.geometry.setIndex(index);
      mesh.geometry.computeBoundingSphere();
      mesh.material.opacity = poly.opacity ?? 0.5;
    });

    this.labels = d.labels ?? [];
  }

  updateLabels() {
    if (!this.overlay) return;
    const labels = this.labels ?? [];
    const m = this.display?.matrix;
    while (this.overlay.children.length < labels.length) {
      const span = document.createElement('span');
      span.className = 'crystal-label';
      this.overlay.appendChild(span);
    }
    [...this.overlay.children].forEach((span, i) => {
      const label = labels[i];
      if (!label || !m) { span.hidden = true; return; }
      const v = scratchFor(this.T).label.fromArray(fracToCart(label.frac, m));
      this.content.localToWorld(v);
      v.project(this.camera);
      const x = (v.x * 0.5 + 0.5) * this.container.clientWidth;
      const y = (-v.y * 0.5 + 0.5) * this.container.clientHeight;
      span.hidden = false;
      if (span.textContent !== label.text) span.textContent = label.text;
      span.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      span.style.opacity = String(label.opacity ?? 1);
    });
  }

  /** Renders now and returns the canvas as a data URL (used to export posters). */
  snapshot(type = 'image/webp', quality = 0.92) {
    this.applyRotation();
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL(type, quality);
  }
}

const BOX_FACES = [
  0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1,
  2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3,
];

function polyFan(n) {
  const out = [];
  for (let k = 1; k + 1 < n; k += 1) out.push(0, k, k + 1);
  return out;
}

/** The finished crystal: every atom with its periodic images inside the closed cell. */
export { finalDisplay } from '../lib/scene-state.js';
