// Shared collision vocabulary: static AABBs derived from level geometry, ray and
// volume queries. The server uses it authoritatively; the client uses the SAME code
// for movement prediction so both sides agree on what is solid.
// (Spec adjustment: custom AABB physics instead of Rapier — see SPEC-CHANGES.md.)
import type { GeometryDef, LevelDef, Vec3 } from './level';

export interface AABB {
  min: Vec3; max: Vec3;
  geoIndex: number;          // index into level.geometry
  doorId?: string;
  activeWhen?: string;
  portalSurface?: boolean;
  active: boolean;           // toggled by door/activeWhen evaluation
  /** circular XZ footprint (cylinders) — min/max stay the broad-phase box,
      but overlap/ground/slide tests respect the round rim so collision
      matches the visual instead of the circumscribing square */
  round?: { x: number; z: number; r: number };
}

export function aabbFromGeometry(g: GeometryDef, index: number): AABB | null {
  if (g.collider === false) return null;
  let [w, h, d] = g.size;
  if (g.shape === 'cylinder') { w = g.size[0] * 2; h = g.size[1]; d = g.size[2] * 2; }
  // colliders honour rotY in multiples of PI/2: odd quarter-turns swap w/d
  const q = Math.round((g.rotY ?? 0) / (Math.PI / 2)) % 2;
  if (q !== 0) [w, d] = [d, w];
  const [x, y, z] = g.pos;
  return {
    min: [x - w / 2, y - h / 2, z - d / 2],
    max: [x + w / 2, y + h / 2, z + d / 2],
    geoIndex: index,
    doorId: g.door?.id,
    activeWhen: g.activeWhen,
    portalSurface: g.portalSurface,
    active: true,
    round: g.shape === 'cylinder' ? { x, z, r: g.size[0] } : undefined,
  };
}

/** Narrow-phase for round colliders: does the XZ rect actually touch the circle?
    (Callers first pass the cheap AABB test; boxes trivially return true.) */
export function footprintHits(b: AABB, minX: number, maxX: number, minZ: number, maxZ: number): boolean {
  if (!b.round) return true;
  const { x, z, r } = b.round;
  const dx = Math.max(minX - x, 0, x - maxX);
  const dz = Math.max(minZ - z, 0, z - maxZ);
  return dx * dx + dz * dz < r * r;
}

/** Half-width of a round collider along `axis` (0=x, 2=z) at the mover's
    cross-axis interval — the chord the mover can actually hit. null = clear. */
export function roundHalfExtent(b: AABB, axis: 0 | 2, crossMin: number, crossMax: number): number | null {
  if (!b.round) return null;
  const { x, z, r } = b.round;
  const c = axis === 0 ? z : x;
  const d = Math.max(crossMin - c, 0, c - crossMax);
  if (d >= r) return null;
  return Math.sqrt(r * r - d * d);
}

export function buildColliders(level: LevelDef): AABB[] {
  const out: AABB[] = [];
  level.geometry.forEach((g, i) => {
    const b = aabbFromGeometry(g, i);
    if (b) out.push(b);
  });
  return out;
}

export const v3 = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  len: (a: Vec3) => Math.hypot(a[0], a[1], a[2]),
  dist: (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  distXZ: (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]),
  norm: (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
};

/** Ray vs active AABBs. Returns nearest hit distance + box, or null. */
export function raycast(colliders: AABB[], origin: Vec3, dir: Vec3, maxDist: number,
  filter?: (b: AABB) => boolean): { dist: number; box: AABB; normal: Vec3 } | null {
  let best: { dist: number; box: AABB; normal: Vec3 } | null = null;
  for (const b of colliders) {
    if (!b.active) continue;
    if (filter && !filter(b)) continue;
    const hit = rayAABB(origin, dir, b.min, b.max, maxDist);
    if (hit && (!best || hit.dist < best.dist)) best = { dist: hit.dist, box: b, normal: hit.normal };
  }
  return best;
}

function rayAABB(o: Vec3, d: Vec3, min: Vec3, max: Vec3, maxDist: number): { dist: number; normal: Vec3 } | null {
  let tmin = 0, tmax = maxDist;
  let axis = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return null;
    } else {
      const inv = 1 / d[i];
      let t1 = (min[i] - o[i]) * inv;
      let t2 = (max[i] - o[i]) * inv;
      let s = -1;
      if (t1 > t2) { [t1, t2] = [t2, t1]; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  if (axis < 0) return null;
  const normal: Vec3 = [0, 0, 0];
  normal[axis] = sign;
  return { dist: tmin, normal };
}

/** Highest active ground top-surface at (x,z) at or below y (+small tolerance above). */
export function groundHeight(colliders: AABB[], x: number, y: number, z: number): number | null {
  let best: number | null = null;
  for (const b of colliders) {
    if (!b.active) continue;
    if (x < b.min[0] - 0.05 || x > b.max[0] + 0.05 || z < b.min[2] - 0.05 || z > b.max[2] + 0.05) continue;
    if (b.round && Math.hypot(x - b.round.x, z - b.round.z) > b.round.r + 0.05) continue;
    const top = b.max[1];
    if (top <= y + 0.6 && (best === null || top > best)) best = top;
  }
  return best;
}

/** Is point inside any active collider (for portal-surface checks etc.)? */
export function pointNearBox(b: AABB, p: Vec3, tol: number): boolean {
  return p[0] > b.min[0] - tol && p[0] < b.max[0] + tol &&
         p[1] > b.min[1] - tol && p[1] < b.max[1] + tol &&
         p[2] > b.min[2] - tol && p[2] < b.max[2] + tol;
}

/** Segment clear of active colliders (for beams / LOS)? Excludes boxes via filter. */
export function segmentClear(colliders: AABB[], a: Vec3, b: Vec3, filter?: (x: AABB) => boolean): boolean {
  const d = v3.sub(b, a);
  const len = v3.len(d);
  if (len < 1e-6) return true;
  const dir = v3.scale(d, 1 / len);
  const hit = raycast(colliders, a, dir, len - 0.05, filter);
  return hit === null;
}
