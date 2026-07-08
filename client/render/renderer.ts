// Renderer behind a thin interface (spec §10): WebGL2 + PBR + bloom post stack,
// a budgeted dynamic-light pool, and quality-tiered heavy effects (planar mirror
// floors, tuned bloom). WebGPU-ready: swap the factory here later.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { WORLD_PALETTES } from '../../shared/palette';
import { makeSky } from './sky';
import { DynamicLights } from './lights';
import { makeReflectiveFloor, type ReflectiveFloor } from './reflector';
import { QUALITY, autoQuality, type QualityTier, type QualitySpec } from './quality';

export interface HeroFloor { y: number; size: number; tint: string; shape: 'circle' | 'plane' }

export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  readonly lights: DynamicLights;
  private gl: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private hemi: THREE.HemisphereLight;
  private key: THREE.DirectionalLight;
  private ambient: THREE.AmbientLight;
  private sky?: THREE.Mesh;
  private floor?: ReflectiveFloor;
  private heroFloor?: HeroFloor;
  private currentWorld = 'nexus';
  q: QualitySpec;
  reduceMotion = false;

  constructor(container: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 300);
    this.gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.q = QUALITY[autoQuality(this.gl.getContext())];
    this.gl.setSize(innerWidth, innerHeight);
    this.gl.setPixelRatio(Math.min(devicePixelRatio, this.q.pixelRatioCap));
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas = this.gl.domElement;
    container.appendChild(this.canvas);

    this.hemi = new THREE.HemisphereLight('#6b5b95', '#3a3550', 0.55);
    this.key = new THREE.DirectionalLight('#cfc4ff', 1.1);
    this.key.position.set(18, 30, 12);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(this.q.shadowMap, this.q.shadowMap);
    this.key.shadow.camera.left = -60; this.key.shadow.camera.right = 60;
    this.key.shadow.camera.top = 60; this.key.shadow.camera.bottom = -60;
    this.key.shadow.camera.far = 120;
    this.key.shadow.bias = -0.0004;
    this.ambient = new THREE.AmbientLight('#ffffff', 0.1);
    this.scene.add(this.hemi, this.key, this.key.target, this.ambient);

    this.lights = new DynamicLights(this.scene, this.q.lightBudget);

    this.composer = new EffectComposer(this.gl);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), this.q.bloomStrength, this.q.bloomRadius, 0.62);
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

  get quality(): QualityTier { return this.q.tier; }

  setQuality(tier: QualityTier) {
    this.q = QUALITY[tier];
    localStorage.setItem('t-quality', tier);
    this.gl.setPixelRatio(Math.min(devicePixelRatio, this.q.pixelRatioCap));
    this.key.shadow.mapSize.set(this.q.shadowMap, this.q.shadowMap);
    this.key.shadow.map?.dispose();
    this.key.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    this.bloom.strength = this.q.bloomStrength;
    this.bloom.radius = this.q.bloomRadius;
    this.lights.setBudget(this.q.lightBudget);
    this.applyHeroFloor();          // re-evaluate reflections for the new tier
  }

  setWorld(world: string, hero?: HeroFloor) {
    this.currentWorld = world;
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
    // note: the light pool is NOT cleared here — World/Enemies/Peers/Projectiles
    // each unregister their own handles on dispose, and this runs AFTER the new
    // World has registered, so a clear would wipe the fresh handles.
    this.heroFloor = hero;
    this.applyHeroFloor();
  }

  private applyHeroFloor() {
    if (this.floor) { this.floor.dispose(); this.floor = undefined; }
    if (!this.q.reflections || !this.heroFloor) return;
    const h = this.heroFloor;
    this.floor = makeReflectiveFloor(
      this.scene, h.y, h.size, this.q.reflectionRes, h.tint, h.shape, this.q.reflectionOpacity);
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

  tick(dt: number, cameraPos: THREE.Vector3) {
    if (this.sky && !this.reduceMotion) this.sky.rotation.y += dt * 0.004;
    this.lights.update(dt, cameraPos);
  }

  render() { this.composer.render(); }
}
