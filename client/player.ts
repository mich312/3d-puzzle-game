// First-person kinematic character controller: WASD + mouse-look, jump,
// auto-step, AABB collision against the shared collider set. Client-reported
// movement (spec §6) — the server sanity-checks and owns everything else.
import * as THREE from 'three';
import { footprintHits, roundHalfExtent, type AABB } from '../shared/collision';
import type { Vec3 } from '../shared/level';

const PLAYER_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.4;
const EYE = 1.55;
const WALK = 6;
const JUMP_V = 7.2;
const GRAVITY = 20;
const STEP = 0.55;
const COYOTE_MS = 120;       // grace window: jump still fires just after leaving a ledge

export class PlayerController {
  pos = new THREE.Vector3(0, 1, 0);      // feet
  vel = new THREE.Vector3();
  yaw = 0; pitch = 0;
  onGround = false;
  lastGroundedAt = 0;
  jumpsUsed = 0;
  canDoubleJump = false;
  canDash = false;
  dashUntil = 0;
  dashCooldownUntil = 0;
  frozen = false;                          // downed / menus
  sensitivity = 1;
  /** external horizontal push (conveyors etc.) — set each frame by the caller */
  external = new THREE.Vector3();

  private keys = new Set<string>();
  private jumpQueued = false;
  private dashQueued = false;

  constructor(private getColliders: () => AABB[]) {}

  attach(canvas: HTMLCanvasElement) {
    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.jumpQueued = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.dashQueued = true;
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      this.yaw -= e.movementX * 0.0022 * this.sensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0022 * this.sensitivity, -1.45, 1.45);
    });
    addEventListener('blur', () => this.keys.clear());
  }

  teleport(p: Vec3, yaw?: number) {
    this.pos.set(...p);
    this.vel.set(0, 0, 0);
    if (yaw !== undefined) this.yaw = yaw;
  }

  /** matches a camera with rotation order YXZ (rotation.y=yaw, rotation.x=pitch) */
  forward(): THREE.Vector3 {
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  eye(): THREE.Vector3 { return this.pos.clone().add(new THREE.Vector3(0, EYE, 0)); }

  /** true while dashing (i-frames server-side would go here; client visual only) */
  get dashing() { return performance.now() < this.dashUntil; }

  update(dt: number) {
    if (this.frozen) { this.jumpQueued = false; this.dashQueued = false; return; }
    const now = performance.now();

    // input direction in yaw space
    let ix = 0, iz = 0;
    if (this.keys.has('KeyW')) iz -= 1;
    if (this.keys.has('KeyS')) iz += 1;
    if (this.keys.has('KeyA')) ix -= 1;
    if (this.keys.has('KeyD')) ix += 1;
    const len = Math.hypot(ix, iz) || 1;
    ix /= len; iz /= len;
    // forward is -Z at yaw 0: right=(cos,0,-sin), forward=(-sin,0,-cos)
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = ix * cos + iz * sin;
    const wz = -ix * sin + iz * cos;

    let speed = WALK;
    if (this.dashQueued && this.canDash && now > this.dashCooldownUntil) {
      this.dashUntil = now + 180;
      this.dashCooldownUntil = now + 3000;
    }
    this.dashQueued = false;
    if (this.dashing) speed = WALK * 3.2;

    this.vel.x = wx * speed + this.external.x;
    this.vel.z = wz * speed + this.external.z;

    // jumping (with coyote time — stepping off a ledge shouldn't eat the input)
    if (this.jumpQueued) {
      const coyote = !this.onGround && this.jumpsUsed === 0 && now - this.lastGroundedAt < COYOTE_MS;
      if (this.onGround || coyote) { this.vel.y = JUMP_V; this.jumpsUsed = 1; }
      else if (this.canDoubleJump && this.jumpsUsed < 2) { this.vel.y = JUMP_V * 0.92; this.jumpsUsed = 2; }
      this.jumpQueued = false;
    }
    this.vel.y -= GRAVITY * dt;
    this.vel.y = Math.max(this.vel.y, -30);

    // integrate with axis-separated AABB collision + step-up
    const colliders = this.getColliders();
    this.moveAxis(colliders, 0, this.vel.x * dt);
    this.moveAxis(colliders, 2, this.vel.z * dt);
    this.onGround = false;
    this.moveAxisY(colliders, this.vel.y * dt);
    if (this.onGround) { this.jumpsUsed = 0; this.lastGroundedAt = now; }
  }

  private box(): { min: Vec3; max: Vec3 } {
    return {
      min: [this.pos.x - PLAYER_RADIUS, this.pos.y, this.pos.z - PLAYER_RADIUS],
      max: [this.pos.x + PLAYER_RADIUS, this.pos.y + PLAYER_HEIGHT, this.pos.z + PLAYER_RADIUS],
    };
  }

  private overlaps(b: AABB, min: Vec3, max: Vec3): boolean {
    return b.active &&
      min[0] < b.max[0] && max[0] > b.min[0] &&
      min[1] < b.max[1] && max[1] > b.min[1] &&
      min[2] < b.max[2] && max[2] > b.min[2] &&
      footprintHits(b, min[0], max[0], min[2], max[2]);   // round rims collide as circles
  }

  private moveAxis(colliders: AABB[], axis: 0 | 2, delta: number) {
    if (delta === 0) return;
    const p = [this.pos.x, this.pos.y, this.pos.z] as Vec3;
    p[axis] += delta;
    const min: Vec3 = [p[0] - PLAYER_RADIUS, p[1] + 0.02, p[2] - PLAYER_RADIUS];
    const max: Vec3 = [p[0] + PLAYER_RADIUS, p[1] + PLAYER_HEIGHT, p[2] + PLAYER_RADIUS];
    for (const b of colliders) {
      if (!this.overlaps(b, min, max)) continue;
      // try step-up
      const stepTop = b.max[1];
      if (stepTop - this.pos.y <= STEP && stepTop - this.pos.y > -0.01) {
        const min2: Vec3 = [min[0], stepTop + 0.02, min[2]];
        const max2: Vec3 = [max[0], stepTop + PLAYER_HEIGHT, max[2]];
        const blockedAbove = colliders.some((o) => this.overlaps(o, min2, max2));
        if (!blockedAbove) { this.pos.y = stepTop; continue; }
      }
      // slide: clamp against the face (round colliders clamp to the chord the
      // player's footprint actually meets, so you skim around pillars)
      const cross0 = axis === 0 ? 2 : 0;
      const half = roundHalfExtent(b, axis, min[cross0], max[cross0]);
      const faceMin = half !== null ? (axis === 0 ? b.round!.x : b.round!.z) - half : b.min[axis];
      const faceMax = half !== null ? (axis === 0 ? b.round!.x : b.round!.z) + half : b.max[axis];
      if (delta > 0) p[axis] = faceMin - PLAYER_RADIUS - 0.001;
      else p[axis] = faceMax + PLAYER_RADIUS + 0.001;
      min[axis] = p[axis] - PLAYER_RADIUS;
      max[axis] = p[axis] + PLAYER_RADIUS;
    }
    if (axis === 0) this.pos.x = p[0]; else this.pos.z = p[2];
  }

  private moveAxisY(colliders: AABB[], delta: number) {
    const newY = this.pos.y + delta;
    const min: Vec3 = [this.pos.x - PLAYER_RADIUS, newY, this.pos.z - PLAYER_RADIUS];
    const max: Vec3 = [this.pos.x + PLAYER_RADIUS, newY + PLAYER_HEIGHT, this.pos.z + PLAYER_RADIUS];
    let y = newY;
    for (const b of colliders) {
      if (!this.overlaps(b, min, max)) continue;
      if (delta <= 0 && this.pos.y >= b.max[1] - 0.25) {
        y = b.max[1]; this.vel.y = 0; this.onGround = true;
      } else if (delta > 0 && this.pos.y + PLAYER_HEIGHT <= b.min[1] + 0.25) {
        y = b.min[1] - PLAYER_HEIGHT - 0.001; this.vel.y = 0;
      }
    }
    this.pos.y = y;
  }
}
