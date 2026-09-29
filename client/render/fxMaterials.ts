// Shader materials for volumetric-looking gameplay volumes: hazards (steam / void /
// spark), conveyor belts and shimmering force-field barriers. All output stays
// under ~1.0 luminance except thin hot details, so bloom only catches the arcs and
// edges — never the whole volume. Each instance owns its material (state-driven).
import * as THREE from 'three';

const NOISE = /* glsl */ `
  float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float vn3(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += vn3(p) * a; p = p * 2.03 + 11.7; a *= 0.5; } return s; }
`;

const VOL_VERT = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vWPos;
  varying vec3 vWNrm;
  void main() {
    vLocal = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWPos = wp.xyz;
    vWNrm = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

export interface FxMaterial {
  material: THREE.ShaderMaterial;
  tick(dt: number, frozen: boolean): void;
}

/** Hazard volume material. `size` = box dims (for normalised coordinates). */
export function makeHazardMaterial(kind: 'steam' | 'void' | 'spark' | 'conveyor', size: Vec3Like, dir?: Vec3Like): FxMaterial {
  const k = kind === 'steam' ? 0 : kind === 'void' ? 1 : kind === 'spark' ? 2 : 3;
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: Math.random() * 50 },
      uFrozen: { value: 0 },
      uKind: { value: k },
      uSize: { value: new THREE.Vector3(size[0], size[1], size[2]) },
      uDir: { value: new THREE.Vector2(dir?.[0] ?? 0, dir?.[2] ?? 0) },
    },
    vertexShader: VOL_VERT,
    fragmentShader: /* glsl */ `
      uniform float uTime, uFrozen, uKind;
      uniform vec3 uSize;
      uniform vec2 uDir;
      varying vec3 vLocal;
      varying vec3 vWPos;
      varying vec3 vWNrm;
      ${NOISE}
      void main() {
        vec3 n01 = vLocal / uSize + 0.5;              // 0..1 inside the box
        vec3 V = normalize(cameraPosition - vWPos);
        float facing = abs(dot(V, vWNrm));
        // soft volume edges: fade toward the rim of whichever box face we're on
        vec3 an = abs(vWNrm);
        vec2 fp = an.x > 0.5 ? vLocal.zy : an.z > 0.5 ? vLocal.xy : vLocal.xz;
        vec2 hs = an.x > 0.5 ? uSize.zy * 0.5 : an.z > 0.5 ? uSize.xy * 0.5 : uSize.xz * 0.5;
        vec2 dE = hs - abs(fp);
        float border = min(dE.x, dE.y);
        float t = uTime * (1.0 - uFrozen);
        vec3 col; float a;
        if (uKind < 0.5) {                            // STEAM: rising turbulent wisps
          vec3 q = vWPos * vec3(1.1, 0.7, 1.1) - vec3(0.0, t * 1.6, 0.0);
          float w = fbm3(q + fbm3(q * 0.7 + t * 0.2) * 1.5);
          float rise = smoothstep(0.0, 0.25, n01.y) * (1.0 - smoothstep(0.55, 1.0, n01.y));
          a = smoothstep(0.3, 0.68, w) * (0.3 + 0.6 * rise) * (0.35 + 0.65 * facing);
          col = mix(vec3(0.78, 0.88, 1.0), vec3(1.0), w);
          a *= 0.55;
        } else if (uKind < 1.5) {                     // VOID: dark churning rift with ember lips
          vec3 q = vWPos * 0.9 + vec3(0.0, -t * 0.25, 0.0);
          float w = fbm3(q + vec3(fbm3(q * 1.3 + t * 0.15) * 2.0));
          float cracks = smoothstep(0.035, 0.0, abs(w - 0.5));
          float top = smoothstep(0.75, 1.0, n01.y);
          col = mix(vec3(0.05, 0.02, 0.06), vec3(0.18, 0.05, 0.1), w) + vec3(0.88, 0.4, 0.29) * (cracks * 0.9 + top * 0.35);
          a = 0.55 + w * 0.3 + cracks * 0.2;
        } else if (uKind < 2.5) {                     // SPARK: faint haze + crackling arcs
          vec3 q = vWPos * vec3(2.2, 1.2, 2.2) + vec3(0.0, 0.0, t * 3.0);
          float arcN = fbm3(q + vec3(floor(t * 12.0) * 3.1));
          float arc = smoothstep(0.03, 0.0, abs(arcN - 0.5)) * step(0.35, vn3(vec3(floor(t * 9.0), vWPos.y * 2.0, 0.0)));
          col = vec3(0.45, 0.7, 1.0) * 0.4 + vec3(0.85, 0.95, 1.0) * arc * 1.6;
          a = 0.08 + arc * 0.8;
        } else {                                      // CONVEYOR volume: barely-there flow shimmer
          vec2 d = normalize(uDir + 1e-5);
          float along = dot(vWPos.xz, d);
          float stripes = 0.5 + 0.5 * sin((along - t * length(uDir)) * 6.2832 / 1.2);
          col = vec3(0.55, 0.7, 1.0);
          a = 0.05 + stripes * 0.05 * smoothstep(0.6, 0.0, n01.y);
        }
        // frozen: glassy ice
        vec3 ice = vec3(0.78, 0.92, 1.0) * (0.55 + 0.45 * fbm3(vWPos * 3.0));
        col = mix(col, ice, uFrozen);
        a = mix(a, 0.72 + 0.2 * (1.0 - facing), uFrozen);
        a *= mix(smoothstep(0.0, 0.35, border), 1.0, uFrozen);
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.95));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  let frozen = 0;
  return {
    material,
    tick(dt, isFrozen) {
      material.uniforms.uTime.value += dt;
      frozen += ((isFrozen ? 1 : 0) - frozen) * Math.min(1, dt * 5);
      material.uniforms.uFrozen.value = frozen;
    },
  };
}

type Vec3Like = [number, number, number] | readonly number[];

/** Scrolling conveyor belt surface (a flat quad on the floor of the volume). */
export function makeBeltMaterial(dir: Vec3Like, length: number): FxMaterial {
  const speed = Math.hypot(dir[0], dir[2]) || 1;
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: {
      uTime: { value: 0 }, uFrozen: { value: 0 }, uSpeed: { value: speed }, uLen: { value: length },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uFrozen, uSpeed, uLen;
      varying vec2 vUv;
      void main() {
        // vUv.x runs along the flow (metres = vUv.x * uLen)
        float s = vUv.x * uLen - uTime * uSpeed;
        float across = abs(vUv.y - 0.5) * 2.0;
        float chev = fract(s / 1.1 - across * 0.35);
        float mark = smoothstep(0.0, 0.06, chev) * (1.0 - smoothstep(0.22, 0.3, chev));
        float slats = 0.5 + 0.5 * step(0.5, fract(s * 2.5));
        float rails = smoothstep(0.86, 0.92, across);
        vec3 base = vec3(0.16, 0.17, 0.24) * (0.8 + 0.2 * slats);
        vec3 glow = vec3(0.49, 0.66, 1.0);
        vec3 col = base + glow * mark * 0.9 * (1.0 - rails) + vec3(0.35) * rails;
        col = mix(col, vec3(0.75, 0.9, 1.0) * (0.6 + 0.3 * slats), uFrozen * 0.8);
        gl_FragColor = vec4(col, 0.92);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  let frozen = 0;
  return {
    material,
    tick(dt, isFrozen) {
      if (!isFrozen) material.uniforms.uTime.value += dt;
      frozen += ((isFrozen ? 1 : 0) - frozen) * Math.min(1, dt * 5);
      material.uniforms.uFrozen.value = frozen;
    },
  };
}

export interface ForceField extends FxMaterial { setFade(t: number): void }

/** Shimmering hex-lattice barrier; fades with setFade(0..1). */
export function makeForceField(color: string, size: Vec3Like): ForceField {
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: Math.random() * 10 }, uColor: { value: new THREE.Color(color) },
      uFade: { value: 1 }, uSize: { value: new THREE.Vector3(size[0], size[1], size[2]) },
    },
    vertexShader: VOL_VERT,
    fragmentShader: /* glsl */ `
      uniform float uTime, uFade;
      uniform vec3 uColor, uSize;
      varying vec3 vLocal;
      varying vec3 vWPos;
      varying vec3 vWNrm;
      ${NOISE}
      float hexDist(vec2 p) {
        p = abs(p);
        return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
      }
      void main() {
        // face-plane coords in metres: pick the two axes of the box face we're on
        vec3 an = abs(vWNrm);
        vec2 fp = an.x > 0.5 ? vLocal.zy : an.z > 0.5 ? vLocal.xy : vLocal.xz;
        vec2 hs = an.x > 0.5 ? uSize.zy * 0.5 : an.z > 0.5 ? uSize.xy * 0.5 : uSize.xz * 0.5;
        // hex lattice
        vec2 g = fp * 3.2;
        vec2 r = vec2(1.0, 1.7320508);
        vec2 h = r * 0.5;
        vec2 a = mod(g, r) - h, b = mod(g - h, r) - h;
        vec2 cell = dot(a, a) < dot(b, b) ? a : b;
        float edge = smoothstep(0.42, 0.5, hexDist(cell));
        // travelling shimmer + scan band
        float sh = vn3(vec3(fp * 1.5, uTime * 0.6));
        float scan = smoothstep(0.08, 0.0, abs(fract(fp.y * 0.25 - uTime * 0.35) - 0.5) - 0.42);
        // bright rim where the field meets its frame
        vec2 dEdge = hs - abs(fp);
        float rim = smoothstep(0.12, 0.0, min(dEdge.x, dEdge.y));
        vec3 V = normalize(cameraPosition - vWPos);
        float fres = pow(1.0 - abs(dot(V, vWNrm)), 2.0);
        float lum = 0.12 + edge * (0.35 + sh * 0.35) + scan * 0.35 + rim * 0.9 + fres * 0.35;
        vec3 col = uColor * lum + vec3(1.0) * rim * 0.15;
        float alpha = clamp(0.1 + edge * 0.35 + scan * 0.2 + rim * 0.5 + fres * 0.25, 0.0, 0.9) * uFade;
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return {
    material,
    tick(dt) { material.uniforms.uTime.value += dt; },
    setFade(t) { material.uniforms.uFade.value = t; },
  };
}
