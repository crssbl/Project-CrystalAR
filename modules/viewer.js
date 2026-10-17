import * as THREE from '../vendor/three/three.module.min.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';

let viewerSequence = 0;
const HOME_DIRECTION = new THREE.Vector3(1.12, 0.76, 1.42).normalize();
const ELEMENT_RADII = {
  H: 0.31, Li: 1.28, Be: 0.96, B: 0.84, C: 0.76, N: 0.71, O: 0.66,
  F: 0.57, Na: 1.66, Mg: 1.41, Al: 1.21, Si: 1.11, P: 1.07, S: 1.05,
  Cl: 1.02, K: 2.03, Ca: 1.76, Sc: 1.70, Ti: 1.60, V: 1.53, Cr: 1.39,
  Mn: 1.39, Fe: 1.32, Co: 1.26, Ni: 1.24, Cu: 1.32, Zn: 1.22,
  Ga: 1.22, Ge: 1.20, As: 1.19, Se: 1.20, Br: 1.20, Rb: 2.20,
  Sr: 1.95, Y: 1.90, Zr: 1.75, Nb: 1.64, Mo: 1.54, Ru: 1.46,
  Rh: 1.42, Pd: 1.39, Ag: 1.45, Cd: 1.44, In: 1.42, Sn: 1.39,
  Sb: 1.39, Te: 1.38, I: 1.39, Cs: 2.44, Ba: 2.15, La: 2.07,
  Ce: 2.04, W: 1.62, Pt: 1.36, Au: 1.36, Pb: 1.46, Bi: 1.48,
};

function finiteVector(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function cartesian(frac, lattice) {
  return [0, 1, 2].map(axis => frac.reduce((sum, x, row) => sum + x * lattice[row][axis], 0));
}

function cellVertices(lattice) {
  const points = [];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
    points.push(new THREE.Vector3(...cartesian([i, j, k], lattice)));
  }
  return points;
}

function sourceAtoms(structure) {
  return (structure.atoms || []).map(atom => ({
    ...atom,
    cart: finiteVector(atom.cart) ? atom.cart : cartesian(atom.frac, structure.lattice),
  }));
}

function clearGeometry(group) {
  const materials = new Set();
  const geometries = new Set();
  group.traverse(object => {
    if (object.geometry && !object.userData.sharedGeometry) geometries.add(object.geometry);
    if (object.material) {
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) materials.add(material);
    }
    if (object.isInstancedMesh) object.dispose();
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  group.clear();
}

/**
 * Local, offline crystal renderer. All positions come from the supplied structure;
 * periodic images are display copies and never change the source atom count.
 * Sphere radii are illustrative. Sticks use the supplied geometric contacts;
 * they do not imply chemical bond orders or independently inferred connectivity.
 */
export async function createCrystalViewer(container, {
  interactive = true, compact = false, onReady,
} = {}) {
  if (!(container instanceof HTMLElement)) throw new TypeError('A viewer container is required.');
  const instanceId = `crystal-viewer-${++viewerSequence}`;
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let destroyed = false;
  let sample = null;
  let structure = null;
  let cellVisible = true;
  let periodic = false;
  let requestedAutoRotate = !interactive;
  let visible = true;
  let frame = null;
  let pendingPaints = 0;
  let renderer = null;
  let controls = null;
  let webglAvailable = true;
  let frameRadius = 1;
  let baseAtoms = [];
  let displayedCount = 0;
  let contactCount = 0;
  let representation = 'spheres';
  let atomScale = 1;
  let bondScale = 1;
  let theme = 'light';
  let projection = 'perspective';
  let aspect = 1;
  let orthographicHalfHeight = 1;
  const THEMES = { light: '#f2f7f5', dark: '#12242b' };
  const REPRESENTATIONS = new Set(['spheres', 'ball-and-stick', 'sticks', 'space-filling']);

  container.classList.add('crystal-viewer');
  container.querySelectorAll('.viewer-loading').forEach(placeholder => placeholder.remove());
  container.classList.toggle('crystal-viewer--compact', compact);
  container.dataset.viewerState = 'loading';
  container.dataset.projection = projection;
  container.dataset.representation = representation;
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', interactive ? 'Interactive three-dimensional crystal structure' : 'Three-dimensional crystal structure');
  if (interactive) container.tabIndex = 0;

  const description = document.createElement('p');
  description.id = `${instanceId}-description`;
  description.className = 'viewer-sr-only';
  description.textContent = interactive
    ? 'Drag to rotate. Scroll or pinch to zoom. Use arrow keys to rotate, plus and minus to zoom, and 0 or Home to reset the view. Atom sizes are illustrative.'
    : 'A source-derived three-dimensional crystal. Atom sizes are illustrative.';
  container.setAttribute('aria-describedby', description.id);
  container.append(description);

  const status = document.createElement('span');
  status.className = 'viewer-sr-only';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  container.append(status);

  const fallback = document.createElement('img');
  fallback.className = 'viewer-fallback';
  fallback.hidden = true;
  fallback.decoding = 'async';
  container.append(fallback);

  let hint = null;
  if (interactive && !compact && !container.parentElement?.querySelector('.interaction-hint')) {
    hint = document.createElement('span');
    hint.className = 'viewer-interaction-hint';
    hint.setAttribute('aria-hidden', 'true');
    hint.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8 8V5a2 2 0 0 1 4 0v6-2a2 2 0 0 1 4 0v2-1a2 2 0 0 1 4 0v5c0 4-3 7-7 7h-1c-2 0-4-1-5-3l-4-6a2 2 0 0 1 3-2l2 2V8Z"/></svg><span>Drag to explore · Scroll to zoom</span>';
    container.append(hint);
  }

  const scene = new THREE.Scene();
  const perspectiveCamera = new THREE.PerspectiveCamera(34, 1, 0.01, 1000);
  const orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
  let camera = perspectiveCamera;
  const atomGroup = new THREE.Group();
  const contactGroup = new THREE.Group();
  const cellGroup = new THREE.Group();
  scene.add(atomGroup, contactGroup, cellGroup);
  const sphereGeometry = new THREE.SphereGeometry(1, compact ? 32 : 40, compact ? 24 : 32);
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, compact ? 16 : 24, 1, false);
  const target = new THREE.Vector3();

  // A small, local studio environment supplies broad reflections without any
  // downloaded textures. The reflection lights never encode scientific data.
  const studioCanvas = document.createElement('canvas');
  studioCanvas.width = 256;
  studioCanvas.height = 128;
  const studioContext = studioCanvas.getContext('2d');
  let studioEnvironment = null;
  if (studioContext) {
    studioContext.fillStyle = '#607177';
    studioContext.fillRect(0, 0, 256, 128);
    for (const [x, y, radius, opacity] of [[62, 30, 54, 1], [182, 45, 38, 0.9], [120, 112, 46, 0.45]]) {
      const glow = studioContext.createRadialGradient(x, y, 2, x, y, radius);
      glow.addColorStop(0, `rgba(255,255,255,${opacity})`);
      glow.addColorStop(0.4, `rgba(242,255,255,${opacity * 0.72})`);
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      studioContext.fillStyle = glow;
      studioContext.fillRect(0, 0, 256, 128);
    }
    studioEnvironment = new THREE.CanvasTexture(studioCanvas);
    studioEnvironment.mapping = THREE.EquirectangularReflectionMapping;
    studioEnvironment.colorSpace = THREE.SRGBColorSpace;
    scene.environment = studioEnvironment;
    scene.environmentIntensity = 0.8;
  }
  const ambientLight = new THREE.HemisphereLight(0xf3ffff, 0x6b827d, 1.65);
  scene.add(ambientLight);
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
  keyLight.position.set(-3, 6, 5);
  scene.add(keyLight);
  const edgeLight = new THREE.DirectionalLight(0xb7f1ee, 2.0);
  edgeLight.position.set(5, 1, -4);
  scene.add(edgeLight);
  const fillLight = new THREE.DirectionalLight(0xffedd7, 0.75);
  fillLight.position.set(-4, -2, -2);
  scene.add(fillLight);

  function surfaceMaterial(color, isContact = false) {
    return new THREE.MeshPhysicalMaterial({
      color,
      metalness: isContact ? 0.22 : 0.12,
      roughness: representation === 'space-filling' ? 0.32 : 0.24,
      clearcoat: 0.7,
      clearcoatRoughness: 0.22,
      envMapIntensity: theme === 'dark' ? 1.15 : 0.8,
    });
  }

  function applyTheme() {
    container.dataset.viewerTheme = theme;
    // Keep the canvas transparent over the page's studio gradient. Exporting
    // composites the same model onto an opaque theme-colored background.
    scene.background = null;
    ambientLight.intensity = theme === 'dark' ? 1.25 : 1.65;
    edgeLight.intensity = theme === 'dark' ? 2.6 : 2;
    for (const group of [atomGroup, contactGroup]) {
      group.traverse(object => {
        if (object.material) object.material.envMapIntensity = theme === 'dark' ? 1.15 : 0.8;
      });
    }
    cellGroup.traverse(object => {
      if (!object.material) return;
      object.material.color.set(theme === 'dark' ? 0x70c5c9 : 0x278d91);
      object.material.opacity = theme === 'dark' ? 0.56 : 0.43;
    });
    requestRender();
  }

  function showFallback(reason = '3D rendering is unavailable. A static view is shown.') {
    webglAvailable = false;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (renderer) renderer.domElement.hidden = true;
    if (sample?.thumbnailPath) {
      fallback.src = sample.thumbnailPath;
      fallback.alt = `Static view of ${sample.formula || 'the selected crystal'}, space group ${sample.spaceGroup?.symbol || sample.spaceGroup?.number || 'as reported in the source'}.`;
      fallback.hidden = false;
    }
    if (hint) hint.hidden = true;
    container.dataset.viewerState = 'fallback';
    status.textContent = reason;
  }

  function shouldRotate() {
    return requestedAutoRotate && !motionPreference.matches && visible && !document.hidden;
  }

  function scheduleFrame() {
    if (destroyed || !webglAvailable || !renderer || !visible || document.hidden || frame !== null) return;
    frame = requestAnimationFrame(render);
  }

  function requestRender() {
    // A second paint lets the browser commit a resized or newly visible canvas
    // even when reduced motion means there will be no continuing animation.
    pendingPaints = Math.max(pendingPaints, 2);
    scheduleFrame();
  }

  function render() {
    frame = null;
    if (destroyed || !webglAvailable || !visible || document.hidden) return;
    controls.autoRotate = shouldRotate();
    const moving = controls.update();
    renderer.render(scene, camera);
    pendingPaints = Math.max(0, pendingPaints - 1);
    if (moving || controls.autoRotate || pendingPaints > 0) scheduleFrame();
  }

  function updateOrthographicFrustum() {
    orthographicCamera.left = -orthographicHalfHeight * aspect;
    orthographicCamera.right = orthographicHalfHeight * aspect;
    orthographicCamera.top = orthographicHalfHeight;
    orthographicCamera.bottom = -orthographicHalfHeight;
    orthographicCamera.updateProjectionMatrix();
  }

  function resize() {
    if (!renderer || destroyed || !webglAvailable) return;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    const previousAspect = aspect;
    aspect = width / height;
    perspectiveCamera.aspect = aspect;
    perspectiveCamera.updateProjectionMatrix();
    updateOrthographicFrustum();
    if (structure && Math.abs(previousAspect - aspect) > 0.01) reset();
    requestRender();
  }

  function reset() {
    if (destroyed || !structure || !controls) return;
    const halfFov = THREE.MathUtils.degToRad(perspectiveCamera.fov / 2);
    const distance = frameRadius / Math.sin(Math.min(halfFov, Math.atan(Math.tan(halfFov) * Math.max(aspect, 0.45)))) * 1.12;
    camera.position.copy(target).addScaledVector(HOME_DIRECTION, distance);
    camera.near = Math.max(0.005, frameRadius * 0.005);
    camera.far = Math.max(100, distance + frameRadius * 12);
    camera.zoom = 1;
    if (camera.isOrthographicCamera) {
      orthographicHalfHeight = distance * Math.tan(halfFov);
      updateOrthographicFrustum();
    }
    camera.updateProjectionMatrix();
    controls.target.copy(target);
    controls.minDistance = frameRadius * 1.12;
    controls.maxDistance = frameRadius * 14;
    controls.minZoom = 0.3;
    controls.maxZoom = 5;
    controls.update();
    controls.saveState();
    requestRender();
  }

  function setProjection(value) {
    if (!['perspective', 'orthographic'].includes(value) || value === projection) return;
    const nextCamera = value === 'orthographic' ? orthographicCamera : perspectiveCamera;
    nextCamera.position.copy(camera.position);
    nextCamera.quaternion.copy(camera.quaternion);
    nextCamera.up.copy(camera.up);
    nextCamera.near = camera.near;
    nextCamera.far = camera.far;
    const offset = camera.position.clone().sub(controls?.target || target);
    const halfFov = THREE.MathUtils.degToRad(perspectiveCamera.fov / 2);
    if (value === 'orthographic') {
      orthographicHalfHeight = Math.max(0.01, offset.length() * Math.tan(halfFov));
      nextCamera.zoom = 1;
      updateOrthographicFrustum();
    } else if (offset.lengthSq() > 0) {
      // Match the scale of the current orthographic view at the orbit target.
      const distance = orthographicHalfHeight / orthographicCamera.zoom / Math.tan(halfFov);
      nextCamera.position.copy(controls?.target || target).add(offset.normalize().multiplyScalar(distance));
    }
    camera = nextCamera;
    projection = value;
    camera.updateProjectionMatrix();
    if (controls) {
      controls.object = camera;
      controls.update();
    }
    container.dataset.projection = projection;
    updateDescription();
    requestRender();
  }

  function updateDescription() {
    if (!sample || !structure) return;
    const formula = sample.formula || 'Crystal';
    const group = sample.spaceGroup?.symbol || sample.spaceGroup?.number || 'not specified';
    const count = baseAtoms.length;
    const copies = Math.max(0, displayedCount - count);
    status.textContent = `${formula}. Space group ${group}. ${count} atoms in the source unit cell.${periodic && copies ? ` ${copies} additional periodic display copies.` : ''} Unit-cell edges ${cellVisible ? 'shown' : 'hidden'}. ${representation.replaceAll('-', ' ')} representation, ${projection} projection.${contactGroup.visible ? ` ${contactCount} geometric near-neighbor contacts shown; these do not imply chemical bond orders.` : ''}`;
    container.setAttribute('aria-label', `${interactive ? 'Interactive ' : ''}${formula} crystal, ${count} source atoms, space group ${group}`);
  }

  function rebuildAtoms({ fit = false } = {}) {
    if (!structure || !webglAvailable) return;
    clearGeometry(atomGroup);
    clearGeometry(contactGroup);
    const atoms = periodic && structure.displayAtoms?.length ? structure.displayAtoms : baseAtoms;
    const validAtoms = atoms.filter(atom => finiteVector(atom.cart));
    displayedCount = validAtoms.length;
    let minimumDistance = Infinity;
    // This separation cap applies only to the illustrative small-sphere styles.
    for (let i = 0; i < Math.min(baseAtoms.length, 250); i++) {
      for (let j = i + 1; j < Math.min(baseAtoms.length, 250); j++) {
        const distance = new THREE.Vector3(...baseAtoms[i].cart).distanceTo(new THREE.Vector3(...baseAtoms[j].cart));
        if (distance > 0.1) minimumDistance = Math.min(minimumDistance, distance);
      }
    }
    const contactRadius = 0.075 * bondScale;
    const colorFor = atom => /^#[a-f\d]{6}$/i.test(atom.color) ? atom.color : '#31979c';
    const groups = new Map();
    for (const atom of validAtoms) {
      const color = colorFor(atom);
      const illustrativeRadius = Math.min(0.46 * Math.pow(ELEMENT_RADII[atom.element] || 1.2, 0.45), minimumDistance * 0.33);
      let radius = illustrativeRadius * atomScale;
      if (representation === 'ball-and-stick') radius *= 0.68;
      if (representation === 'sticks') radius = contactRadius * 1.16;
      if (representation === 'space-filling') radius = (ELEMENT_RADII[atom.element] || 1.2) * 0.88 * atomScale;
      const key = `${atom.element}:${color}:${radius.toFixed(4)}`;
      if (!groups.has(key)) groups.set(key, { color, radius, atoms: [] });
      groups.get(key).atoms.push(atom);
    }
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const orientation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (const entry of groups.values()) {
      const mesh = new THREE.InstancedMesh(sphereGeometry, surfaceMaterial(entry.color), entry.atoms.length);
      mesh.userData.sharedGeometry = true;
      for (let i = 0; i < entry.atoms.length; i++) {
        position.fromArray(entry.atoms[i].cart);
        scale.setScalar(entry.radius);
        matrix.compose(position, orientation, scale);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      atomGroup.add(mesh);
    }

    // Each supplied segment must terminate on two currently displayed atoms.
    // This removes boundary contacts when periodic copies are hidden, rather
    // than drawing dangling sticks or silently generating new connectivity.
    const positionKey = xyz => xyz.map(x => Math.round(x * 100000)).join(',');
    const visibleAtomAt = xyz => validAtoms.find(atom => atom.cart.every((x, axis) => Math.abs(x - xyz[axis]) < 0.00001));
    const uniqueContacts = new Set();
    const halvesByColor = new Map();
    contactCount = 0;
    for (const contact of structure.bonds || []) {
      if (!finiteVector(contact.start) || !finiteVector(contact.end)) continue;
      const startAtom = visibleAtomAt(contact.start);
      const endAtom = visibleAtomAt(contact.end);
      if (!startAtom || !endAtom) continue;
      const key = [positionKey(startAtom.cart), positionKey(endAtom.cart)].sort().join('|');
      if (uniqueContacts.has(key)) continue;
      const start = new THREE.Vector3(...startAtom.cart);
      const end = new THREE.Vector3(...endAtom.cart);
      if (start.distanceToSquared(end) < 1e-10) continue;
      uniqueContacts.add(key);
      contactCount++;
      const middle = start.clone().lerp(end, 0.5);
      for (const [from, to, atom] of [[start, middle, startAtom], [middle, end, endAtom]]) {
        const color = colorFor(atom);
        if (!halvesByColor.has(color)) halvesByColor.set(color, []);
        halvesByColor.get(color).push({ from, to });
      }
    }
    const up = new THREE.Vector3(0, 1, 0);
    const direction = new THREE.Vector3();
    for (const [color, halves] of halvesByColor) {
      const mesh = new THREE.InstancedMesh(cylinderGeometry, surfaceMaterial(color, true), halves.length);
      mesh.userData.sharedGeometry = true;
      for (let i = 0; i < halves.length; i++) {
        const { from, to } = halves[i];
        direction.copy(to).sub(from);
        const length = direction.length();
        position.copy(from).lerp(to, 0.5);
        orientation.setFromUnitVectors(up, direction.normalize());
        scale.set(contactRadius, length, contactRadius);
        matrix.compose(position, orientation, scale);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      contactGroup.add(mesh);
    }
    contactGroup.visible = representation === 'ball-and-stick' || representation === 'sticks';
    container.dataset.representation = representation;
    container.dataset.visibleAtomCount = String(displayedCount);
    container.dataset.contactCount = String(contactCount);
    if (fit) {
      const corners = cellVertices(structure.lattice);
      const bounds = new THREE.Box3().setFromPoints([...corners, ...validAtoms.map(atom => new THREE.Vector3(...atom.cart))]);
      bounds.getCenter(target);
      // Reserve the same framing margin across modes so changing a display
      // option preserves the user's orientation and scale.
      frameRadius = Math.max(1, bounds.getBoundingSphere(new THREE.Sphere()).radius + 1.15);
      reset();
    }
    updateDescription();
    requestRender();
  }

  function rebuildCell() {
    clearGeometry(cellGroup);
    if (!structure || !webglAvailable) return;
    const points = cellVertices(structure.lattice);
    const vertices = [];
    for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) {
      const j = i ^ bit;
      if (i < j) vertices.push(points[i], points[j]);
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(vertices);
    const material = new THREE.LineBasicMaterial({ color: theme === 'dark' ? 0x70c5c9 : 0x278d91, transparent: true, opacity: theme === 'dark' ? 0.56 : 0.43, depthWrite: false });
    const edges = new THREE.LineSegments(geometry, material);
    edges.renderOrder = 1;
    cellGroup.add(edges);
    cellGroup.visible = cellVisible;
  }

  function onKeyDown(event) {
    if (!interactive || event.altKey || event.ctrlKey || event.metaKey || event.target !== container || !controls) return;
    const offset = camera.position.clone().sub(controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    const angle = event.shiftKey ? 0.22 : 0.11;
    let handled = true;
    switch (event.key) {
      case 'ArrowLeft': spherical.theta -= angle; break;
      case 'ArrowRight': spherical.theta += angle; break;
      case 'ArrowUp': spherical.phi -= angle; break;
      case 'ArrowDown': spherical.phi += angle; break;
      case '+': case '=':
        if (camera.isOrthographicCamera) camera.zoom = Math.min(controls.maxZoom, camera.zoom / 0.88);
        else spherical.radius *= 0.88;
        break;
      case '-': case '_':
        if (camera.isOrthographicCamera) camera.zoom = Math.max(controls.minZoom, camera.zoom / 1.14);
        else spherical.radius *= 1.14;
        break;
      case 'Home': case '0': reset(); event.preventDefault(); return;
      default: handled = false;
    }
    if (!handled) return;
    event.preventDefault();
    spherical.makeSafe();
    spherical.radius = THREE.MathUtils.clamp(spherical.radius, controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    camera.updateProjectionMatrix();
    controls.update();
    requestRender();
  }

  function onVisibilityChange() {
    if (document.hidden && frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    } else requestRender();
  }
  function onMotionPreferenceChange() { requestRender(); }
  function onContextLost(event) {
    event.preventDefault();
    showFallback('The 3D view is unavailable. A source-derived static image is shown.');
  }
  function onContextRestored() {
    if (destroyed) return;
    webglAvailable = true;
    fallback.hidden = true;
    renderer.domElement.hidden = false;
    if (hint) hint.hidden = false;
    container.dataset.viewerState = 'ready';
    rebuildCell();
    rebuildAtoms();
    applyTheme();
    resize();
  }

  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true, alpha: true, powerPreference: 'default',
      // The static/reduced-motion view must survive browser compositor changes
      // after a resize or a trip outside the viewport.
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = 'viewer-canvas';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.setAttribute('tabindex', '-1');
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);
    container.prepend(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enabled = interactive;
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.enablePan = false;
    controls.rotateSpeed = 0.72;
    controls.zoomSpeed = 0.75;
    controls.autoRotateSpeed = 0.42;
    controls.addEventListener('change', requestRender);
    applyTheme();
    resize();
  } catch (error) {
    showFallback();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  const intersectionObserver = new IntersectionObserver(entries => {
    visible = entries[0]?.isIntersecting ?? true;
    if (!visible && frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    } else requestRender();
  }, { rootMargin: '100px' });
  intersectionObserver.observe(container);
  container.addEventListener('keydown', onKeyDown);
  document.addEventListener('visibilitychange', onVisibilityChange);
  motionPreference.addEventListener('change', onMotionPreferenceChange);

  const api = {
    async load(nextSample, nextStructure) {
      if (destroyed) return;
      if (!nextStructure || !Array.isArray(nextStructure.lattice) || nextStructure.lattice.length !== 3 || !nextStructure.lattice.every(finiteVector)) {
        throw new TypeError('Crystal structure must contain three finite lattice row vectors.');
      }
      sample = nextSample;
      structure = nextStructure;
      baseAtoms = sourceAtoms(structure);
      if (!baseAtoms.length || baseAtoms.some(atom => !finiteVector(atom.cart))) throw new TypeError('Crystal structure must contain finite atom positions.');
      if (sample?.thumbnailPath) {
        fallback.src = sample.thumbnailPath;
        fallback.alt = `Static crystal view of ${sample.formula || 'the selected sample'}.`;
      }
      if (!webglAvailable) {
        displayedCount = baseAtoms.length;
        showFallback();
        return;
      }
      rebuildCell();
      rebuildAtoms({ fit: true });
      container.dataset.viewerState = 'ready';
      requestRender();
    },
    setCell(value) {
      cellVisible = Boolean(value);
      cellGroup.visible = cellVisible;
      updateDescription();
      requestRender();
    },
    setPeriodic(value) {
      periodic = Boolean(value);
      if (webglAvailable) rebuildAtoms();
      else updateDescription();
    },
    setRepresentation(value) {
      if (!REPRESENTATIONS.has(value) || representation === value) return;
      representation = value;
      rebuildAtoms();
    },
    setAtomScale(value) {
      if (!Number.isFinite(Number(value))) return;
      atomScale = THREE.MathUtils.clamp(Number(value), 0.65, 1.45);
      rebuildAtoms();
    },
    setBondScale(value) {
      if (!Number.isFinite(Number(value))) return;
      bondScale = THREE.MathUtils.clamp(Number(value), 0.6, 1.8);
      rebuildAtoms();
    },
    setTheme(value) {
      if (!Object.hasOwn(THEMES, value)) return;
      theme = value;
      applyTheme();
    },
    setProjection,
    exportImage() {
      if (destroyed || !webglAvailable || !renderer || !structure) return null;
      try {
        renderer.render(scene, camera);
        const image = document.createElement('canvas');
        image.width = renderer.domElement.width;
        image.height = renderer.domElement.height;
        const context = image.getContext('2d');
        if (!context) return null;
        context.fillStyle = THEMES[theme];
        context.fillRect(0, 0, image.width, image.height);
        context.drawImage(renderer.domElement, 0, 0);
        return image.toDataURL('image/png');
      } catch {
        return null;
      }
    },
    reset,
    setAutoRotate(value) {
      requestedAutoRotate = Boolean(value);
      requestRender();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      container.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      motionPreference.removeEventListener('change', onMotionPreferenceChange);
      clearGeometry(atomGroup);
      clearGeometry(contactGroup);
      clearGeometry(cellGroup);
      sphereGeometry.dispose();
      cylinderGeometry.dispose();
      studioEnvironment?.dispose();
      controls?.dispose();
      if (renderer) {
        renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
        renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
        renderer.dispose();
        renderer.domElement.remove();
      }
      description.remove();
      status.remove();
      fallback.remove();
      hint?.remove();
      container.classList.remove('crystal-viewer', 'crystal-viewer--compact');
      for (const name of ['data-viewer-state', 'data-viewer-theme', 'data-representation', 'data-projection', 'data-visible-atom-count', 'data-contact-count']) container.removeAttribute(name);
      container.removeAttribute('aria-label');
      container.removeAttribute('aria-describedby');
      container.removeAttribute('role');
      if (interactive) container.removeAttribute('tabindex');
    },
  };
  onReady?.(api);
  return api;
}
