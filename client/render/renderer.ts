// Renderer behind a thin interface (spec §10): WebGL2 + PBR + bloom post stack.
// WebGPU-ready: swap the factory here when three's WebGPURenderer path is adopted.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { WORLD_PALETTES } from '../../shared/palette';
import { makeSky } from './sky';

export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  private gl: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private hemi: THREE.HemisphereLight;
  private key: THREE.DirectionalLight;
  private ambient: THREE.AmbientLight;
  private sky?: THREE.Mesh;
  reduceMotion = false;

  constructor(container: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 300);
    this.gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.gl.setSize(innerWidth, innerHeight);
    this.gl.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas = this.gl.domElement;
    container.appendChild(this.canvas);

    this.hemi = new THREE.HemisphereLight('#6b5b95', '#3a3550', 0.55);
    this.key = new THREE.DirectionalLight('#cfc4ff', 1.1);
    this.key.position.set(18, 30, 12);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.camera.left = -60; this.key.shadow.camera.right = 60;
    this.key.shadow.camera.top = 60; this.key.shadow.camera.bottom = -60;
    this.key.shadow.camera.far = 120;
    this.key.shadow.bias = -0.0004;
    this.ambient = new THREE.AmbientLight('#ffffff', 0.1);
    this.scene.add(this.hemi, this.key, this.key.target, this.ambient);

    this.composer = new EffectComposer(this.gl);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.4, 0.68);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.gl.setSize(innerWidth, innerHeight);
      this.composer.setSize(innerWidth, innerHeight);
    });
  }

  setWorld(world: string) {
    const p = WORLD_PALETTES[world] ?? WORLD_PALETTES.nexus;
    this.scene.background = new THREE.Color(p.sky);
    this.scene.fog = new THREE.FogExp2(p.fog, p.fogDensity);
    if (this.sky) this.scene.remove(this.sky);
    this.sky = makeSky(world);
    this.scene.add(this.sky);
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.ambient;
    this.key.color.set(p.key);
    this.key.intensity = p.keyIntensity;
  }

  setFog(color?: string, density?: number) {
    if (this.scene.fog instanceof THREE.FogExp2) {
      if (color) this.scene.fog.color.set(color);
      if (density !== undefined) this.scene.fog.density = density;
    }
  }

  /** keep the shadow camera + sky centred on the player */
  followShadow(target: THREE.Vector3) {
    this.key.position.set(target.x + 18, target.y + 30, target.z + 12);
    this.key.target.position.copy(target);
    if (this.sky) this.sky.position.copy(target);
  }

  tick(dt: number) {
    if (this.sky && !this.reduceMotion) this.sky.rotation.y += dt * 0.004;
  }

  render() { this.composer.render(); }
}
