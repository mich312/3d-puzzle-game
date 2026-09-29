// Dev-only VFX preview (not part of the production build — vite builds index.html
// only). Serve with `npx vite` and open /tools/vfx-preview.html. Renders with the
// real Renderer (bloom + ACES) over a floor, wall and pillar, and plays each
// effect on a deterministic fixed-step clock so a frame can be captured mid-flight:
//   /tools/vfx-preview.html?fx=impact&t=0.08&world=atrium
// window.__vfx.run(name, t) re-runs in place (used by screenshot scripts).
import * as THREE from 'three';
import { Renderer } from '../client/render/renderer';
import { Particles } from '../client/particles';
import { Projectiles } from '../client/projectiles';
import { DeviceRig } from '../client/devices';
import { DEVICES } from '../shared/devices';
import { PALETTE } from '../shared/palette';

const qs = new URLSearchParams(location.search);
const world = qs.get('world') ?? 'atrium';
const renderer = new Renderer(document.getElementById('app')!);
renderer.setWorld(world);
const scene = renderer.scene;
const cam = renderer.camera;
cam.position.set(0, 1.7, 6.5);
cam.lookAt(0, 1.3, 0);

const stone = new THREE.MeshStandardMaterial({ color: '#8d8a9c', roughness: 0.75, metalness: 0.05 });
const floor = new THREE.Mesh(new THREE.BoxGeometry(40, 0.5, 40), stone);
floor.position.y = -0.25; floor.receiveShadow = true;
const wall = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 0.6), stone);
wall.position.set(0, 3, -3); wall.receiveShadow = true; wall.castShadow = true;
const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 4, 0.8), stone);
pillar.position.set(-3.5, 2, -1);
scene.add(floor, wall, pillar);

const particles = new Particles(scene, renderer.lights);
particles.setQuality(renderer.q);
const projectiles = new Projectiles(scene, particles, renderer.lights);
projectiles.setQuality(renderer.q.projectileLights);
const rig = new DeviceRig(scene, particles);

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const fx = particles.fx;
const wallN = V(0, 0, 1);

type Scenario = { setup: () => void; perStep?: (dt: number, t: number) => void; ambient?: string };
const S: Record<string, Scenario> = {
  pulse: { setup: () => projectiles.fire(V(-1.2, 1.2, 4.5), [1.0, 1.6, -2.7], DEVICES.pulse.color, { speed: 72, kind: 'pulse' }) },
  freeze: { setup: () => projectiles.fire(V(-1.2, 1.2, 4.5), [1.0, 1.6, -2.7], DEVICES.freeze.color, { speed: 52, scale: 1.3, kind: 'freeze' }) },
  muzzle: { setup: () => fx.muzzle(V(0, 1.4, 3), V(0.3, 0, -1).normalize(), DEVICES.pulse.color) },
  impact: { setup: () => fx.impact(V(0, 1.6, -2.7), wallN, DEVICES.pulse.color) },
  frost: { setup: () => fx.frostBurst(V(0, 1.6, -2.7), wallN, DEVICES.freeze.color) },
  tractor: {
    setup: () => {},
    perStep: (dt) => rig.tractorBeam('p', V(-1.0, 1.1, 4.2), V(0.1, 0.05, -1).normalize(), V(1.6, 0.8, -0.5), DEVICES.tractor.color, dt),
  },
  tracer: { setup: () => rig.tracer([-1, 1.2, 4.5], [1.5, 1.5, -2.7], PALETTE.portalA, 0.03, 220) },
  portalPlaced: { setup: () => fx.portalPlaced([0.5, 1.8, -2.62], [0, 0, 1], PALETTE.portalA) },
  portalTraverse: { setup: () => fx.portalTraverse([0, 1, 0], PALETTE.portalB) },
  enemyDeath: { setup: () => fx.enemyDeath([0, 0.9, 0], PALETTE.hostile) },
  shatter: { setup: () => fx.shatter([0, 0.9, 0]) },
  frozen: { setup: () => fx.frozen([0, 0.9, 0]) },
  downed: { setup: () => fx.downed(V(0, 0, 0)) },
  revive: { setup: () => fx.revive(V(0, 0, 0)) },
  pickup: { setup: () => fx.pickup(V(0, 1.0, 1)) },
  checkpoint: { setup: () => fx.checkpoint([0, 0, 0]) },
  shard: { setup: () => fx.shardGained([0, 1.5, 1]) },
  landing: { setup: () => fx.landing([0, 0, 3], 1) },
  ambient: { setup: () => {}, ambient: world },
};

let live: string | null = null;
let liveT = 0;
const reset = () => { particles.clear(); projectiles.clear(); rig.clearVfx(); };

const ui = document.getElementById('ui')!;
for (const k of Object.keys(S)) {
  const b = document.createElement('button');
  b.textContent = k;
  b.onclick = () => { live = k; liveT = 0; reset(); S[k].setup(); };
  ui.appendChild(b);
}

function step(sc: Scenario, dt: number, t: number) {
  sc.perStep?.(dt, t);
  if (sc.ambient) particles.ambient(sc.ambient, V(0, 0, 3), dt);
  projectiles.update(dt);
  rig.update(dt);
  particles.update(dt);
  renderer.tick(dt, cam.position);
}

/** deterministic: reset, set up, advance `t` seconds at 60Hz, render one frame */
function run(name: string, t: number) {
  const sc = S[name];
  if (!sc) throw new Error(`no scenario ${name}`);
  live = null;
  ui.style.display = 'none';
  reset();
  sc.setup();
  const dt = 1 / 60;
  for (let e = 0; e < t - 1e-6; e += dt) step(sc, dt, e);
  renderer.render();
}

(window as unknown as { __vfx: unknown }).__vfx = { run, particles, renderer, S };
const fxName = qs.get('fx');
if (fxName) run(fxName, Number(qs.get('t') ?? 0.1));
else {
  let last = performance.now();
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (live) {
      liveT += dt;
      step(S[live], dt, liveT);
      if (liveT > 2.5 && !S[live].perStep && !S[live].ambient) { liveT = 0; S[live].setup(); }
    }
    renderer.render();
  };
  requestAnimationFrame(loop);
}
