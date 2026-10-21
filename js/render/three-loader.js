// Loads the vendored three.js build once, on demand.
let threePromise = null;

export function loadThree() {
  if (!threePromise) threePromise = import('../../vendor/three/three.min.js');
  return threePromise;
}

/** True when the browser can create a WebGL2 context (checked once). */
let webgl2 = null;
export function hasWebGL2() {
  if (webgl2 !== null) return webgl2;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    webgl2 = Boolean(gl);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webgl2 = false;
  }
  return webgl2;
}

/** Runs `fn` when the browser is idle (or soon, where requestIdleCallback is missing). */
export function whenIdle(fn, timeout = 1800) {
  if ('requestIdleCallback' in window) return window.requestIdleCallback(fn, { timeout });
  return window.setTimeout(fn, 300);
}
