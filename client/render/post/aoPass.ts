// Ground-truth ambient occlusion (three's GTAOPass) tuned for this game:
//  - world-space radius sized for human-scale architecture (contact shadows
//    under crates/players, darkening in wall/floor crevices)
//  - optional half-resolution AO buffers (medium tier)
//  - the normal/depth prepass skips transparent / non-depth-writing meshes
//    (portal discs, glass, fake light cones, the reflector overlay), points,
//    lines and sprites — so no dark halos around effects. The hide-list is
//    rebuilt every ~30 frames instead of traversing the whole scene twice a
//    frame like the stock pass does.
//  - the prepass never re-renders the shadow map (stock pass would, doubling
//    shadow cost)
import * as THREE from 'three';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

export type AOPass = GTAOPass;

export function makeAOPass(scene: THREE.Scene, camera: THREE.PerspectiveCamera, w: number, h: number, half: boolean): AOPass {
  const div = half ? 2 : 1;
  const pass = new GTAOPass(scene, camera, Math.max(1, w / div), Math.max(1, h / div));
  pass.updateGtaoMaterial({
    radius: 1.0,
    distanceExponent: 1.4,
    thickness: 1.2,
    scale: 1.5,
    samples: half ? 8 : 16,
    distanceFallOff: 1,
    screenSpaceRadius: false,
  });
  pass.updatePdMaterial({
    lumaPhi: 10, depthPhi: 2, normalPhi: 3,
    radius: half ? 4 : 6, radiusExponent: 1, rings: 2,
    samples: half ? 8 : 16,
  });
  pass.blendIntensity = 1.0;

  const origSetSize = pass.setSize.bind(pass);
  pass.setSize = (width: number, height: number) => origSetSize(Math.max(1, Math.round(width / div)), Math.max(1, Math.round(height / div)));

  let frame = 0;
  const hideList: THREE.Object3D[] = [];
  const hidden: THREE.Object3D[] = [];
  const skip = (o: THREE.Object3D) => {
    const any = o as THREE.Object3D & { isPoints?: boolean; isLine?: boolean; isSprite?: boolean; material?: THREE.Material | THREE.Material[] };
    if (any.isPoints || any.isLine || any.isSprite) return true;
    const m = any.material;
    if (!m) return false;
    const mm = Array.isArray(m) ? m[0] : m;
    return !!mm && (mm.transparent || !mm.depthWrite);
  };
  pass.overrideVisibility = () => {
    if (frame++ % 30 === 0) {
      hideList.length = 0;
      scene.traverse((o) => { if (skip(o)) hideList.push(o); });
    }
    for (const o of hideList) if (o.visible) { o.visible = false; hidden.push(o); }
  };
  pass.restoreVisibility = () => {
    for (const o of hidden) o.visible = true;
    hidden.length = 0;
  };

  const origRender = pass.render.bind(pass);
  pass.render = (renderer, writeBuffer, readBuffer, deltaTime, maskActive) => {
    const auto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    origRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    renderer.shadowMap.autoUpdate = auto;
  };
  return pass;
}
