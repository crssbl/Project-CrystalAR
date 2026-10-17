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
 * Sphere radii are illustrative. No chemical connectivity is inferred.
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

  container.classList.add('crystal-viewer');
  container.querySelectorAll('.viewer-loading').forEach(placeholder => placeholder.remove());
  container.classList.toggle('crystal-viewer--compact', compact);
  container.dataset.viewerState = 'loading';
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
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 1000);
  const atomGroup = new THREE.Group();
  const cellGroup = new THREE.Group();
  scene.add(atomGroup, cellGroup);
  const sphereGeometry = new THREE.SphereGeometry(1, 32, 24);
  const target = new THREE.Vector3();
  scene.add(new THREE.HemisphereLight(0xf7ffff, 0x5f7975, 2.7));
  const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
  keyLight.position.set(-3, 6, 5);
  scene.add(keyLight);
  const edgeLight = new THREE.DirectionalLight(0xb7f1ee, 2.4);
  edgeLight.position.set(5, 1, -4);
  scene.add(edgeLight);
  const fillLight = new THREE.DirectionalLight(0xf4e9d2, 1.1);
  fillLight.position.set(-4, -2, -2);
  scene.add(fillLight);

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

  function resize() {
    if (!renderer || destroyed || !webglAvailable) return;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    const previousAspect = camera.aspect;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (structure && Math.abs(previousAspect - camera.aspect) > 0.01) reset();
    requestRender();
  }

  function reset() {
    if (destroyed || !structure || !controls) return;
    const aspect = Math.max(camera.aspect, 0.45);
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const distance = frameRadius / Math.sin(Math.min(halfFov, Math.atan(Math.tan(halfFov) * aspect))) * 1.12;
    camera.position.copy(target).addScaledVector(HOME_DIRECTION, distance);
    camera.near = Math.max(0.005, frameRadius * 0.005);
    camera.far = Math.max(100, distance + frameRadius * 12);
    camera.updateProjectionMatrix();
    controls.target.copy(target);
    controls.minDistance = frameRadius * 1.12;
    controls.maxDistance = frameRadius * 14;
    controls.update();
    controls.saveState();
    requestRender();
  }

  function updateDescription() {
    if (!sample || !structure) return;
    const formula = sample.formula || 'Crystal';
    const group = sample.spaceGroup?.symbol || sample.spaceGroup?.number || 'not specified';
    const count = baseAtoms.length;
    const copies = Math.max(0, displayedCount - count);
    status.textContent = `${formula}. Space group ${group}. ${count} atoms in the source unit cell.${periodic && copies ? ` ${copies} additional periodic display copies.` : ''} Unit-cell edges ${cellVisible ? 'shown' : 'hidden'}.`;
    container.setAttribute('aria-label', `${interactive ? 'Interactive ' : ''}${formula} crystal, ${count} source atoms, space group ${group}`);
  }

  function rebuildAtoms() {
    if (!structure || !webglAvailable) return;
    clearGeometry(atomGroup);
    const atoms = periodic && structure.displayAtoms?.length ? structure.displayAtoms : baseAtoms;
    const validAtoms = atoms.filter(atom => finiteVector(atom.cart));
    displayedCount = validAtoms.length;
    let minimumDistance = Infinity;
    // The separation cap is visual only. It prevents large atoms from occluding a whole cell.
    for (let i = 0; i < Math.min(baseAtoms.length, 250); i++) {
      for (let j = i + 1; j < Math.min(baseAtoms.length, 250); j++) {
        const distance = new THREE.Vector3(...baseAtoms[i].cart).distanceTo(new THREE.Vector3(...baseAtoms[j].cart));
        if (distance > 0.1) minimumDistance = Math.min(minimumDistance, distance);
      }
    }
    const groups = new Map();
    for (const atom of validAtoms) {
      const color = /^#[a-f\d]{6}$/i.test(atom.color) ? atom.color : '#31979c';
      const radius = Math.min(0.46 * Math.pow(ELEMENT_RADII[atom.element] || 1.2, 0.45), minimumDistance * 0.33);
      const key = `${atom.element}:${color}:${radius.toFixed(4)}`;
      if (!groups.has(key)) groups.set(key, { color, radius, atoms: [] });
      groups.get(key).atoms.push(atom);
    }
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const orientation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (const entry of groups.values()) {
      const material = new THREE.MeshStandardMaterial({ color: entry.color, metalness: 0.16, roughness: 0.25 });
      const mesh = new THREE.InstancedMesh(sphereGeometry, material, entry.atoms.length);
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
    const corners = cellVertices(structure.lattice);
    const bounds = new THREE.Box3().setFromPoints([...corners, ...validAtoms.map(atom => new THREE.Vector3(...atom.cart))]);
    bounds.getCenter(target);
    frameRadius = Math.max(1, bounds.getBoundingSphere(new THREE.Sphere()).radius + 0.45);
    updateDescription();
    reset();
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
    const material = new THREE.LineBasicMaterial({ color: 0x108f95, transparent: true, opacity: 0.48, depthWrite: false });
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
      case '+': case '=': spherical.radius *= 0.88; break;
      case '-': case '_': spherical.radius *= 1.14; break;
      case 'Home': case '0': reset(); event.preventDefault(); return;
      default: handled = false;
    }
    if (!handled) return;
    event.preventDefault();
    spherical.makeSafe();
    spherical.radius = THREE.MathUtils.clamp(spherical.radius, controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
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
    rebuildAtoms();
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
    renderer.toneMappingExposure = 1.18;
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
      rebuildAtoms();
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
      clearGeometry(cellGroup);
      sphereGeometry.dispose();
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
      container.removeAttribute('data-viewer-state');
      container.removeAttribute('aria-label');
      container.removeAttribute('aria-describedby');
      container.removeAttribute('role');
      if (interactive) container.removeAttribute('tabindex');
    },
  };
  onReady?.(api);
  return api;
}
