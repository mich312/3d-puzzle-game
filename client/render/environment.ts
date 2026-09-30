// Per-world image-based lighting. Renders the world's own procedural sky (in
// ENV_MODE: no stars, lifted void bounce) plus a couple of soft "sky panels"
// into a PMREM cube once per world change, and hands it to scene.environment so
// every MeshStandardMaterial gets ambient diffuse + roughness-correct specular
// from a light field that matches what the player sees. This replaces most of
// the old flat hemisphere/ambient fill.
import * as THREE from 'three';
import { worldPalette } from './theme';
import { makeSkyMaterial } from './sky';

export class WorldEnvironment {
  private pmrem: THREE.PMREMGenerator;
  private target?: THREE.WebGLRenderTarget;

  constructor(private gl: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(gl);
  }

  /** build (or rebuild) the environment for `world`; returns the PMREM texture */
  build(world: string, sunDir: THREE.Vector3): THREE.Texture {
    const p = worldPalette(world);
    const scene = new THREE.Scene();
    const skyMat = makeSkyMaterial(world, { sunDir, detail: 1, envMode: true });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), skyMat);
    sky.renderOrder = -1;   // depthTest off: must draw before the panels
    scene.add(sky);

    // soft area "panels": a broad cool sky-dome light overhead and a faint warm
    // bounce card below — they give PBR surfaces a readable top-lit gradient and
    // a gentle specular sheen without competing with the key light
    const panelMat = (hex: string, k: number) => new THREE.MeshBasicMaterial({
      color: new THREE.Color(hex).multiplyScalar(k), side: THREE.DoubleSide, fog: false, toneMapped: false,
    });
    const top = new THREE.Mesh(new THREE.CircleGeometry(9, 24), panelMat(p.hemiSky, 0.55));
    top.position.set(0, 14, 0); top.rotation.x = Math.PI / 2;
    const bounce = new THREE.Mesh(new THREE.CircleGeometry(12, 24), panelMat(p.hemiGround, p.cloudY !== undefined ? 0.6 : 1.1));
    bounce.position.set(0, -12, 0); bounce.rotation.x = -Math.PI / 2;
    scene.add(top, bounce);

    const rt = this.pmrem.fromScene(scene, 0.02, 0.1, 60);
    this.target?.dispose();
    this.target = rt;

    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    });
    return rt.texture;
  }

  dispose() {
    this.target?.dispose();
    this.pmrem.dispose();
  }
}
