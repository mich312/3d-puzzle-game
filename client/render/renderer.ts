// Renderer behind a thin interface (spec §10): WebGL2 + PBR with per-world
// image-based lighting, analytic height fog, a procedural GLSL sky, fitted
// texel-snapped shadows, and a quality-tiered post stack:
//
//   low:    Render → Bloom → Grade(AgX, grade, vignette) → FXAA
//   medium: Render → GTAO(half) → Bloom → Grade(+grain) → SMAA
//   high:   Render(MSAA 4x HDR) → GTAO(full) → Bloom → Grade(+grain, edge CA)
//
// Bloom convention (shared with world/entity code): bloom only catches pre-tone-
// map luminance above ~1.0. Small glowing accents use emissiveIntensity 1.5–3;
// large emissive surfaces (portal discs) stay ≤ ~1.2 so they glow, not blow out.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { SKY_THEME, SKY_PALETTES, worldPalette, initialPixelScale, pixelBlock, type ThemedPalette, type PixelScale } from './theme';
import { installHeightFog, setHeightFog } from './heightFog';
import { makeSky } from './sky';
import { WorldEnvironment } from './environment';
import { GradePass } from './post/gradePass';
import { makeAOPass, type AOPass } from './post/aoPass';
import { disposeObject } from './dispose';
import { DynamicLights } from './lights';
import { makeReflectiveFloor, type ReflectiveFloor } from './reflector';
import { QUALITY, autoQuality, type QualityTier, type QualitySpec } from './quality';

installHeightFog();   // must run before any material compiles

export interface HeroFloor { y: number; size: number; tint: string; shape: 'circle' | 'plane' }

const SHADOW_DIST = 70;   // key light distance from its (snapped) target
// fog colours in the palette/level JSON were tuned for the old flat FogExp2 +
// ACES look; under AgX + height fog they read milky, so they're darkened here
const FOG_SCALE = 0.72;

export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  readonly lights: DynamicLights;
  private gl: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private grade!: GradePass;
  private ao?: AOPass;
  private fxaa?: ShaderPass;
  private hemi: THREE.HemisphereLight;
  private key: THREE.DirectionalLight;
  private env: WorldEnvironment;
  private sunDir = new THREE.Vector3(0.5, 0.6, 0.4).normalize();
  private lightRight = new THREE.Vector3();
  private lightUp = new THREE.Vector3();
  private sky?: THREE.Mesh;
  private floor?: ReflectiveFloor;
  private heroFloor?: HeroFloor;
  private currentWorld = 'nexus';
  private palette: ThemedPalette = worldPalette('nexus');
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpSize = new THREE.Vector2();
  q: QualitySpec;
  reduceMotion = false;
  /** 0 = full resolution; N = render at 1/N and nearest-upscale (sky-temples prototype) */
  pixelScale: PixelScale = initialPixelScale();

  constructor(container: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 300);
    // every frame goes through the composer, so the default framebuffer never
    // needs MSAA (it wouldn't apply to composer targets anyway) — AA is a post pass
    this.gl = new THREE.WebGLRenderer({ antialias: false, stencil: false, powerPreference: 'high-performance' });
    this.q = QUALITY[autoQuality(this.gl.getContext())];
    this.gl.setSize(innerWidth, innerHeight);
    this.applyPixelRatio();
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.toneMapping = THREE.NoToneMapping;   // tone mapping lives in GradePass
    this.gl.info.autoReset = false;
    this.canvas = this.gl.domElement;
    container.appendChild(this.canvas);

    // IBL (scene.environment) now carries the ambient fill; the hemisphere light
    // is a faint colour-script accent on top and there is no flat ambient term
    this.hemi = new THREE.HemisphereLight('#6b5b95', '#3a3550', 0.12);
    this.key = new THREE.DirectionalLight('#cfc4ff', 2);
    this.key.castShadow = true;
    this.key.shadow.bias = -0.0002;
    this.key.shadow.normalBias = 0.035;
    this.applyShadowSpec();
    this.scene.add(this.hemi, this.key, this.key.target);

    this.env = new WorldEnvironment(this.gl);
    this.lights = new DynamicLights(this.scene, this.q.lightBudget);
    this.buildComposer();

    // dev/test-rig hook: lets tools/ drive setQuality() and read stats at runtime
    (window as unknown as Record<string, unknown>).__renderer = this;

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.gl.setSize(innerWidth, innerHeight);
      // the pixel block depends on the window height and dpr (browser zoom), so re-pick it
      this.applyPixelRatio();
      this.composer.setPixelRatio(this.gl.getPixelRatio());
      this.composer.setSize(innerWidth, innerHeight);
      this.syncPassSizes();
    });
  }

  get quality(): QualityTier { return this.q.tier; }

  /** Pixel mode renders the drawing buffer at 1/block of the device size and lets
   *  the browser do an exact nearest upscale — every size path (pass targets,
   *  bloom mips, VFX min-pixel guards) follows the buffer, and the DOM HUD stays
   *  crisp. The block is a whole number of DEVICE pixels picked from a target row
   *  count (theme.ts pixelBlock), so the look is the same at 720p, 1080p and 1440p
   *  and blocks stay square at fractional dprs. */
  private applyPixelRatio() {
    const dpr = devicePixelRatio || 1;
    if (this.pixelScale) {
      const block = pixelBlock(this.pixelScale, innerHeight * dpr);
      this.gl.setPixelRatio(dpr / block);
      this.gl.domElement.style.imageRendering = 'pixelated';
    } else {
      this.gl.setPixelRatio(Math.min(dpr, this.q.pixelRatioCap));
      this.gl.domElement.style.imageRendering = '';
    }
  }

  setPixelScale(n: PixelScale) {
    this.pixelScale = n;
    try { localStorage.setItem('t-px', String(n)); } catch { /* storage blocked */ }
    this.applyPixelRatio();
    this.buildComposer();
    this.applyHeroFloor();
  }

  /** (re)build the post stack for the current tier */
  private buildComposer() {
    if (this.composer) {
      for (const p of this.composer.passes) p.dispose();
      this.composer.dispose();
    }
    // pixel mode drops AA / AO / grain / CA: they smear or boil at 240–360 rows
    const px = this.pixelScale > 0;
    const size = this.gl.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: px ? 0 : this.q.aa === 'msaa' ? 4 : 0,
    });
    this.composer = new EffectComposer(this.gl, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.ao = undefined;
    if (this.q.ao !== 'off' && !px) {
      this.ao = makeAOPass(this.scene, this.camera, size.x, size.y, this.q.ao === 'half');
      this.composer.addPass(this.ao);
      // dev aid: ?rdebug=ao shows the raw (denoised) AO buffer
      if (/[?&]rdebug=ao\b/.test(location.search)) this.ao.output = 5;
    }

    // sky theme: sunlit marble must never bloom — only signals and the sun disc do.
    // Golden-hour worlds sit far brighter than the night ones (lit marble reaches
    // ~1.4 luminance), so their knee moves up and the haze is gentler.
    const daylit = this.palette.cloudY !== undefined;
    const threshold = daylit ? 1.6 : px || SKY_THEME ? Math.max(this.q.bloomThreshold, 1.0) : this.q.bloomThreshold;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), this.q.bloomStrength * (daylit ? 0.6 : 1), this.q.bloomRadius, threshold);
    (this.bloom.highPassUniforms as Record<string, THREE.IUniform>).smoothWidth.value = 0.5;   // soft knee above the threshold
    this.composer.addPass(this.bloom);

    this.grade = new GradePass({ aberration: this.q.aberration && !px, grain: px ? 0 : this.q.grain, vignette: px ? 0.18 : 0.24, pixel: px });
    this.composer.addPass(this.grade);

    this.fxaa = undefined;
    if (px) { /* whole pixels: no AA pass */ }
    else if (this.q.aa === 'smaa') this.composer.addPass(new SMAAPass(size.x, size.y));
    else if (this.q.aa === 'fxaa') {
      this.fxaa = new ShaderPass(FXAAShader);
      this.composer.addPass(this.fxaa);
    }
    // the composer caches the pixel ratio it was built with; keep its targets in step
    this.composer.setPixelRatio(this.gl.getPixelRatio());
    this.composer.setSize(innerWidth, innerHeight);
    this.syncPassSizes();
    this.applyGrade();
    this.grade.setPalette(this.palette.pixelPalette ?? SKY_PALETTES.nexus.pixelPalette);
  }

  private syncPassSizes() {
    const s = this.gl.getDrawingBufferSize(this.tmpSize);
    this.fxaa?.material.uniforms.resolution.value.set(1 / s.x, 1 / s.y);
  }

  private applyShadowSpec() {
    const e = this.q.shadowExtent;
    const cam = this.key.shadow.camera;
    cam.left = -e; cam.right = e; cam.top = e; cam.bottom = -e;
    cam.near = 1; cam.far = SHADOW_DIST + 90;
    cam.updateProjectionMatrix();
    this.key.shadow.mapSize.set(this.q.shadowMap, this.q.shadowMap);
    this.key.shadow.map?.dispose();
    this.key.shadow.map = null as unknown as THREE.WebGLRenderTarget;
  }

  setQuality(tier: QualityTier) {
    this.q = QUALITY[tier];
    try { localStorage.setItem('t-quality', tier); } catch { /* storage blocked */ }
    this.applyPixelRatio();
    this.applyShadowSpec();
    this.buildComposer();           // AA mode / AO / grain differ per tier
    this.lights.setBudget(this.q.lightBudget);
    this.rebuildSky();
    this.applyHeroFloor();          // re-evaluate reflections for the new tier
  }

  setWorld(world: string, hero?: HeroFloor) {
    this.currentWorld = world;
    const p = this.palette = worldPalette(world);
    const az = THREE.MathUtils.degToRad(p.sunAz), el = THREE.MathUtils.degToRad(p.sunEl);
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    // light-space basis for texel snapping
    this.lightRight.crossVectors(new THREE.Vector3(0, 1, 0), this.sunDir).normalize();
    this.lightUp.crossVectors(this.sunDir, this.lightRight).normalize();

    this.scene.background = new THREE.Color(p.voidColor);
    this.scene.fog = new THREE.FogExp2(new THREE.Color(p.fog).multiplyScalar(p.fogScale ?? FOG_SCALE), p.fogDensity);
    this.applyHeightFog();
    this.rebuildSky();

    this.scene.environment = this.env.build(world, this.sunDir);
    this.scene.environmentIntensity = p.envIntensity;

    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.ambient;
    this.key.color.set(p.key);
    this.key.intensity = p.keyIntensity;
    // Fresh post stack per world: the GTAO pass carried state across a level change
    // (full-res AO + MSAA painted a black, world-anchored slab where a Nexus object
    // had been). A rebuild clears it and only costs a few render targets per load.
    this.buildComposer();
    // note: the light pool is NOT cleared here — World/Enemies/Peers/Projectiles
    // each unregister their own handles on dispose, and this runs AFTER the new
    // World has registered, so a clear would wipe the fresh handles.
    this.heroFloor = hero;
    this.applyHeroFloor();
  }

  private applyHeightFog() {
    const p = this.palette;
    setHeightFog({
      falloff: p.fogFalloff, base: p.fogBase, inscatter: p.inscatter, floor: p.fogFloor,
      sunDir: this.sunDir, sunColor: new THREE.Color(p.key), lowColor: new THREE.Color(p.voidColor),
    });
  }

  private applyGrade() {
    const p = this.palette;
    this.grade?.setGrade({
      exposure: p.exposure,
      shadows: new THREE.Color(p.gradeShadows),
      highlights: new THREE.Color(p.gradeHighlights),
      saturation: p.saturation,
      contrast: p.contrast,
      levels: p.levels,
    });
  }

  private rebuildSky() {
    if (this.sky) { this.scene.remove(this.sky); disposeObject(this.sky); }
    this.sky = makeSky(this.currentWorld, { sunDir: this.sunDir, detail: this.q.skyDetail });
    this.scene.add(this.sky);
    this.syncSkyHorizon();
  }

  /** the sky's horizon colour IS the fog colour, so fogged geometry melts into it */
  private syncSkyHorizon() {
    if (this.sky && this.scene.fog) (this.sky.material as THREE.ShaderMaterial).uniforms.uHorizon.value.copy(this.scene.fog.color);
  }

  private applyHeroFloor() {
    if (this.floor) { this.floor.dispose(); this.floor = undefined; }
    if (!this.q.reflections || !this.heroFloor) return;
    const h = this.heroFloor;
    const density = this.scene.fog instanceof THREE.FogExp2 ? this.scene.fog.density : 0.02;
    const res = this.pixelScale ? Math.min(this.q.reflectionRes, 256) : this.q.reflectionRes;
    this.floor = makeReflectiveFloor(
      this.scene, this.visibleFloorY(h), h.size, res, h.tint, h.shape, this.q.reflectionOpacity, density);
  }

  /** Hero floors are often covered by thin inlay discs a few cm above the
   *  nominal floor height, which would hide a mirror placed at h.y. Probe the
   *  actual top surface with a ring of downward rays and sit the mirror on it. */
  private visibleFloorY(h: HeroFloor): number {
    try {
      this.scene.updateMatrixWorld();
      const meshes: THREE.Mesh[] = [];
      const R = h.size / 2 + 1;
      this.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || o === this.sky || !o.visible) return;
        const mat = m.material as THREE.Material;
        if (Array.isArray(mat) || mat.transparent) return;
        const p = o.getWorldPosition(this.tmpV);
        if (Math.hypot(p.x, p.z) < R + 20 && Math.abs(p.y - h.y) < 20) meshes.push(m);
      });
      const ray = new THREE.Raycaster();
      ray.camera = this.camera;
      const down = new THREE.Vector3(0, -1, 0);
      const hits: number[] = [];
      const r = h.size * 0.3;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ray.set(new THREE.Vector3(Math.cos(a) * r, h.y + 0.3, Math.sin(a) * r), down);
        ray.far = 0.4;
        const hit = ray.intersectObjects(meshes, false)[0];
        if (hit) hits.push(hit.point.y);
      }
      if (!hits.length) return h.y;
      hits.sort((a, b) => a - b);
      return Math.max(h.y, hits[hits.length >> 1]);
    } catch {
      return h.y;
    }
  }

  setFog(color?: string, density?: number) {
    if (this.scene.fog instanceof THREE.FogExp2) {
      if (color && !this.palette.ignoreLevelFogColor) this.scene.fog.color.set(color).multiplyScalar(this.palette.fogScale ?? FOG_SCALE);
      if (density !== undefined) this.scene.fog.density = density;
      this.syncSkyHorizon();
      if (this.floor) (this.floor.mesh.material as THREE.ShaderMaterial).uniforms.uFogDensity.value = this.scene.fog.density;
    }
  }

  /** keep the shadow frustum fitted around the player (biased toward the view
   *  direction) and snapped to whole shadow texels so edges don't shimmer */
  followShadow(target: THREE.Vector3) {
    const e = this.q.shadowExtent;
    const fwd = this.camera.getWorldDirection(this.tmpV);
    fwd.y = 0;
    if (fwd.lengthSq() > 1e-6) fwd.normalize();
    const c = this.tmpV2.copy(target).addScaledVector(fwd, e * 0.4);
    const texel = (2 * e) / this.q.shadowMap;
    const r = c.dot(this.lightRight), u = c.dot(this.lightUp);
    c.addScaledVector(this.lightRight, Math.round(r / texel) * texel - r)
     .addScaledVector(this.lightUp, Math.round(u / texel) * texel - u);
    this.key.target.position.copy(c);
    this.key.position.copy(c).addScaledVector(this.sunDir, SHADOW_DIST);
    if (this.sky) this.sky.position.copy(target);
  }

  tick(dt: number, cameraPos: THREE.Vector3) {
    if (this.sky) {
      const mat = this.sky.material as THREE.ShaderMaterial;
      if (!this.reduceMotion) {
        this.sky.rotation.y += dt * 0.004;
        mat.uniforms.uTime.value += dt;
      }
    }
    this.lights.update(dt, cameraPos);
  }

  render() {
    this.gl.info.reset();   // count every pass of the frame, not just the last one
    this.composer.render();
  }

  /** draw-call / triangle / program counts for the last frame (perf checks) */
  stats() {
    const i = this.gl.info;
    return { calls: i.render.calls, triangles: i.render.triangles, programs: i.programs?.length ?? 0, geometries: i.memory.geometries, textures: i.memory.textures };
  }
}
