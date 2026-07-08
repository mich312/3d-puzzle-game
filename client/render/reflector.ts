// Planar mirror floor — a true reflection render (Three's Reflector) on hero
// surfaces (Nexus plaza, Observatory dome). This is the "fake ray tracing":
// a second scene render from the mirrored camera, blended over the textured
// floor so the grain still reads. One active plane at a time (it costs a full
// extra scene render), gated by the quality tier.
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

export interface ReflectiveFloor {
  mesh: Reflector;
  dispose(): void;
}

/**
 * @param shape 'circle' for the round plaza, 'plane' for rectangular halls
 * @param opacity how strongly the mirror shows through the floor grain
 */
export function makeReflectiveFloor(
  scene: THREE.Scene, y: number, size: number, res: number,
  tint: string, shape: 'circle' | 'plane', opacity: number,
): ReflectiveFloor {
  const geo = shape === 'circle'
    ? new THREE.CircleGeometry(size / 2, 48)
    : new THREE.PlaneGeometry(size, size);
  const mirror = new Reflector(geo, {
    color: new THREE.Color(tint),
    textureWidth: res,
    textureHeight: res,
    clipBias: 0.003,
  });
  mirror.rotation.x = -Math.PI / 2;
  mirror.position.y = y + 0.02;
  mirror.renderOrder = 1;

  // patch the Reflector's material so the reflection blends (alpha) over the
  // floor beneath instead of replacing it — keeps the PBR grain visible.
  const mat = mirror.material as THREE.ShaderMaterial;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.uniforms.uOpacity = { value: opacity };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOpacity = mat.uniforms.uOpacity;
    shader.fragmentShader = 'uniform float uOpacity;\n' + shader.fragmentShader;
    // multiply final alpha; works whether the shader ends in gl_FragColor or the
    // three r150+ `#include <opaque_fragment>`/`gl_FragColor` form
    shader.fragmentShader = shader.fragmentShader.replace(
      /gl_FragColor\s*=\s*vec4\(([^;]+)\);/,
      'gl_FragColor = vec4($1); gl_FragColor.a *= uOpacity;');
  };
  mat.needsUpdate = true;

  scene.add(mirror);
  return {
    mesh: mirror,
    dispose() {
      scene.remove(mirror);
      mirror.dispose();
      geo.dispose();
    },
  };
}
