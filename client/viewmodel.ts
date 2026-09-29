// First-person viewmodel: gloved hands holding a detailed per-device model
// (client/models/devices.ts), with spring-driven motion — equip swap, walk bob,
// look sway, recoil kick with recovery, landing dip, idle breathing, charge
// tremble. Emissive-only (no real lights: changing the light count recompiles
// every lit shader), and depth-squashed so it never clips into walls.
import * as THREE from 'three';
import type { DeviceId } from '../shared/devices';
import { buildDevice, buildHands, type DeviceModel, type Hands } from './models/devices';
import { damp } from './models/common';

export interface ViewmodelOpts {
  charge?: number;        // 0..1 charged-pulse hold
  tractor?: boolean;      // tractor beam channeling
  portalSlot?: 0 | 1;     // last portal slot fired (portal device colour state)
  speed?: number;         // planar speed (m/s) for bob amplitude
}

const BASE = new THREE.Vector3(0.2, -0.18, -0.48);
const SCALE = 0.68;

/** critically-damped-ish spring on a scalar */
class Spring {
  x = 0; v = 0;
  constructor(private k: number, private zeta: number) {}
  step(target: number, dt: number) {
    const c = 2 * Math.sqrt(this.k) * this.zeta;
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-this.k * (this.x - target) - c * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

export class Viewmodel {
  group = new THREE.Group();
  private rig = new THREE.Group();          // sway / bob / recoil
  private devices = new Map<DeviceId, DeviceModel>();
  private hands: Hands;
  private current: DeviceModel;
  private device: DeviceId = 'pulse';
  private pending: DeviceId | null = null;
  private swap = 0;                          // 0 = raised, 1 = fully lowered
  private swapDir = 0;                       // +1 lowering, -1 raising
  private time = 0;
  private kickAmt = 0;
  private slot: 0 | 1 = 0;
  private accent = '';
  private bobPhase = 0;
  private bobAmp = 0;
  private wasGrounded = true;
  private prevYaw = 0; private prevPitch = 0; private first = true;
  // springs
  private recoilZ = new Spring(260, 0.55);
  private recoilX = new Spring(220, 0.5);
  private swayX = new Spring(90, 0.7);
  private swayY = new Spring(90, 0.7);
  private swayRoll = new Spring(80, 0.6);
  private land = new Spring(160, 0.45);

  constructor(private camera: THREE.Camera) {
    this.hands = buildHands('#6ec6ff');
    this.rig.add(this.hands.right, this.hands.left);
    this.group.add(this.rig);
    this.group.position.copy(BASE);
    this.group.scale.setScalar(SCALE);
    this.group.rotation.set(0.04, 0.13, 0);
    // build every device up front so the first swap to each doesn't hitch on geometry
    for (const d of ['freeze', 'tractor', 'portalgun'] as DeviceId[]) this.ensure(d);
    this.current = this.ensure('pulse');
    this.current.group.visible = true;
    this.hands.setSupport(this.current.support);
    for (const o of [this.group]) o.traverse((m) => { (m as THREE.Mesh).castShadow = false; (m as THREE.Mesh).receiveShadow = false; });
    camera.add(this.group);
  }

  private ensure(d: DeviceId): DeviceModel {
    let m = this.devices.get(d);
    if (!m) {
      m = buildDevice(d);
      m.group.visible = false;
      m.group.traverse((o) => { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; });
      this.rig.add(m.group);
      this.devices.set(d, m);
    }
    return m;
  }

  setDevice(d: DeviceId) {
    if (d === (this.pending ?? this.device)) return;
    this.pending = d;
    this.swapDir = 1;
  }

  setAccent(hex: string) {
    if (hex === this.accent) return;
    this.accent = hex;
    this.hands.trim.color.set(hex);
    this.hands.trim.emissive.set(hex);
  }

  /** fire recoil; `slot` marks which portal colour was placed */
  kick(slot?: 0 | 1) {
    this.kickAmt = 1;
    if (slot !== undefined) this.slot = slot;
    const heavy = this.device === 'pulse' ? 1 : this.device === 'freeze' ? 0.8 : 0.55;
    this.recoilZ.v += 1.5 * heavy;
    this.recoilX.v += 8 * heavy;
    this.swayRoll.v += (Math.random() - 0.5) * 2;
  }

  /** world-space muzzle position for tracer starts */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    this.group.updateWorldMatrix(true, true);
    this.current.muzzle.getWorldPosition(out);
    return out;
  }

  update(dt: number, moving: boolean, grounded: boolean, opts: ViewmodelOpts = {}) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    const t = this.time;
    this.kickAmt = Math.max(0, this.kickAmt - dt * 5);

    // ---- equip swap: lower → switch model → raise ----
    if (this.swapDir > 0) {
      this.swap = Math.min(1, this.swap + dt / 0.16);
      if (this.swap >= 1 && this.pending) {
        this.current.group.visible = false;
        this.device = this.pending; this.pending = null;
        this.current = this.ensure(this.device);
        this.current.group.visible = true;
        this.hands.setSupport(this.current.support);
        this.swapDir = -1;
      }
    } else if (this.swapDir < 0) {
      this.swap = Math.max(0, this.swap - dt / 0.26);
      if (this.swap <= 0) this.swapDir = 0;
    }
    const sw = this.swap * this.swap * (3 - 2 * this.swap);

    // ---- look sway from camera angular velocity ----
    const cam = this.camera as THREE.PerspectiveCamera;
    const yaw = cam.rotation.y, pitch = cam.rotation.x;
    if (this.first) { this.prevYaw = yaw; this.prevPitch = pitch; this.first = false; }
    let dyaw = yaw - this.prevYaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const dpitch = pitch - this.prevPitch;
    this.prevYaw = yaw; this.prevPitch = pitch;
    const yawVel = THREE.MathUtils.clamp(dyaw / Math.max(dt, 1e-3), -8, 8);
    const pitchVel = THREE.MathUtils.clamp(dpitch / Math.max(dt, 1e-3), -8, 8);
    const sx = this.swayX.step(yawVel * 0.006, dt);
    const sy = this.swayY.step(-pitchVel * 0.005, dt);
    const roll = this.swayRoll.step(yawVel * 0.02, dt);

    // ---- bob (figure-eight), breathing, landing dip ----
    const speed = opts.speed ?? (moving ? 6 : 0);
    const bobTarget = moving && grounded ? Math.min(1, speed / 6) : 0;
    this.bobAmp += (bobTarget - this.bobAmp) * damp(8, dt);
    this.bobPhase += dt * (5 + speed * 0.9) * (this.bobAmp > 0.01 ? 1 : 0);
    const bx = Math.sin(this.bobPhase) * 0.011 * this.bobAmp;
    const by = -Math.abs(Math.cos(this.bobPhase)) * 0.012 * this.bobAmp;
    const breathe = Math.sin(t * 1.7) * 0.0035 * (1 - this.bobAmp);
    if (grounded && !this.wasGrounded) this.land.v -= 0.5;
    this.wasGrounded = grounded;
    const ld = this.land.step(grounded ? 0 : 0.012, dt);

    // ---- recoil springs ----
    const rz = this.recoilZ.step(0, dt);
    const rx = this.recoilX.step(0, dt);

    // charge tremble / tractor hum
    const charge = opts.charge ?? 0;
    const trem = charge * 0.0025 + (opts.tractor ? 0.0012 : 0);
    const jx = (Math.sin(t * 71) + Math.sin(t * 53)) * trem, jy = (Math.sin(t * 67) + Math.cos(t * 59)) * trem;

    this.rig.position.set(
      -sx + bx + jx,
      sy + by + breathe + ld - sw * 0.24 + jy,
      rz * 0.06 + charge * 0.015);
    this.rig.rotation.set(
      rx * 0.06 + Math.sin(t * 1.7) * 0.004 - sw * 0.9 - sy * 1.5 + charge * 0.03,
      sx * 1.2,
      roll * 0.5 + Math.sin(this.bobPhase) * 0.02 * this.bobAmp + sw * 0.35);

    this.current.update({ t, dt, charge, active: !!opts.tractor, kick: this.kickAmt, slot: opts.portalSlot ?? this.slot });
  }
}
