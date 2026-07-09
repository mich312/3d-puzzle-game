// Animated portal vortex: a swirling, additive spiral disc with a bright event
// horizon and soft rim. One ShaderMaterial per portal (uniforms: colour, time,
// open 0..1) — cheap enough to run on every portal in a scene.
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
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: Math.random() * 20 },
      uColor: { value: new THREE.Color(color) },
      uOpen: { value: 1 },
      uIntensity: { value: opts?.intensity ?? 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uOpen;
      uniform float uIntensity;
      varying vec2 vUv;

      // cheap value noise for wobble
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

      void main() {
        vec2 c = vUv - 0.5;
        float r = length(c) * 2.0;              // 0 centre → 1 rim
        if (r > 1.0) discard;
        float a = atan(c.y, c.x);

        // spiral streaks: angle sheared by radius, scrolling inward over time
        float swirl = a + r * 5.5 - uTime * 1.7;
        float streaks = 0.55 + 0.45 * sin(swirl * 3.0)
                      + 0.25 * sin(swirl * 7.0 + uTime * 0.9);
        streaks *= 0.65 + 0.35 * hash(vec2(floor(swirl * 3.0), floor(r * 8.0)));

        // depth illusion: dark throat at centre, bright ring near the rim
        float throat = smoothstep(0.0, 0.42, r);
        float horizon = exp(-pow((r - 0.82) * 5.0, 2.0)) * 1.6;
        float rimFade = 1.0 - smoothstep(0.86, 1.0, r);

        float glow = (streaks * throat + horizon) * rimFade;
        glow *= uOpen * uIntensity;

        // hue shifts slightly whiter toward the horizon
        vec3 col = mix(uColor, vec3(1.0), horizon * 0.35);
        gl_FragColor = vec4(col * glow, glow * 0.85);
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
