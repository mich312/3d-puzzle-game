// Experimental WebGPU backend (spec §4/§10 — the renderer was always meant to be
// swappable). Uses three's WebGPURenderer. This first pass focuses on a CORRECT
// base render: scene, lights, shadows, ACES tone-mapping, sky, fog — everything
// that maps 1:1 onto standard materials. Deferred vs the WebGL2 path (all need
// TSL/node ports, added once the base path is verified on real WebGPU hardware):
//   - bloom post (WebGL uses UnrealBloomPass/EffectComposer)
//   - planar mirror floors (WebGL Reflector)
//   - the ray-marched projectile (GLSL ShaderMaterial → sprite fallback on WebGPU)
// Built behind an opt-in toggle with automatic WebGL2 fallback (create.ts).
import * as THREE from 'three';
import {
  WebGPURenderer,
  PointLightNode, DirectionalLightNode, HemisphereLightNode, AmbientLightNode,
} from 'three/webgpu';
import { WORLD_PALETTES } from '../../shared/palette';
import { makeSky } from './sky';
import { DynamicLights } from './lights';
import { QUALITY, type QualityTier, type QualitySpec } from './quality';
import type { HeroFloor, IRenderer } from './api';
import { diagLog } from '../diag';

export class WebGPURendererImpl implements IRenderer {
  readonly backend = 'webgpu' as const;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  readonly lights: DynamicLights;
  private gl: WebGPURenderer;
  private hemi: THREE.HemisphereLight;
  private key: THREE.DirectionalLight;
  private ambient: THREE.AmbientLight;
  private sky?: THREE.Mesh;
  private adapterInfo = 'WebGPU';
  q: QualitySpec;
  reduceMotion = false;

  private constructor(container: HTMLElement, tier: QualityTier) {
    this.q = QUALITY[tier];
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 300);
    this.gl = new WebGPURenderer({ antialias: true });
    this.gl.setSize(innerWidth, innerHeight);
    this.gl.setPixelRatio(Math.min(devicePixelRatio, this.q.pixelRatioCap));
    // shadows off on WebGPU for now — the shadow pass is a common source of a
    // render-aborting validation error on the node renderer; add back once verified
    this.gl.shadowMap.enabled = false;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.canvas = this.gl.domElement;
    container.appendChild(this.canvas);

    this.hemi = new THREE.HemisphereLight('#6b5b95', '#3a3550', 0.7);
    this.key = new THREE.DirectionalLight('#cfc4ff', 1.3);
    this.key.position.set(18, 30, 12);
    this.key.castShadow = false;
    this.ambient = new THREE.AmbientLight('#ffffff', 0.15);   // small lift — no bloom yet
    this.scene.add(this.hemi, this.key, this.key.target, this.ambient);

    this.lights = new DynamicLights(this.scene, this.q.lightBudget);

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.gl.setSize(innerWidth, innerHeight);
    });
  }

  /** async factory — WebGPURenderer must init() before first render; throws on failure */
  static async create(container: HTMLElement, tier: QualityTier): Promise<WebGPURendererImpl> {
    const r = new WebGPURendererImpl(container, tier);
    await r.gl.init();
    // Our scene is built with the classic `three` build; WebGPURenderer comes from
    // `three/webgpu` (a separate copy). Its node system matches LIGHTS by class
    // identity, so our light instances are strangers to it → "Light node not found".
    // Register our light classes against the node classes to bridge the two builds.
    // (Materials are matched by type string, so they already resolve.)
    r.gl.library.addLight(PointLightNode, THREE.PointLight);
    r.gl.library.addLight(DirectionalLightNode, THREE.DirectionalLight);
    r.gl.library.addLight(HemisphereLightNode, THREE.HemisphereLight);
    r.gl.library.addLight(AmbientLightNode, THREE.AmbientLight);
    try {
      const info = (r.gl as unknown as { backend?: { adapter?: { info?: Record<string, string> } } }).backend?.adapter?.info;
      if (info) r.adapterInfo = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || 'WebGPU';
    } catch { /* best-effort */ }
    return r;
  }

  get quality(): QualityTier { return this.q.tier; }

  rendererInfo(): { api: string; gpu: string } {
    return { api: 'WebGPU', gpu: this.adapterInfo };
  }

  setQuality(tier: QualityTier) {
    this.q = QUALITY[tier];
    localStorage.setItem('t-quality', tier);
    this.gl.setPixelRatio(Math.min(devicePixelRatio, this.q.pixelRatioCap));
    this.lights.setBudget(this.q.lightBudget);
  }

  setWorld(world: string, _hero?: HeroFloor) {
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
    // planar mirror floors are WebGL-only for now (WebGPU port pending) → skipped
  }

  setFog(color?: string, density?: number) {
    if (this.scene.fog instanceof THREE.FogExp2) {
      if (color) this.scene.fog.color.set(color);
      if (density !== undefined) this.scene.fog.density = density;
    }
  }

  followShadow(target: THREE.Vector3) {
    this.key.target.position.copy(target);
    if (this.sky) this.sky.position.copy(target);
  }

  tick(dt: number, cameraPos: THREE.Vector3) {
    if (this.sky && !this.reduceMotion) this.sky.rotation.y += dt * 0.004;
    this.lights.update(dt, cameraPos);
  }

  private reported = false;
  render() {
    // WebGPU submits asynchronously; surface the first render error to the overlay
    this.gl.renderAsync(this.scene, this.camera).catch((e) => {
      if (!this.reported) { this.reported = true; diagLog('renderAsync: ' + String(e).slice(0, 260)); }
    });
  }
}
