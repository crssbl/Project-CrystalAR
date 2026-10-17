# Three.js vendored dependency

- Package: `three@0.169.0`
- Upstream: https://github.com/mrdoob/three.js/tree/r169
- Source archive: https://registry.npmjs.org/three/-/three-0.169.0.tgz
- Archive SHA-1: `4a62114988ad9728d73526d1f1de6760c56b4adc`
- License: MIT; full license is in `LICENSE`.

Included files: `build/three.module.min.js` and `examples/jsm/controls/OrbitControls.js`. The only upstream change is rewriting OrbitControls’ bare `three` import to the local `./three.module.min.js` module. No runtime network request is required.
