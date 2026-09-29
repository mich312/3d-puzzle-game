// GPU resource cleanup. three.js never frees geometry/material/texture memory on
// scene removal — it has to be released explicitly, or every level transition and
// every rebuilt label leaks GPU buffers.
import * as THREE from 'three';

const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap', 'envMap', 'lightMap'] as const;

/** Materials/textures shared through a cache must never be disposed by one user. */
const shared = new WeakSet<object>();
export function markShared<T extends object>(o: T): T { shared.add(o); return o; }

export function disposeMaterial(m: THREE.Material) {
  if (shared.has(m)) return;
  const rec = m as unknown as Record<string, unknown>;
  for (const k of TEX_KEYS) {
    const t = rec[k];
    if (t instanceof THREE.Texture && !shared.has(t)) t.dispose();
  }
  // shader materials: textures in uniforms
  if (m instanceof THREE.ShaderMaterial) {
    for (const u of Object.values(m.uniforms)) {
      if (u.value instanceof THREE.Texture && !shared.has(u.value)) u.value.dispose();
    }
  }
  m.dispose();
}

/** Recursively dispose every geometry/material/texture under `root` (skipping shared ones). */
export function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry && !shared.has(mesh.geometry)) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach(disposeMaterial);
    else if (mat) disposeMaterial(mat);
  });
}
