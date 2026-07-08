// Snapshot interpolation for replicated entities (bodies, enemies, remote players).
// The server ticks at 20 Hz; rendering at 60+ Hz needs smooth in-between states.
// Each entity keeps a short history and is rendered ~120 ms in the past, lerping
// between surrounding snapshots, with capped extrapolation across gaps.
import * as THREE from 'three';
import type { Vec3 } from '../shared/level';

const RENDER_DELAY_MS = 120;
const MAX_EXTRAPOLATE_MS = 200;
const HISTORY_MS = 1000;

interface Snap {
  t: number;
  p: THREE.Vector3;
  yaw: number;
}

export class Interpolator {
  private buf: Snap[] = [];
  /** estimated velocity (m/s) of the newest segment — drives tumble/trail VFX */
  readonly velocity = new THREE.Vector3();

  push(p: Vec3, yaw = 0) {
    const now = performance.now();
    const snap: Snap = { t: now, p: new THREE.Vector3(...p), yaw };
    const last = this.buf[this.buf.length - 1];
    // teleports (portals, resets) shouldn't interpolate: clear history on big jumps
    if (last && last.p.distanceTo(snap.p) > 8) this.buf.length = 0;
    this.buf.push(snap);
    while (this.buf.length > 2 && this.buf[0].t < now - HISTORY_MS) this.buf.shift();
  }

  /** sample the smoothed state; writes into out. Returns false if no data yet. */
  sample(out: THREE.Vector3): { yaw: number } | false {
    if (this.buf.length === 0) return false;
    const target = performance.now() - RENDER_DELAY_MS;
    // find the segment [a, b] around target
    let a = this.buf[0];
    let b = this.buf[this.buf.length - 1];
    for (let i = this.buf.length - 1; i >= 0; i--) {
      if (this.buf[i].t <= target) {
        a = this.buf[i];
        b = this.buf[Math.min(i + 1, this.buf.length - 1)];
        break;
      }
    }
    if (a === b || b.t <= a.t) {
      // beyond newest snapshot: extrapolate a little, then hold
      const newest = this.buf[this.buf.length - 1];
      const prev = this.buf[this.buf.length - 2];
      if (prev && newest.t > prev.t) {
        const dtSeg = (newest.t - prev.t) / 1000;
        this.velocity.copy(newest.p).sub(prev.p).divideScalar(dtSeg);
        const ahead = Math.min(MAX_EXTRAPOLATE_MS, target - newest.t) / 1000;
        out.copy(newest.p).addScaledVector(this.velocity, Math.max(0, ahead));
      } else {
        out.copy(newest.p);
        this.velocity.set(0, 0, 0);
      }
      return { yaw: newest.yaw };
    }
    const f = (target - a.t) / (b.t - a.t);
    out.copy(a.p).lerp(b.p, f);
    this.velocity.copy(b.p).sub(a.p).divideScalar((b.t - a.t) / 1000);
    // shortest-arc yaw lerp
    let dy = b.yaw - a.yaw;
    dy = ((dy + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    return { yaw: a.yaw + dy * f };
  }

  clear() { this.buf.length = 0; this.velocity.set(0, 0, 0); }
}
