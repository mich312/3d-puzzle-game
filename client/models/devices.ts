// First-person device models (Kinetic Pulse, Freeze Ray, Tractor Beam, Portal
// Device) and the gloved hands that hold them. Authored in viewmodel space: barrel
// along -Z, pistol grip at the origin-ish, ~0.35 m long. Every material gets the
// viewmodel depth squash so the device never clips into walls.
import * as THREE from 'three';
import { PALETTE } from '../../shared/palette';
import { DEVICES, type DeviceId } from '../../shared/devices';
import {
  M, PartSet, lathe, roundedBox, roundedOutline, plate, capsule, cyl, torus, sphere,
  paintMat, glowMat, withDepthSquash, panelNormalMap, fabricNormalMap,
} from './common';

export interface DeviceState { t: number; dt: number; charge: number; active: boolean; kick: number; slot: 0 | 1 }
export interface DeviceModel {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  /** left-hand support point (viewmodel space) */
  support: THREE.Vector3;
  update(s: DeviceState): void;
}

const GRIP = M(0, -0.068, 0.058, 0.32, 0, 0);
function vmMat<T extends THREE.Material>(m: T): T { return withDepthSquash(m); }
function metal() { return vmMat(new THREE.MeshStandardMaterial({ color: '#4a4860', roughness: 0.3, metalness: 0.85, normalMap: panelNormalMap(), normalScale: new THREE.Vector2(0.25, 0.25) })); }
function dark() { return vmMat(new THREE.MeshStandardMaterial({ color: '#1c1b26', roughness: 0.75, metalness: 0.2 })); }
function glass(tint: string) {
  return vmMat(new THREE.MeshPhysicalMaterial({
    color: tint, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.32,
    clearcoat: 1, clearcoatRoughness: 0.05, depthWrite: false,
  }));
}
const screenMats = new Map<string, THREE.MeshStandardMaterial>();
function meshes(P: PartSet, mats: Record<string, THREE.Material>): THREE.Mesh[] {
  return P.keys().map((k) => {
    let m = mats[k];
    if (!m && k === 'screen') {
      // dim status readout in the device colour (close to the eye: keep it under the bloom threshold)
      const g = mats.glow as THREE.MeshStandardMaterial;
      const key = g.emissive.getHexString();
      m = screenMats.get(key) ?? vmMat(glowMat('#' + key, 0.9));
      screenMats.set(key, m as THREE.MeshStandardMaterial);
    }
    return new THREE.Mesh(P.build(k), m);
  });
}
/** side-profile housing: outline in (forward, up) with forward = -Z, extruded along X */
function profile(pts: [number, number][], width: number, bevel: number, r = 0.012): THREE.BufferGeometry {
  return plate(roundedOutline(pts, r), width, bevel).rotateY(Math.PI / 2);
}
function commonGrip(P: PartSet, rearZ = 0.105, rearY = 0.018) {
  // rear status display facing the player
  P.add('dark', roundedBox(0.04, 0.03, 0.01, 0.004), M(0, rearY, rearZ));
  P.add('screen', roundedBox(0.028, 0.006, 0.004, 0.002), M(0, rearY + 0.004, rearZ + 0.006));
  P.add('screen', roundedBox(0.012, 0.004, 0.004, 0.0015), M(-0.008, rearY - 0.006, rearZ + 0.006));
  P.add('dark', roundedBox(0.036, 0.105, 0.046, 0.014), GRIP);
  P.add('metal', roundedBox(0.04, 0.012, 0.05, 0.005), M(0, -0.122, 0.074, 0.32, 0, 0));
  // trigger + guard
  P.add('metal', torus(0.022, 0.004, 14, Math.PI), M(0, -0.028, 0.012, 0, Math.PI / 2, Math.PI));
  P.add('dark', roundedBox(0.008, 0.026, 0.01, 0.003), M(0, -0.03, 0.012, 0.3, 0, 0));
}

// ---------------- Kinetic Pulse ----------------
function buildPulse(): DeviceModel {
  const color = DEVICES.pulse.color;
  const g = new THREE.Group();
  const shell = vmMat(paintMat('#d9d2c4', 0.35, 0.1)), m = metal(), d = dark(), glow = vmMat(glowMat(color, 1.6));
  const P = new PartSet();
  P.add('shell', profile([[-0.1, -0.02], [-0.1, 0.035], [-0.07, 0.058], [0.1, 0.05], [0.14, 0.02], [0.13, -0.022], [0.02, -0.03]], 0.056, 0.01));
  P.add('metal', profile([[-0.105, -0.03], [0.12, -0.03], [0.12, -0.012], [-0.105, -0.012]], 0.06, 0.004, 0.005));
  commonGrip(P, 0.113);
  P.add('metal', cyl(0.021, 0.024, 0.11, 18), M(0, 0.012, -0.2, Math.PI / 2, 0, 0));
  P.add('metal', cyl(0.03, 0.03, 0.016, 18), M(0, 0.012, -0.265, Math.PI / 2, 0, 0));
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2 + Math.PI / 2;
    P.add('metal', roundedBox(0.008, 0.008, 0.05, 0.003), M(Math.cos(a) * 0.028, 0.012 + Math.sin(a) * 0.028, -0.288, 0, 0, a));
  }
  P.add('glow', sphere(0.016, 14, 10), M(0, 0.012, -0.272));
  P.add('dark', roundedBox(0.036, 0.016, 0.1, 0.006), M(0, 0.058, -0.01));
  P.add('glow', roundedBox(0.026, 0.008, 0.084, 0.003), M(0, 0.064, -0.01));
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) P.add('glow', roundedBox(0.003, 0.006, 0.03, 0.002), M(s * 0.03, 0.02 - i * 0.012, 0.03));
  g.add(...meshes(P, { shell, metal: m, dark: d, glow }));
  // spinning coil stack
  const coils = new THREE.Group();
  coils.position.set(0, 0.012, -0.2);
  const C = new PartSet();
  for (let i = 0; i < 3; i++) {
    C.add('glow', torus(0.033, 0.0065, 28), M(0, 0, -0.03 + i * 0.03));
    for (let k = 0; k < 4; k++) {
      const a = k / 4 * Math.PI * 2 + i * 0.4;
      C.add('metal', roundedBox(0.012, 0.012, 0.014, 0.003), M(Math.cos(a) * 0.033, Math.sin(a) * 0.033, -0.03 + i * 0.03, 0, 0, a));
    }
  }
  coils.add(...meshes(C, { glow, metal: m }));
  g.add(coils);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.012, -0.29); g.add(muzzle);
  let spin = 0;
  return {
    group: g, muzzle, support: new THREE.Vector3(-0.012, -0.022, -0.13),
    update(s) {
      spin += s.dt * (1.5 + s.charge * 26 + s.kick * 20);
      coils.rotation.z = spin;
      glow.emissiveIntensity = 1.5 + Math.sin(s.t * 3) * 0.25 + s.charge * 4 * (0.8 + 0.2 * Math.sin(s.t * 40)) + s.kick * 4;
    },
  };
}

// ---------------- Freeze Ray ----------------
function buildFreeze(): DeviceModel {
  const color = DEVICES.freeze.color;
  const g = new THREE.Group();
  const shell = vmMat(paintMat('#e4ecf3', 0.3, 0.05)), m = metal(), d = dark(), glow = vmMat(glowMat(color, 2.2));
  const P = new PartSet();
  P.add('shell', profile([[-0.09, -0.024], [-0.09, 0.03], [-0.05, 0.048], [0.16, 0.036], [0.19, 0.012], [0.18, -0.02], [0.02, -0.03]], 0.05, 0.01));
  commonGrip(P, 0.103);
  P.add('metal', roundedBox(0.016, 0.012, 0.2, 0.004), M(0, 0.05, -0.05));
  P.add('metal', cyl(0.017, 0.02, 0.1, 16), M(0, 0.006, -0.23, Math.PI / 2, 0, 0));
  for (let i = 0; i < 5; i++) {
    const z = -0.2 - i * 0.017;
    P.add('metal', cyl(0.034 - i * 0.002, 0.034 - i * 0.002, 0.004, 20), M(0, 0.006, z, Math.PI / 2, 0, 0));
  }
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2 - Math.PI / 2;
    P.add('metal', new THREE.ConeGeometry(0.006, 0.05, 6), M(Math.cos(a) * 0.022, 0.006 + Math.sin(a) * 0.022, -0.3, -Math.PI / 2 + 0.0, 0, 0).multiply(M(0, 0, 0, 0, 0, 0)));
  }
  // cryo cell cradle on the left flank
  P.add('metal', cyl(0.028, 0.028, 0.014, 16), M(-0.04, 0.022, 0.035, Math.PI / 2, 0, 0));
  P.add('metal', cyl(0.028, 0.028, 0.014, 16), M(-0.04, 0.022, -0.105, Math.PI / 2, 0, 0));
  P.add('glow', roundedBox(0.003, 0.018, 0.08, 0.002), M(0.026, 0.01, -0.03));
  g.add(...meshes(P, { shell, metal: m, dark: d, glow }));
  const cellGlass = new THREE.Mesh(capsule(0.024, 0.11, 16).rotateX(Math.PI / 2), glass('#cfefff'));
  cellGlass.position.set(-0.04, 0.022, -0.035);
  cellGlass.renderOrder = 3;
  const cellCore = new THREE.Mesh(capsule(0.011, 0.1, 10).rotateX(Math.PI / 2), glow);
  cellCore.position.copy(cellGlass.position);
  g.add(cellCore, cellGlass);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.018, 0).scale(1, 1, 2.2), vmMat(glowMat('#dff6ff', 3)));
  crystal.position.set(0, 0.006, -0.315);
  g.add(crystal);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.006, -0.34); g.add(muzzle);
  return {
    group: g, muzzle, support: new THREE.Vector3(-0.01, -0.02, -0.14),
    update(s) {
      crystal.rotation.z += s.dt * (1.2 + s.kick * 12);
      crystal.position.z = -0.315 - Math.sin(s.t * 2) * 0.003;
      const p = 0.5 + 0.5 * Math.sin(s.t * 2.2);
      glow.emissiveIntensity = 1.3 + p * 0.6 + s.kick * 4;
      cellCore.scale.set(1, 1, 0.94 + p * 0.06);
    },
  };
}

// ---------------- Tractor Beam ----------------
function buildTractor(): DeviceModel {
  const color = DEVICES.tractor.color;
  const g = new THREE.Group();
  const shell = vmMat(paintMat('#3b3452', 0.34, 0.3)), m = metal(), d = dark(), glow = vmMat(glowMat(color, 2.4));
  const P = new PartSet();
  P.add('shell', profile([[-0.1, -0.026], [-0.1, 0.04], [-0.06, 0.066], [0.08, 0.066], [0.12, 0.036], [0.12, -0.03], [0.02, -0.036]], 0.07, 0.014, 0.02));
  commonGrip(P, 0.117, 0.02);
  P.add('metal', cyl(0.036, 0.03, 0.05, 20), M(0, 0.015, -0.14, Math.PI / 2, 0, 0));
  P.add('dark', cyl(0.042, 0.042, 0.012, 20), M(0, 0.015, -0.165, Math.PI / 2, 0, 0));
  for (const s of [-1, 1]) {
    P.add('metal', cyl(0.016, 0.016, 0.14, 12), M(s * 0.046, 0.0, -0.03, Math.PI / 2, 0, 0));
    for (let i = 0; i < 3; i++) P.add('glow', torus(0.0165, 0.003, 12), M(s * 0.046, 0.0, -0.08 + i * 0.04));
  }
  P.add('glow', roundedBox(0.05, 0.006, 0.06, 0.003), M(0, 0.068, -0.0));
  g.add(...meshes(P, { shell, metal: m, dark: d, glow }));
  // gimbal rings
  const gyro = new THREE.Group(); gyro.position.set(0, 0.015, -0.085);
  const ringA = new THREE.Mesh(torus(0.056, 0.0045, 36), glow);
  const ringB = new THREE.Mesh(torus(0.064, 0.003, 36), m);
  gyro.add(ringA, ringB);
  g.add(gyro);
  // claw prongs
  const prongs: THREE.Group[] = [];
  const prongGeo = new PartSet();
  prongGeo.add('metal', roundedBox(0.012, 0.01, 0.08, 0.004), M(0, 0, -0.04));
  prongGeo.add('metal', roundedBox(0.012, 0.01, 0.03, 0.004), M(0, -0.008, -0.088, -0.5, 0, 0));
  prongGeo.add('glow', roundedBox(0.006, 0.004, 0.06, 0.002), M(0, -0.006, -0.04));
  const pMetal = prongGeo.build('metal'), pGlow = prongGeo.build('glow');
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2 + Math.PI / 2;
    const holder = new THREE.Group();
    holder.position.set(0, 0.015, -0.168);
    holder.rotation.z = a - Math.PI / 2;
    const p = new THREE.Group();
    p.position.set(0, 0.034, 0);
    p.add(new THREE.Mesh(pMetal, m), new THREE.Mesh(pGlow, glow));
    holder.add(p);
    g.add(holder);
    prongs.push(p);
  }
  const orb = new THREE.Mesh(sphere(0.018, 14, 10), vmMat(glowMat(color, 3)));
  orb.position.set(0, 0.015, -0.2);
  g.add(orb);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.015, -0.24); g.add(muzzle);
  let open = 0, spin = 0;
  return {
    group: g, muzzle, support: new THREE.Vector3(-0.014, -0.03, -0.12),
    update(s) {
      open += ((s.active ? 1 : 0) - open) * Math.min(1, s.dt * 10);
      spin += s.dt * (1 + open * 9);
      ringA.rotation.x = spin; ringB.rotation.y = spin * 0.7;
      for (const p of prongs) p.rotation.x = 0.1 + open * 0.55;
      orb.scale.setScalar(1 + open * 0.5 + Math.sin(s.t * (4 + open * 20)) * 0.08);
      glow.emissiveIntensity = 1.5 + open * 2.2 + s.kick * 3;
    },
  };
}

// ---------------- Portal Device ----------------
function buildPortal(): DeviceModel {
  const g = new THREE.Group();
  const shell = vmMat(paintMat('#ecebf2', 0.28, 0.02)), m = metal(), d = dark();
  const cyan = vmMat(glowMat(PALETTE.portalA, 2.4)), rose = vmMat(glowMat(PALETTE.portalB, 2.4));
  const coreMat = vmMat(glowMat(PALETTE.portalB, 3));
  const P = new PartSet();
  P.add('shell', lathe([[0, 0.12], [0.03, 0.115], [0.05, 0.06], [0.054, -0.02], [0.045, -0.08], [0.03, -0.1], [0, -0.1]], 24), M(0, 0.016, 0.0, -Math.PI / 2, 0, 0));
  commonGrip(P, 0.09, 0.016);
  P.add('dark', cyl(0.038, 0.038, 0.012, 24), M(0, 0.016, -0.1, Math.PI / 2, 0, 0));
  P.add('dark', cyl(0.038, 0.038, 0.012, 24), M(0, 0.016, -0.17, Math.PI / 2, 0, 0));
  for (const s of [-1, 1]) {
    P.add('metal', plate(roundedOutline([[0, 0], [0.12, 0.004], [0.15, -0.012], [0.13, -0.02], [0, -0.014]], 0.004), 0.008, 0.003).rotateY(Math.PI / 2), M(s * 0.03, 0.03, -0.17));
    P.add(s < 0 ? 'cyan' : 'rose', sphere(0.007, 10, 8), M(s * 0.03, 0.022, -0.315));
    P.add(s < 0 ? 'cyan' : 'rose', roundedBox(0.008, 0.02, 0.008, 0.003), M(s * 0.022, 0.066, 0.06));
  }
  P.add('metal', roundedBox(0.016, 0.02, 0.1, 0.006), M(0, 0.07, 0.02));
  g.add(...meshes(P, { shell, metal: m, dark: d, cyan, rose, glow: rose }));
  const chamber = new THREE.Mesh(cyl(0.032, 0.032, 0.06, 24, true).rotateX(Math.PI / 2), glass('#ffffff'));
  chamber.position.set(0, 0.016, -0.135);
  chamber.renderOrder = 3;
  const core = new THREE.Mesh(new THREE.TorusKnotGeometry(0.012, 0.0035, 48, 6, 2, 3), coreMat);
  core.position.copy(chamber.position);
  g.add(core, chamber);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, -0.32); g.add(muzzle);
  const A = new THREE.Color(PALETTE.portalA), Bc = new THREE.Color(PALETTE.portalB);
  let mix = 1;
  return {
    group: g, muzzle, support: new THREE.Vector3(-0.012, -0.03, -0.1),
    update(s) {
      mix += ((s.slot === 1 ? 1 : 0) - mix) * Math.min(1, s.dt * 8);
      coreMat.emissive.copy(A).lerp(Bc, mix); coreMat.color.copy(coreMat.emissive);
      coreMat.emissiveIntensity = 2.0 + s.kick * 4;
      core.rotation.z += s.dt * (2 + s.kick * 20);
      core.rotation.x = Math.sin(s.t * 1.3) * 0.4;
      cyan.emissiveIntensity = 0.9 + (1 - mix) * 1.6; rose.emissiveIntensity = 0.9 + mix * 1.6;
    },
  };
}

export function buildDevice(d: DeviceId): DeviceModel {
  switch (d) {
    case 'freeze': return buildFreeze();
    case 'tractor': return buildTractor();
    case 'portalgun': return buildPortal();
    default: return buildPulse();
  }
}

// ---------------- first-person hands ----------------
const UP = new THREE.Vector3(0, -1, 0);
export interface Hands { right: THREE.Group; left: THREE.Group; trim: THREE.MeshStandardMaterial; setSupport(p: THREE.Vector3): void }
export function buildHands(accent: string): Hands {
  const glove = vmMat(new THREE.MeshStandardMaterial({ color: '#23222e', roughness: 0.8, metalness: 0.05, normalMap: fabricNormalMap(), normalScale: new THREE.Vector2(0.3, 0.3) }));
  const armor = vmMat(paintMat('#9d98ae', 0.4, 0.06));
  const suit = vmMat(new THREE.MeshStandardMaterial({ color: '#3b3950', roughness: 0.82, normalMap: fabricNormalMap(), normalScale: new THREE.Vector2(0.5, 0.5) }));
  const trim = vmMat(glowMat(accent, 1.4));
  const mats = { glove, armor, suit, trim };
  // forearm (real units, along -Y from the wrist): glove cuff → armoured gauntlet → suit sleeve
  const sleeve = lathe([[0, -0.07], [0.041, -0.075], [0.047, -0.2], [0.054, -0.36], [0.056, -0.42], [0, -0.43]], 14);
  const gauntlet = lathe([[0, 0.005], [0.04, 0.0], [0.045, -0.04], [0.049, -0.14], [0.044, -0.19], [0, -0.195]], 16);
  const cuff = cyl(0.036, 0.04, 0.05, 14);
  const armFrom = (P: PartSet, wrist: THREE.Vector3, toward: THREE.Vector3) => {
    const q = new THREE.Quaternion().setFromUnitVectors(UP, toward.clone().normalize());
    const base = new THREE.Matrix4().compose(wrist, q, new THREE.Vector3(1, 1, 1));
    P.add('glove', cuff, base.clone().multiply(M(0, -0.01, 0)));
    P.add('armor', gauntlet, base.clone().multiply(M(0, -0.03, 0)));
    P.add('trim', torus(0.042, 0.005, 20), base.clone().multiply(M(0, -0.036, 0, Math.PI / 2, 0, 0)));
    P.add('trim', roundedBox(0.006, 0.09, 0.006, 0.002), base.clone().multiply(M(0.047, -0.12, 0)));
    P.add('suit', sleeve, base.clone().multiply(M(0, -0.13, 0)));
  };

  // right hand: fist around the grip, forearm runs back-down-right out of frame
  const R = new PartSet();
  R.add('glove', roundedBox(0.056, 0.08, 0.07, 0.022), M(0.008, -0.07, 0.066, 0.32, 0, 0));
  for (let i = 0; i < 4; i++) R.add('glove', capsule(0.0105, 0.03, 8), M(-0.006, -0.04 - i * 0.02, 0.028 - i * 0.006, 0.32, 0, Math.PI / 2).multiply(M(0, 0.004, 0)));
  R.add('glove', capsule(0.011, 0.04, 8), M(-0.022, -0.032, 0.045, -0.9, 0, -0.5));
  R.add('armor', roundedBox(0.014, 0.05, 0.05, 0.006), M(0.036, -0.07, 0.07, 0.32, 0, 0));
  armFrom(R, new THREE.Vector3(0.012, -0.108, 0.088), new THREE.Vector3(0.28, -0.7, 0.62));
  const right = new THREE.Group();
  right.add(...R.keys().map((k) => new THREE.Mesh(R.build(k), mats[k as keyof typeof mats])));

  // left hand: cradles the barrel from below, forearm toward bottom-left
  const L = new PartSet();
  L.add('glove', roundedBox(0.075, 0.03, 0.066, 0.013), M(0, -0.016, 0, 0, 0, 0.15));
  L.add('glove', roundedBox(0.03, 0.05, 0.062, 0.012), M(-0.04, 0.008, -0.004, 0, 0, -0.35));
  L.add('glove', capsule(0.01, 0.034, 8), M(0.036, 0.004, -0.02, 0, 0, 0.5));
  L.add('armor', roundedBox(0.05, 0.012, 0.05, 0.005), M(-0.004, -0.034, 0.004, 0, 0, 0.15));
  armFrom(L, new THREE.Vector3(-0.012, -0.035, 0.03), new THREE.Vector3(-0.5, -0.72, 0.45));
  const left = new THREE.Group();
  left.add(...L.keys().map((k) => new THREE.Mesh(L.build(k), mats[k as keyof typeof mats])));
  return { right, left, trim, setSupport(p) { left.position.copy(p); } };
}
