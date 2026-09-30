// Final "camera" pass — one cheap full-screen shader that replaces OutputPass:
//   [edge chromatic aberration] → exposure + AgX tone map → sRGB →
//   per-world grade (lift/gain split-tone, saturation, contrast) →
//   vignette → fine animated film grain.
// PIXEL (sky-temples prototype, pixel scale on): grain is replaced by a static,
// screen-locked 4×4 Bayer dither, per-channel level quantisation and a soft pull
// toward a 16-entry world palette. Pixels whose pre-tonemap value × exposure is
// HDR (emissive signals, the sun disc) bypass the quantiser so they stay vivid.
// Everything after tone mapping runs in display space so the grade controls
// behave like a colourist's lift/gamma/gain. Grain doubles as a dither that hides
// banding in the dark gradient skies.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export interface GradeSettings {
  exposure: number;
  shadows: THREE.Color;      // lift tint (display space)
  highlights: THREE.Color;   // gain tint (display space)
  saturation: number;
  contrast: number;
}

const shader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    toneMappingExposure: { value: 1 },
    uLift: { value: new THREE.Vector3() },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uLook: { value: new THREE.Vector2(1.2, 1.2) },
    uVignette: { value: 0.22 },
    uGrain: { value: 0.03 },
    uAberration: { value: 0 },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uLevels: { value: 16 },
    uPalPull: { value: 0.35 },
    uSig: { value: new THREE.Vector2(1.6, 2.4) },
    uPal: { value: Array.from({ length: 16 }, () => new THREE.Vector3()) },
  },
  vertexShader: /* glsl */`
    precision highp float;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    attribute vec3 position;
    attribute vec2 uv;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform vec3 uLift, uGain;
    uniform float uVignette, uGrain, uAberration, uTime;
    uniform vec2 uResolution;
    uniform vec3 uPal[16];
    uniform float uLevels, uPalPull;
    uniform vec2 uSig;
    varying vec2 vUv;

    uniform vec2 uLook;   // AgX look: x = power (contrast), y = saturation

    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>

    // three's AgX (Filament/Blender) with the ASC-CDL "look" stage enabled —
    // stock AgX is deliberately flat and desaturated; a mild punchy look keeps
    // its graceful highlight roll-off (no hue skew, no white slabs) while
    // restoring contrast and colour.
    vec3 agxLook(vec3 color) {
      const mat3 AgXInsetMatrix = mat3(
        vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
        vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
        vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
      const mat3 AgXOutsetMatrix = mat3(
        vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
        vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
        vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
      const float AgxMinEv = -12.47393;
      const float AgxMaxEv = 4.026069;
      color *= toneMappingExposure;
      color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
      color = AgXInsetMatrix * color;
      color = max(color, 1e-10);
      color = log2(color);
      color = (color - AgxMinEv) / (AgxMaxEv - AgxMinEv);
      color = clamp(color, 0.0, 1.0);
      color = agxDefaultContrastApprox(color);
      // look (slope 1, offset 0)
      color = pow(max(color, 0.0), vec3(uLook.x));
      float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = l + uLook.y * (color - l);
      color = AgXOutsetMatrix * color;
      color = pow(max(vec3(0.0), color), vec3(2.2));
      color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
      return clamp(color, 0.0, 1.0);
    }

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    // ordered dither: static 4×4 Bayer in [0,1) keyed on the (low-res) buffer pixel
    float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
    float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec3 col;
      #ifdef ABERRATION
        // radial split, zero in the centre and only noticeable at the frame edges
        vec2 off = c * r2 * uAberration;
        col.r = texture2D(tDiffuse, vUv - off).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv + off).b;
      #else
        col = texture2D(tDiffuse, vUv).rgb;
      #endif

      vec3 raw = col;                                  // pre-tonemap HDR (signal bypass)
      col = agxLook(col);                              // includes exposure
      col = sRGBTransferOETF(vec4(col, 1.0)).rgb;      // → display space

      // lift / gain split-tone
      col = col * uGain + uLift * (1.0 - col);
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));

      // vignette (soft, elliptical)
      float vig = smoothstep(0.18, 0.78, r2 * 2.2);
      col *= 1.0 - uVignette * vig;

      #ifdef PIXEL
        float hdr = max(max(raw.r, raw.g), raw.b) * toneMappingExposure;
        float sig = smoothstep(uSig.x, uSig.y, hdr);          // emissive/HDR accents & sun stay vivid
        float b = bayer4(gl_FragCoord.xy) - 0.46875;          // static, screen-locked, never animated
        vec3 lev = floor(clamp(col + b / uLevels, 0.0, 1.0) * uLevels + 0.5) / uLevels;
        vec3 best = lev; float bd = 1e9;
        for (int i = 0; i < 16; i++) {
          vec3 dd = lev - uPal[i];
          float e = dot(dd * dd, vec3(0.3, 0.59, 0.11));
          if (e < bd) { bd = e; best = uPal[i]; }
        }
        // soft: pull only when already close, so neutral shade never drifts into a hue
        vec3 q = mix(lev, best, uPalPull * (1.0 - smoothstep(0.002, 0.008, bd)));
        col = mix(q, clamp(col + b / 48.0, 0.0, 1.0), sig);
      #else
        // film grain, strongest in the mid-tones, animated per frame
        float g = hash12(vUv * uResolution + fract(uTime * 7.31) * 517.0) - 0.5;
        col += g * uGrain * (0.35 + 0.65 * (1.0 - abs(luma * 2.0 - 1.0)));
      #endif

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export class GradePass extends Pass {
  readonly uniforms: typeof shader.uniforms;
  private material: THREE.RawShaderMaterial;
  private quad: FullScreenQuad;

  constructor(opts: { aberration: boolean; grain: number; vignette: number; pixel?: boolean }) {
    super();
    this.uniforms = THREE.UniformsUtils.clone(shader.uniforms) as typeof shader.uniforms;
    this.uniforms.uGrain.value = opts.grain;
    this.uniforms.uVignette.value = opts.vignette;
    this.uniforms.uAberration.value = opts.aberration ? 0.005 : 0;
    // dev knobs: ?pxlevels=8..32 (per-channel levels), ?pxpull=0..1 (palette pull)
    try {
      const lv = /[?&]pxlevels=(\d+)/.exec(location.search), pl = /[?&]pxpull=([\d.]+)/.exec(location.search);
      if (lv) this.uniforms.uLevels.value = THREE.MathUtils.clamp(Number(lv[1]), 8, 32);
      if (pl) this.uniforms.uPalPull.value = THREE.MathUtils.clamp(Number(pl[1]), 0, 1);
    } catch { /* no location (tests) */ }
    this.material = new THREE.RawShaderMaterial({
      name: 'GradePass',
      uniforms: this.uniforms,
      vertexShader: shader.vertexShader,
      fragmentShader: shader.fragmentShader,
      defines: { ...(opts.aberration ? { ABERRATION: '' } : {}), ...(opts.pixel ? { PIXEL: '' } : {}) },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  setGrade(g: GradeSettings) {
    this.uniforms.toneMappingExposure.value = g.exposure;
    // lift is a small additive tint into the blacks; gain a gentle multiplicative
    // tint on the highlights (normalised so it doesn't change overall brightness)
    // (palette colours arrive as linear THREE.Colors; the grade works in display space)
    const sh = g.shadows.clone().convertLinearToSRGB();
    this.uniforms.uLift.value.set(sh.r, sh.g, sh.b).multiplyScalar(0.3);
    const h = g.highlights.clone().convertLinearToSRGB();
    const hl = (h.r + h.g + h.b) / 3 || 1;
    this.uniforms.uGain.value.set(h.r / hl, h.g / hl, h.b / hl).lerp(new THREE.Vector3(1, 1, 1), 0.6);
    this.uniforms.uLook.value.set(1.2 * g.contrast, 1.15 * g.saturation);
  }

  /** 16 sRGB hexes → display-space palette (fresh vectors: UniformsUtils.clone
   *  shallow-copies arrays, so the template's vectors must never be mutated) */
  setPalette(hex: string[]) {
    for (let i = 0; i < 16; i++) {
      const c = new THREE.Color(hex[i % hex.length]).convertLinearToSRGB();
      this.uniforms.uPal.value[i] = new THREE.Vector3(c.r, c.g, c.b);
    }
  }

  setSize(width: number, height: number) {
    this.uniforms.uResolution.value.set(width, height);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime?: number) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.uTime.value += deltaTime ?? 0.016;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}
