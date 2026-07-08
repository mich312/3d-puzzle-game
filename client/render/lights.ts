// Budgeted dynamic-light manager. WebGL2 forward rendering charges per-light on
// every lit fragment, so we keep a FIXED pool of real point lights and reassign
// them each frame to the highest-priority emitters near the camera. Portals,
// projectiles, muzzle flashes, lit receivers, frozen enemies etc. register a
// LightHandle (cheap data); only the top-N by score are ever real lights.
//
// This is how "every emissive surface casts light" is faked within budget — and
// it replaces the old unbounded pile of always-on PointLights.
import * as THREE from 'three';

export interface LightHandle {
  pos: THREE.Vector3;
  color: THREE.Color;
  intensity: number;    // target intensity; 0 = effectively off (skipped)
  range: number;
  priority: number;     // higher = more likely to get a real light
  _slot: number;        // index of the pool light currently serving it, or -1
}

export class DynamicLights {
  private pool: THREE.PointLight[] = [];
  private serving: (LightHandle | null)[] = [];   // handle each pool light serves
  private handles = new Set<LightHandle>();
  private budget: number;
  private maxDist = 70;

  constructor(private scene: THREE.Scene, budget: number) {
    this.budget = budget;
    this.grow(budget);
  }

  private grow(n: number) {
    while (this.pool.length < n) {
      const l = new THREE.PointLight(0xffffff, 0, 12, 1.6);
      l.castShadow = false;
      this.scene.add(l);
      this.pool.push(l);
      this.serving.push(null);
    }
  }

  setBudget(n: number) {
    this.budget = n;
    this.grow(n);
    // extinguish pool lights above the new budget
    for (let i = n; i < this.pool.length; i++) {
      this.pool[i].intensity = 0;
      const h = this.serving[i];
      if (h) h._slot = -1;
      this.serving[i] = null;
    }
  }

  register(color: string | number, opts: Partial<Pick<LightHandle, 'intensity' | 'range' | 'priority'>> = {}): LightHandle {
    const h: LightHandle = {
      pos: new THREE.Vector3(),
      color: new THREE.Color(color),
      intensity: opts.intensity ?? 1,
      range: opts.range ?? 10,
      priority: opts.priority ?? 1,
      _slot: -1,
    };
    this.handles.add(h);
    return h;
  }

  unregister(h: LightHandle) {
    this.handles.delete(h);
    if (h._slot >= 0) { this.pool[h._slot].intensity = 0; this.serving[h._slot] = null; h._slot = -1; }
  }

  clear() {
    for (const h of this.handles) h._slot = -1;
    this.handles.clear();
    for (let i = 0; i < this.pool.length; i++) { this.pool[i].intensity = 0; this.serving[i] = null; }
  }

  update(dt: number, camera: THREE.Vector3) {
    // score every live emitter: priority, decayed by distance; skip dark/far ones
    const scored: { h: LightHandle; score: number }[] = [];
    for (const h of this.handles) {
      if (h.intensity <= 0.01) { if (h._slot >= 0) this.releaseSlot(h); continue; }
      const d = h.pos.distanceTo(camera);
      if (d > this.maxDist) { if (h._slot >= 0) this.releaseSlot(h); continue; }
      scored.push({ h, score: h.priority * 100 - d });
    }
    scored.sort((a, b) => b.score - a.score);
    const chosen = scored.slice(0, this.budget).map((s) => s.h);
    const chosenSet = new Set(chosen);

    // drop handles that fell out of the top-N
    for (let i = 0; i < this.budget; i++) {
      const h = this.serving[i];
      if (h && !chosenSet.has(h)) this.releaseSlot(h);
    }
    // assign free slots to chosen handles that lack one
    for (const h of chosen) {
      if (h._slot >= 0) continue;
      const slot = this.serving.findIndex((s, i) => i < this.budget && s === null);
      if (slot < 0) break;
      h._slot = slot;
      this.serving[slot] = h;
      // snap colour on (re)assign — intensity lerps up from 0 so the pop is hidden
      this.pool[slot].color.copy(h.color);
      this.pool[slot].intensity = 0;
    }
    // drive the real lights toward their handle's state
    const k = Math.min(1, dt * 10);
    for (let i = 0; i < this.budget; i++) {
      const l = this.pool[i];
      const h = this.serving[i];
      if (!h) { l.intensity = THREE.MathUtils.lerp(l.intensity, 0, k); continue; }
      l.position.copy(h.pos);
      l.color.lerp(h.color, k);
      l.distance = h.range;
      l.intensity = THREE.MathUtils.lerp(l.intensity, h.intensity, k);
    }
  }

  private releaseSlot(h: LightHandle) {
    if (h._slot < 0) return;
    this.serving[h._slot] = null;
    // leave the pool light to fade out in update(); mark free by clearing serving
    h._slot = -1;
  }
}
