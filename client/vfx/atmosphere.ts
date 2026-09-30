// Per-world ambient atmosphere: fixed sets of instanced motes that live in a box
// wrapped around the viewer (toroidal wrap in the vertex shader), so the field is
// infinite, costs zero CPU per particle, and never spawns or dies. Edges of the
// box fade out so the wrap is invisible. Layers per world give each place its
// own air: nexus drifting embers, atrium dust motes in light, vault snow + ice
// glitter, garden pollen + fireflies, observatory star-motes.
import * as THREE from 'three';
import { markShared } from '../render/dispose';
import { vfxAtlas, ATLAS_COLS, ATLAS_ROWS, SPR } from './sprites';
import { applyPremulBlend, bindFog, FOG_GLSL, MINPX_GLSL } from './common';
import { SKY_THEME, SKY_PALETTES } from '../render/theme';

interface Layer {
  count: number;          // at high tier
  box: [number, number, number];
  yOffset: number;        // box centre relative to the viewer's feet
  vel: [number, number, number];
  wobble: number;         // metres of meander
  wobbleFreq: number;
  size: [number, number]; // min/max world size
  color: string;
  color2: string;
  intensity: number;      // HDR multiplier (bloom convention: accents ≤ ~2.5)
  twinkle: number;        // 0..1 amount
  twinkleSpeed: number;
  twinkleSharp: number;   // exponent: high = brief flashes (glitter, fireflies)
  sprite: number;
  alpha: number;
  additive: number;
}

const L = (o: Partial<Layer>): Layer => ({
  count: 200, box: [36, 16, 36], yOffset: 3, vel: [0, 0, 0], wobble: 0.3, wobbleFreq: 0.3,
  size: [0.03, 0.06], color: '#ffffff', color2: '#ffffff', intensity: 1, twinkle: 0,
  twinkleSpeed: 1, twinkleSharp: 1, sprite: SPR.glow, alpha: 1, additive: 1, ...o,
});

export const WORLD_ATMOSPHERE: Record<string, Layer[]> = {
  nexus: [
    // drifting embers rising through the violet dusk
    L({ count: 320, vel: [0.12, 0.32, 0.05], wobble: 0.6, wobbleFreq: 0.45, size: [0.04, 0.08],
      color: '#ff9a5a', color2: '#ffc27a', intensity: 2.2, twinkle: 0.6, twinkleSpeed: 2.2, twinkleSharp: 2, sprite: SPR.ember }),
    L({ count: 160, vel: [0.03, 0.05, 0.02], size: [0.06, 0.12], color: '#b9a8ff', color2: '#8f8ad8',
      intensity: 0.6, twinkle: 0.3, sprite: SPR.bokeh }),
  ],
  atrium: [
    // dust motes catching the cool light — mostly dim, the occasional glint
    L({ count: 360, box: [30, 12, 30], vel: [0.04, 0.015, 0.02], wobble: 0.45, wobbleFreq: 0.18, size: [0.035, 0.07],
      color: '#e8f0ff', color2: '#bcd4ff', intensity: 0.9, twinkle: 0.7, twinkleSpeed: 0.8, twinkleSharp: 3, sprite: SPR.bokeh }),
  ],
  vaults: [
    // slow snowfall
    L({ count: 1100, box: [34, 18, 34], yOffset: 4, vel: [0.15, -0.9, 0.05], wobble: 0.35, wobbleFreq: 0.6,
      size: [0.04, 0.08], color: '#dfe9ff', color2: '#b8c8f5', intensity: 0.9, sprite: SPR.glow }),
    // ice glitter — near-still, brief sharp glints
    L({ count: 200, box: [24, 10, 24], vel: [0, -0.05, 0], wobble: 0.1, size: [0.07, 0.14],
      color: '#bfe8ff', color2: '#ffffff', intensity: 2.2, twinkle: 1, twinkleSpeed: 1.6, twinkleSharp: 14, sprite: SPR.flare }),
  ],
  gardens: [
    // warm pollen on a breeze
    L({ count: 320, vel: [0.35, 0.04, 0.12], wobble: 0.5, wobbleFreq: 0.35, size: [0.04, 0.08],
      color: '#ffe9b8', color2: '#ffc8d8', intensity: 0.95, twinkle: 0.2, sprite: SPR.bokeh }),
    // fireflies — wandering, pulsing
    L({ count: 80, box: [30, 6, 30], yOffset: 1.5, vel: [0, 0, 0], wobble: 1.6, wobbleFreq: 0.22, size: [0.1, 0.16],
      color: '#e8ff9a', color2: '#ffd98a', intensity: 2.4, twinkle: 1, twinkleSpeed: 1.1, twinkleSharp: 4, sprite: SPR.glow }),
  ],
  observatory: [
    // star-motes: gold and white, slow, twinkling
    L({ count: 600, box: [40, 20, 40], yOffset: 5, vel: [0.02, 0.03, -0.02], wobble: 0.2, wobbleFreq: 0.1,
      size: [0.07, 0.15], color: '#ffe3a0', color2: '#e8e4ff', intensity: 2.0, twinkle: 0.85, twinkleSpeed: 1.3,
      twinkleSharp: 5, sprite: SPR.flare }),
  ],
};
WORLD_ATMOSPHERE.proving = WORLD_ATMOSPHERE.atrium;

// sky-temples theme: golden-hour air instead of night embers / cool motes —
// sparse warm dust catching the low sun (dim: the world is bright now)
const SKY_ATMOSPHERE: Layer[] = [
  L({ count: 220, box: [34, 14, 34], vel: [0.1, 0.05, 0.04], wobble: 0.5, wobbleFreq: 0.25, size: [0.035, 0.07],
    color: '#fff3e2', color2: '#ffc987', intensity: 1.1, alpha: 0.7, additive: 0, twinkle: 0.6, twinkleSpeed: 0.9, twinkleSharp: 3, sprite: SPR.bokeh }),
  // alpha-blended, not additive: added onto the blue sky warm dust read as cyan
  // orbs — the portal/switch signal hue
];

const VERT = /* glsl */`
  attribute vec4 aSeed;
  uniform float uTime;
  uniform vec3 uCam;
  uniform vec3 uBox;
  uniform vec3 uVel;
  uniform vec2 uWobble;      // amplitude, frequency
  uniform vec2 uSize;
  uniform vec3 uTw;          // amount, speed, sharpness
  uniform float uSprite;
  varying vec2 vUv;
  varying float vA;
  varying float vMix;
  ${FOG_GLSL}
  ${MINPX_GLSL}
  void main() {
    float ph = aSeed.w * 6.2831853;
    float t = uTime;
    vec3 p = aSeed.xyz * uBox + uVel * t * (0.75 + 0.5 * aSeed.w);
    float f = uWobble.y * (0.7 + 0.6 * fract(aSeed.w * 7.31));
    p += uWobble.x * vec3(sin(t * f + ph), 0.6 * sin(t * f * 0.73 + ph * 1.7), cos(t * f * 0.87 + ph * 2.3));
    vec3 local = mod(p - uCam + 0.5 * uBox, uBox) - 0.5 * uBox;
    vec3 wp = uCam + local;
    vec3 q = abs(local) / (0.5 * uBox);
    float edge = 1.0 - smoothstep(0.72, 1.0, max(q.x, max(q.y, q.z)));
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    float size = mix(uSize.x, uSize.y, fract(aSeed.w * 13.7));
    float energy = vfxMinSize(size, -mv.z, 2.0);
    mv.xy += position.xy * size;
    gl_Position = projectionMatrix * mv;
    float tw = pow(max(0.0, 0.5 + 0.5 * sin(t * uTw.y * (0.6 + 0.8 * fract(aSeed.w * 3.9)) + ph * 5.0)), uTw.z);   // pow(neg) = NaN → bloom blocks
    float twk = mix(1.0, tw, uTw.x);
    vA = edge * twk * energy * smoothstep(0.25, 1.2, -mv.z) * vfxFog(length(mv.xyz));
    vMix = fract(aSeed.w * 29.1);
    vec2 cell = vec2(mod(uSprite, ${ATLAS_COLS.toFixed(1)}), floor(uSprite / ${ATLAS_COLS.toFixed(1)}));
    vUv = (cell + position.xy * 0.5 + 0.5) / vec2(${ATLAS_COLS.toFixed(1)}, ${ATLAS_ROWS.toFixed(1)});
  }
`;

const FRAG = /* glsl */`
  uniform sampler2D uAtlas;
  uniform vec3 uColor;
  uniform vec3 uColor2;
  uniform float uAlpha;
  uniform float uAdd;
  varying vec2 vUv;
  varying float vA;
  varying float vMix;
  void main() {
    float m = texture2D(uAtlas, vUv).r * vA * uAlpha;
    if (m < 0.003) discard;
    gl_FragColor = vec4(mix(uColor, uColor2, vMix) * m, m * (1.0 - uAdd));
  }
`;

const QUAD = new THREE.PlaneGeometry(2, 2);
markShared(QUAD);

export class Atmosphere {
  private meshes: THREE.Mesh[] = [];
  private world = '';
  private time = 0;
  private density = 1;
  private cam = new THREE.Vector3();
  reduceMotion = false;
  visible = true;

  constructor(private scene: THREE.Scene) {}

  /** tier scale for particle counts (1 = high) */
  setDensity(d: number) {
    if (d === this.density) return;
    this.density = d;
    const w = this.world;
    this.world = '';
    if (w) this.setWorld(w);
  }

  setWorld(world: string) {
    if (world === this.world) return;
    this.world = world;
    this.disposeMeshes();
    const layers = SKY_THEME && SKY_PALETTES[world] ? SKY_ATMOSPHERE : WORLD_ATMOSPHERE[world] ?? WORLD_ATMOSPHERE.atrium;
    for (const l of layers) {
      const n = Math.max(8, Math.round(l.count * this.density));
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = QUAD.index;
      geo.setAttribute('position', QUAD.getAttribute('position'));
      const seeds = new Float32Array(n * 4);
      for (let i = 0; i < n * 4; i++) seeds[i] = Math.random();
      geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
      geo.instanceCount = n;
      const c1 = new THREE.Color(l.color).multiplyScalar(l.intensity);
      const c2 = new THREE.Color(l.color2).multiplyScalar(l.intensity);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 }, uCam: { value: new THREE.Vector3() },
          uBox: { value: new THREE.Vector3(...l.box) }, uVel: { value: new THREE.Vector3(...l.vel) },
          uWobble: { value: new THREE.Vector2(l.wobble, l.wobbleFreq) },
          uSize: { value: new THREE.Vector2(...l.size) },
          uTw: { value: new THREE.Vector3(l.twinkle, l.twinkleSpeed, l.twinkleSharp) },
          uSprite: { value: l.sprite }, uAtlas: { value: vfxAtlas() },
          uColor: { value: c1 }, uColor2: { value: c2 }, uAlpha: { value: l.alpha }, uAdd: { value: l.additive },
          uFogDensity: { value: 0 }, uPxWorld: { value: 0.002 },
        },
        vertexShader: VERT, fragmentShader: FRAG,
      });
      applyPremulBlend(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 19;
      mesh.userData.yOffset = l.yOffset;
      bindFog(mesh, mat.uniforms as { uFogDensity: { value: number }; uPxWorld: { value: number } });
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  /** viewer = feet position; call every frame the atmosphere should show */
  update(dt: number, viewer: THREE.Vector3) {
    this.time += dt * (this.reduceMotion ? 0.2 : 1);
    this.cam.copy(viewer);
    for (const m of this.meshes) {
      m.visible = this.visible;
      const u = (m.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = this.time;
      u.uCam.value.set(viewer.x, viewer.y + (m.userData.yOffset as number), viewer.z);
    }
  }

  private disposeMeshes() {
    for (const m of this.meshes) {
      m.removeFromParent();
      // index/position are shared with QUAD — only dispose what this layer owns
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.meshes.length = 0;
  }

  dispose() { this.disposeMeshes(); this.world = ''; }
}
