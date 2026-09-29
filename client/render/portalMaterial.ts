// Portal vortex: a "window" into a swirling tunnel. Three swirl layers sit at
// increasing virtual depth behind the disc and shift with the view direction
// (parallax), so the tunnel reads as deep from any angle. A fresnel rim brightens
// at grazing angles. Normal (not additive) blending with luminance kept ≤ ~1.1,
// so bloom catches the event-horizon ring and streaks — never the whole disc.
// One ShaderMaterial per portal (uniforms: colour, time, open 0..1).
import * as THREE from 'three';

export interface PortalVortex {
  material: THREE.ShaderMaterial;
  /** advance animation; open eases the locked→active transition */
  tick(dt: number, open: number): void;
}

export function makePortalVortex(color: string, opts?: { intensity?: number }): PortalVortex {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: Math.random() * 20 },
      uColor: { value: new THREE.Color(color) },
      uOpen: { value: 1 },
      uIntensity: { value: (opts?.intensity ?? 1) * 0.85 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vView;     // object-space vector surface → camera
      void main() {
        vUv = uv;
        vec3 camObj = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
        vView = camObj - position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uOpen;
      uniform float uIntensity;
      varying vec2 vUv;
      varying vec3 vView;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      // one swirl layer sampled at disc coords p (unit disc)
      float swirl(vec2 p, float t, float k) {
        float r = length(p);
        float a = atan(p.y, p.x);
        float s = a + r * (4.5 + k) - t * (1.4 + k * 0.4);
        float streak = 0.5 + 0.5 * sin(s * 3.0) ;
        streak *= 0.6 + 0.4 * vnoise(vec2(s * 1.7, r * 6.0 - t));
        return streak * smoothstep(1.05, 0.2, r);
      }

      void main() {
        vec2 c = (vUv - 0.5) * 2.0;             // -1..1
        float r = length(c);
        if (r > 1.0) discard;
        vec3 V = normalize(vView);
        vec2 par = V.xy / max(abs(V.z), 0.3);    // parallax direction
        float t = uTime;

        // three layers at increasing depth, the deepest darkest
        float l1 = swirl(c - par * 0.12, t, 0.0);
        float l2 = swirl((c - par * 0.32) * 1.35, t * 0.8, 1.5);
        float l3 = swirl((c - par * 0.6) * 1.9, t * 0.6, 3.0);
        float throat = smoothstep(0.0, 0.7, r);  // centre falls away into darkness

        vec3 deep = uColor * 0.06;
        vec3 col = deep;
        col += uColor * l3 * 0.18;
        col += uColor * l2 * 0.32 * (0.4 + 0.6 * throat);
        col += mix(uColor, vec3(1.0), 0.25) * l1 * 0.5 * throat;

        // event horizon ring + view-dependent rim
        float horizon = exp(-pow((r - 0.9) * 9.0, 2.0));
        float fres = 1.0 - abs(V.z);
        col += mix(uColor, vec3(1.0), 0.4) * horizon * (0.55 + 0.35 * fres);
        col *= uIntensity;
        // hard ceiling just under the bloom knee: only the horizon/streak peaks glow
        float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col *= min(1.0, 0.8 / max(lum, 1e-3));

        float alpha = mix(0.35, 0.94, smoothstep(1.0, 0.75, r)) * smoothstep(1.0, 0.94, r);
        alpha = max(alpha, horizon * 0.9);
        gl_FragColor = vec4(col * uOpen + deep * (1.0 - uOpen), alpha * mix(0.25, 1.0, uOpen));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  let open = 1;
  return {
    material,
    tick(dt: number, targetOpen: number) {
      material.uniforms.uTime.value += dt;
      open += (targetOpen - open) * Math.min(1, dt * 4);
      material.uniforms.uOpen.value = open;
    },
  };
}
