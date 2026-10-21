// The renderer's per-instance path: instance matrices are written through module-level
// scratch objects, so the frames of the hero loop, the story and the replay allocate nothing
// per atom or segment. Runs on the vendored three.js build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../vendor/three/three.min.js';
import { writeCylinder, writeSphere } from '../../js/render/crystal-view.js';

const fakeMesh = () => ({ matrices: [], setMatrixAt(i, matrix) { this.matrices[i] = matrix.toArray(); } });

function countingThree() {
  const made = { count: 0 };
  class Vector3 extends THREE.Vector3 { constructor(...a) { super(...a); made.count += 1; } }
  class Quaternion extends THREE.Quaternion { constructor(...a) { super(...a); made.count += 1; } }
  class Matrix4 extends THREE.Matrix4 { constructor(...a) { super(...a); made.count += 1; } }
  return { T: { Vector3, Quaternion, Matrix4 }, made };
}

test('writing instances allocates no three.js objects per instance', () => {
  const { T, made } = countingThree();
  const mesh = fakeMesh();
  writeCylinder(T, mesh, 0, [0, 0, 0], [0, 0, 1], 0.1);
  writeSphere(T, mesh, 0, [0, 0, 0], 0.1);
  const scratch = made.count;
  assert.ok(scratch > 0 && scratch <= 12, `one set of scratch objects, got ${scratch}`);
  for (let i = 0; i < 2000; i += 1) {
    writeCylinder(T, mesh, i, [i, 0, 0], [i, 1, 2], 0.2);
    writeSphere(T, mesh, i, [1, 2, i], 0.5);
  }
  assert.equal(made.count, scratch);
});

test('instance matrices equal a freshly composed cylinder and sphere', () => {
  const close = (got, want) => got.forEach((x, k) => assert.ok(Math.abs(x - want[k]) < 1e-12, `${k}: ${x} != ${want[k]}`));
  const mesh = fakeMesh();
  const a = [0.3, -1.2, 2.5];
  const b = [1.7, 0.4, -0.6];
  const r = 0.07;
  writeCylinder(THREE, mesh, 0, a, b, r);
  const from = new THREE.Vector3(...a);
  const dir = new THREE.Vector3(...b).sub(from);
  const len = dir.length();
  const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().divideScalar(len));
  close(mesh.matrices[0], new THREE.Matrix4().compose(from.clone().addScaledVector(dir, 0.5), turn, new THREE.Vector3(r, len, r)).toArray());
  writeSphere(THREE, mesh, 1, a, r);
  close(mesh.matrices[1], new THREE.Matrix4().compose(new THREE.Vector3(...a), new THREE.Quaternion(), new THREE.Vector3(r, r, r)).toArray());
  // A degenerate segment stays finite.
  writeCylinder(THREE, mesh, 2, a, a, r);
  assert.ok(mesh.matrices[2].every(Number.isFinite));
});
