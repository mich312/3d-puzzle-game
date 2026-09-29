// Interactable / set-piece models (visual only). Positions, names and state hooks
// match what World.update() animates:
//   plate: 'top' (+ 'glow')           lever/rotator: 'handle' (+ 'ring')
//   switch: 'eye'                     carryable: 'body' > 'core'
//   collectible/socket/resonator: 'gem'   receiver: 'orb'   scale: 'arm' > 'panL'/'panR'
// Gold (#ffd98a) marks everything usable. Small glowing accents sit at 1.5–2.5
// emissive; nothing large glows hot.
import * as THREE from 'three';
import type { GeometryDef, InteractableDef } from '../../shared/level';
import { PALETTE } from '../../shared/palette';
import { getMaterial } from './materials';
import { markShared } from './dispose';
import { roundedBox, bevelCylinder, finalize, mergeAll } from './geometry';

const shared = new Map<string, THREE.Material>();
function glow(color: string, intensity: number): THREE.MeshStandardMaterial {
  const key = `glow|${color}|${intensity}`;
  let m = shared.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = markShared(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.35, metalness: 0 }));
    shared.set(key, m);
  }
  return m;
}
/** unique (state-animated) emissive material */
export function ownGlow(color: string, intensity: number, base = color): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: base, emissive: color, emissiveIntensity: intensity, roughness: 0.3, metalness: 0.1 });
}
const gunmetal = () => getMaterial('metal', '#5e5a7a');
const steel = () => getMaterial('metal', '#b8b4cc');
const gold = () => getMaterial('accent', undefined, PALETTE.interactable, 0.28);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, cast = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast; m.receiveShadow = true;
  return m;
}
const box = (w: number, h: number, d: number, r = Math.min(w, h, d) * 0.18) => roundedBox(w, h, d, r, 1);
const cyl = (r: number, h: number, radial = 20, bevel = Math.min(r, h) * 0.2) => bevelCylinder(r, h, bevel, radial, 1);

// ---------------------------------------------------------------- plate
export function plateModel(size: [number, number, number]): THREE.Group {
  const g = new THREE.Group();
  const sx = size[0], sz = size[2];
  g.add(mesh(box(sx + 0.44, 0.12, sz + 0.44, 0.04), gunmetal(), 0, 0.06, 0));
  // bevelled bezel with corner bolts
  g.add(mesh(box(sx + 0.16, 0.05, sz + 0.16, 0.02), steel(), 0, 0.14, 0));
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    g.add(mesh(cyl(0.06, 0.05, 10), gold(), x * (sx / 2 + 0.12), 0.145, z * (sz / 2 + 0.12)));
  }
  const top = new THREE.Group(); top.name = 'top'; top.position.y = 0.2;
  top.add(mesh(box(sx, 0.16, sz, 0.04), gold()));
  // glowing inset frame (own material → brightens when pressed)
  const gm = ownGlow(PALETTE.interactable, 1.0);
  const inset = 0.22, wStrip = 0.06;
  const strips: [number, number, number, number][] = [
    [sx - inset * 2, wStrip, 0, sz / 2 - inset], [sx - inset * 2, wStrip, 0, -(sz / 2 - inset)],
    [wStrip, sz - inset * 2, sx / 2 - inset, 0], [wStrip, sz - inset * 2, -(sx / 2 - inset), 0],
  ];
  const gl = new THREE.Group(); gl.name = 'glow';
  for (const [w, d, x, z] of strips) gl.add(mesh(new THREE.BoxGeometry(w, 0.012, d), gm, x, 0.082, z, false));
  // centre sigil
  const sig = mesh(new THREE.RingGeometry(0.16, 0.22, 24), gm, 0, 0.083, 0, false);
  sig.rotation.x = -Math.PI / 2;
  gl.add(sig);
  gl.userData.mat = gm;
  top.add(gl);
  g.add(top);
  return g;
}

// ---------------------------------------------------------------- lever / rotator
export function leverModel(rotator: boolean, states: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(cyl(0.34, 0.12, 20), gunmetal(), 0, 0.06, 0));
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.19, 0.86, 8), gunmetal());
  col.position.y = 0.55; col.castShadow = true; g.add(col);
  g.add(mesh(cyl(0.2, 0.06, 16), gold(), 0, 0.15, 0));
  g.add(mesh(cyl(0.17, 0.05, 16), gold(), 0, 0.94, 0));
  const handle = new THREE.Group(); handle.name = 'handle'; handle.position.y = 1.0;
  if (!rotator) {
    const hub = mesh(cyl(0.12, 0.34, 16), steel()); hub.rotation.z = Math.PI / 2; handle.add(hub);
    handle.add(mesh(cyl(0.045, 0.72, 10), steel(), 0, 0.38, 0));
    handle.add(mesh(new THREE.SphereGeometry(0.1, 16, 12), glow(PALETTE.interactable, 1.8), 0, 0.8, 0));
    handle.add(mesh(cyl(0.07, 0.05, 12), gold(), 0, 0.68, 0));
  } else {
    // handwheel on top + glowing pointer
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.04, 8, 32), gold());
    wheel.rotation.x = -Math.PI / 2; wheel.position.y = 0.12; wheel.castShadow = true;
    handle.add(wheel);
    for (let i = 0; i < 4; i++) {
      const sp = mesh(new THREE.BoxGeometry(0.66, 0.035, 0.035), steel(), 0, 0.12, 0);
      sp.rotation.y = (i / 4) * Math.PI; handle.add(sp);
    }
    handle.add(mesh(cyl(0.08, 0.14, 12), steel(), 0, 0.1, 0));
    const ptr = mesh(new THREE.ConeGeometry(0.07, 0.24, 4), glow(PALETTE.interactable, 1.8), 0, 0.12, 0.44);
    ptr.rotation.x = Math.PI / 2; handle.add(ptr);
  }
  g.add(handle);
  if (rotator) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.045, 8, 48), gold());
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; ring.name = 'ring';
    g.add(ring);
    for (let i = 0; i < states; i++) {
      const a = (i / states) * Math.PI * 2;
      const tick = mesh(new THREE.BoxGeometry(0.06, 0.03, 0.18), glow(PALETTE.interactable, 1.5), Math.sin(a) * 0.72, 0.07, Math.cos(a) * 0.72, false);
      tick.rotation.y = a; g.add(tick);
    }
  }
  return g;
}

// ---------------------------------------------------------------- switch (pulse target)
export function switchModel(): THREE.Group {
  const g = new THREE.Group();
  const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.12, 32), ownGlow(PALETTE.interactable, 0.3, '#8a7650'));
  eye.rotation.x = Math.PI / 2; eye.name = 'eye';
  g.add(eye);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.075, 10, 40), gunmetal());
  bezel.castShadow = true; g.add(bezel);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.018, 6, 32), gold());
  inner.position.z = 0.065; g.add(inner);
  const inner2 = inner.clone(); inner2.position.z = -0.065; g.add(inner2);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const stud = mesh(box(0.12, 0.12, 0.2, 0.03), gold(), Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0);
    stud.rotation.z = a; g.add(stud);
  }
  return g;
}

// ---------------------------------------------------------------- carryables
export function crateModel(heavy: boolean, kind?: string): THREE.Group {
  const s = heavy ? 1.1 : 0.6;
  const body = new THREE.Group(); body.name = 'body';
  const coreMat = ownGlow(PALETTE.interactable, 1.3);
  if (kind === 'prism') {
    // crystal prism caged in a gold frame; the crystal itself is the glowing core
    const prism = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.34, s * 0.34, s * 0.78, 3),
      new THREE.MeshStandardMaterial({ color: '#dff4ff', emissive: PALETTE.portalA, emissiveIntensity: 0.9, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.9 }));
    prism.name = 'core'; prism.castShadow = true;
    body.add(prism);
    for (const y of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.46, s * 0.46, s * 0.1, 3), gold());
      cap.position.y = y * s * 0.44; cap.castShadow = true; body.add(cap);
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      body.add(mesh(cyl(0.025, s * 0.8, 8), gunmetal(), Math.sin(a) * s * 0.4, 0, Math.cos(a) * s * 0.4));
    }
    return wrap(body);
  }
  // sci-fi crate: dark bevelled shell, inset panels, gold edge frame, glowing core windows
  body.add(mesh(box(s * 0.94, s * 0.94, s * 0.94, s * 0.08), heavy ? getMaterial('stone', '#8e88a4') : gunmetal()));
  const bar = s * 0.12, L = s;
  const frame = heavy ? gold() : steel();
  for (const ax of [0, 1, 2]) {
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const p = [0, 0, 0]; const dims = [bar, bar, bar];
      dims[ax] = L;
      const o = [0, 1, 2].filter((k) => k !== ax);
      p[o[0]] = a * (s / 2 - bar / 2); p[o[1]] = b * (s / 2 - bar / 2);
      body.add(mesh(box(dims[0], dims[1], dims[2], bar * 0.3), frame, p[0], p[1], p[2]));
    }
  }
  // panels + core windows on all six faces, merged into ONE glowing 'core' mesh
  const panelMat = heavy ? getMaterial('metal', '#6a6488') : gold();
  const winGeos: THREE.BufferGeometry[] = [];
  const faces: [number, number][] = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
  for (const [ax, sg] of faces) {
    const dims = [s * 0.66, s * 0.66, s * 0.66]; dims[ax] = s * 0.05;
    const pos = [0, 0, 0]; pos[ax] = sg * (s / 2 - s * 0.03);
    body.add(mesh(box(dims[0], dims[1], dims[2], s * 0.015), panelMat, pos[0], pos[1], pos[2]));
    const wd = heavy ? [s * 0.5, s * 0.08, s * 0.5] : [s * 0.26, s * 0.26, s * 0.26];
    wd[ax] = s * 0.02;
    const wp = [0, 0, 0]; wp[ax] = sg * (s / 2 - s * 0.003);
    const wg = new THREE.BoxGeometry(wd[0], wd[1], wd[2]);
    if (heavy && ax === 1) wg.rotateY(Math.PI / 4);
    wg.translate(wp[0], wp[1], wp[2]);
    winGeos.push(wg);
  }
  const merged = mergeSimple(winGeos);
  const core = new THREE.Mesh(merged, coreMat); core.name = 'core';
  body.add(core);
  return wrap(body);
}
function wrap(body: THREE.Group): THREE.Group { const g = new THREE.Group(); g.add(body); return g; }
function mergeSimple(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // tiny local merge (BoxGeometry parts share one layout)
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  let off = 0;
  for (const g of list) {
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)); }
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + off);
    off += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setIndex(idx);
  return out;
}

// ---------------------------------------------------------------- collectible
export function collectibleModel(): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.OctahedronGeometry(0.3, 0); geo.scale(1, 1.45, 1);
  const gem = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: '#ffe7b0', emissive: PALETTE.interactable, emissiveIntensity: 1.4, roughness: 0.12, metalness: 0.2, flatShading: true,
  }));
  gem.name = 'gem';
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.012, 6, 40), glow(PALETTE.interactable, 1.6));
  halo.rotation.x = Math.PI / 2.4;
  gem.add(halo);
  g.add(gem);
  return g;
}

// ---------------------------------------------------------------- socket
export function socketModel(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(cyl(0.55, 0.16, 24), gunmetal(), 0, 0.08, 0));
  g.add(mesh(cyl(0.42, 0.08, 24), steel(), 0, 0.2, 0));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.05, 8, 32), gold());
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.24; g.add(ring);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const prong = mesh(box(0.07, 0.42, 0.07, 0.02), gold(), Math.sin(a) * 0.34, 0.42, Math.cos(a) * 0.34);
    prong.rotation.set(Math.cos(a) * -0.35, 0, Math.sin(a) * 0.35);
    g.add(prong);
  }
  g.add(mesh(new THREE.CircleGeometry(0.2, 24).rotateX(-Math.PI / 2), glow(PALETTE.success, 1.2), 0, 0.245, 0, false));
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), ownGlow(PALETTE.success, 1.4, '#d8ffe8'));
  gem.position.y = 0.55; gem.name = 'gem'; gem.visible = false;
  g.add(gem);
  return g;
}

// ---------------------------------------------------------------- emitter / receiver
export function emitterModel(dir: [number, number, number], color: string): THREE.Group {
  const g = new THREE.Group();
  const aim = new THREE.Group();
  aim.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize());
  aim.add(mesh(cyl(0.24, 0.5, 20), gunmetal(), 0, -0.12, 0));
  aim.add(mesh(cyl(0.27, 0.08, 20), gold(), 0, 0.1, 0));
  aim.add(mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.12, 20), steel(), 0, 0.18, 0));
  const lens = mesh(new THREE.CircleGeometry(0.14, 24).rotateX(-Math.PI / 2), glow(color, 2.2), 0, 0.241, 0, false);
  aim.add(lens);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const fin = mesh(box(0.05, 0.4, 0.16, 0.015), steel(), Math.sin(a) * 0.26, -0.15, Math.cos(a) * 0.26);
    fin.rotation.y = a; aim.add(fin);
  }
  g.add(aim);
  return g;
}

export function receiverModel(): THREE.Group {
  const g = new THREE.Group();
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 16),
    new THREE.MeshStandardMaterial({ color: '#4a4c66', emissive: '#222436', emissiveIntensity: 1, roughness: 0.15, metalness: 0.2 }));
  orb.name = 'orb';
  g.add(orb);
  for (const rot of [0, Math.PI / 2]) {
    const cradle = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.035, 8, 36, Math.PI * 1.3), gold());
    cradle.rotation.set(0, rot, Math.PI * 0.85);   // arc opens upward (Rz first, then Ry)
    cradle.castShadow = true;
    g.add(cradle);
  }
  g.add(mesh(cyl(0.12, 0.2, 12), gunmetal(), 0, -0.42, 0));
  g.add(mesh(cyl(0.22, 0.06, 16), steel(), 0, -0.33, 0));
  return g;
}

// ---------------------------------------------------------------- scale
export function scaleModel(span: number, rotY?: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(cyl(0.42, 0.14, 20), gunmetal(), 0, 0.07, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.2, 1.1, 8), gunmetal(), 0, 0.68, 0));
  const arm = new THREE.Group(); arm.name = 'arm'; arm.position.y = 1.25;
  if (rotY) arm.rotation.y = rotY;
  arm.add(mesh(box(span + 0.6, 0.12, 0.2, 0.04), steel()));
  const hub = mesh(cyl(0.16, 0.3, 16), gold()); hub.rotation.x = Math.PI / 2; arm.add(hub);
  for (const side of [-1, 1] as const) {
    const pan = new THREE.Group(); pan.name = side < 0 ? 'panL' : 'panR';
    pan.position.x = side * span / 2;
    pan.add(mesh(new THREE.SphereGeometry(0.06, 10, 8), gold(), 0, -0.02, 0));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const tx = Math.sin(a) * 0.95, tz = Math.cos(a) * 0.95;
      const len = Math.hypot(tx, 1.0, tz);
      const chain = mesh(cyl(0.015, len, 6), gunmetal(), tx / 2, -0.5, tz / 2, false);
      chain.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-tx, 1.0, -tz).normalize());
      pan.add(chain);
    }
    pan.add(mesh(cyl(1.12, 0.12, 32, 0.04), gold(), 0, -1.05, 0));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.04, 8, 48), steel());
    rim.rotation.x = -Math.PI / 2; rim.position.y = -0.98; pan.add(rim);
    arm.add(pan);
  }
  g.add(arm);
  return g;
}

// ---------------------------------------------------------------- resonator
export function resonatorModel(order: number): THREE.Group {
  const g = new THREE.Group();
  // fluted pillar: 12-sided with alternating radius
  const fl = new THREE.CylinderGeometry(0.3, 0.36, 1.7, 16, 1);
  const p = fl.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 - 0.07 * (0.5 + 0.5 * Math.cos(a * 8));
    if (Math.hypot(x, z) > 0.01) p.setXYZ(i, x * k, p.getY(i), z * k);
  }
  fl.computeVertexNormals();
  const pillar = mesh(fl, getMaterial('stone'), 0, 0.85, 0);
  g.add(pillar);
  g.add(mesh(cyl(0.44, 0.14, 20), getMaterial('stone'), 0, 0.07, 0));
  g.add(mesh(cyl(0.38, 0.07, 20), gold(), 0, 0.3, 0));
  g.add(mesh(cyl(0.36, 0.1, 20), gold(), 0, 1.66, 0));
  const cup = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 8, 24), gold());
  cup.rotation.x = -Math.PI / 2; cup.position.y = 1.75; g.add(cup);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), new THREE.MeshStandardMaterial({
    color: '#6a648a', emissive: '#2a2740', emissiveIntensity: 1, roughness: 0.15, metalness: 0.1, flatShading: true,
  }));
  gem.position.y = 2.0; gem.name = 'gem';
  g.add(gem);
  for (let i = 0; i <= order; i++) {
    g.add(mesh(box(0.34, 0.05, 0.08, 0.015), glow(PALETTE.interactable, 1.6), 0, 0.45 + i * 0.16, -0.36, false));
  }
  return g;
}

// ---------------------------------------------------------------- doors
/** Paneled door: full-thickness frame + recessed centre panel + energy seam (own material). */
export function doorModel(g: GeometryDef, mat: THREE.Material): { group: THREE.Group; seam: THREE.MeshStandardMaterial } {
  const grp = new THREE.Group();
  const [W0, H, D0] = g.size;
  const thinX = W0 < D0;
  const W = thinX ? D0 : W0, T = thinX ? W0 : D0;   // face width, thickness
  const b = Math.min(0.24, Math.min(W, H) * 0.1);
  const inner = new THREE.Group();
  if (thinX) inner.rotation.y = Math.PI / 2;
  const r = Math.min(0.04, T * 0.15);
  const add = (w: number, h: number, t: number, x: number, y: number, m: THREE.Material = mat, cast = true) => {
    const part = mesh(roundedBox(w, h, t, Math.min(r, w * 0.3, h * 0.3, t * 0.3), 1), m, x, y, 0, cast);
    inner.add(part);
  };
  add(W, b, T, 0, H / 2 - b / 2);
  add(W, b, T, 0, -H / 2 + b / 2);
  add(b, H - 2 * b, T, -W / 2 + b / 2, 0);
  add(b, H - 2 * b, T, W / 2 - b / 2, 0);
  add(W - 2 * b + 0.02, H - 2 * b + 0.02, T * 0.62, 0, 0);                  // recessed panel
  const rails = H > 2.5 ? 2 : 1;
  for (let i = 1; i <= rails; i++) add(W - 2 * b + 0.02, b * 0.55, T * 0.82, 0, -H / 2 + b + (H - 2 * b) * (i / (rails + 1)));
  const seam = ownGlow(PALETTE.portalA, 1.6, '#9fdcff');
  const seamT = Math.min(T * 0.62 + 0.012, T);
  inner.add(mesh(new THREE.BoxGeometry(0.07, H - 2 * b, Math.min(seamT + 0.02, T + 0.004)), seam, 0, 0, 0, false));
  // gold chevrons on the frame corners: "this opens when solved"
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    inner.add(mesh(new THREE.BoxGeometry(b * 0.5, b * 0.18, Math.min(T + 0.01, T + 0.01)), glow(PALETTE.interactable, 1.4), sx * (W / 2 - b / 2), sy * (H / 2 - b / 2), 0, false));
  }
  grp.add(inner);
  return { group: grp, seam };
}

// ---------------------------------------------------------------- checkpoints
export function checkpointModel(): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({ color: PALETTE.success, emissive: PALETTE.success, emissiveIntensity: 0.4, transparent: true, opacity: 0.75 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.04, 8, 48), mat);
  ring.rotation.x = -Math.PI / 2;
  const inner = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.015, 6, 40), mat);
  ring.add(inner);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.02), mat);
    t.position.set(Math.cos(a) * 0.76, Math.sin(a) * 0.76, 0);
    t.rotation.z = a + Math.PI / 2;
    ring.add(t);
  }
  return ring;
}

export type { InteractableDef };

/** portal anchor pad: a bevelled disc stepped down to a thinner outer rim */
export function padGeometry(): THREE.BufferGeometry {
  return bevelCylinder(1.55, 0.08, 0.03, 48, 2);
}

/**
 * Merge static sub-parts of a model to cut draw calls: under every node, unnamed
 * leaf meshes that share a material are baked (with their local transform) into
 * one mesh. Named parts — the ones World.update() animates — and their subtrees
 * are kept as separate objects (their own static children are compacted too).
 */
export function compact(root: THREE.Object3D): THREE.Object3D {
  const visit = (node: THREE.Object3D) => {
    const buckets = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean; src: THREE.Mesh[] }>();
    for (const child of [...node.children]) {
      const m = child as THREE.Mesh;
      const leaf = !child.name && m.isMesh && !(m as unknown as THREE.InstancedMesh).isInstancedMesh && !child.children.length && !Array.isArray(m.material);
      if (!leaf) { visit(child); continue; }
      let b = buckets.get(m.material as THREE.Material);
      if (!b) { b = { geos: [], cast: false, src: [] }; buckets.set(m.material as THREE.Material, b); }
      b.src.push(m);
      b.cast ||= m.castShadow;
    }
    for (const [mat, b] of buckets) {
      if (b.src.length < 2) continue;
      for (const m of b.src) {
        m.updateMatrix();
        const g = finalize(m.geometry.index ? m.geometry.clone() : m.geometry.clone());
        g.applyMatrix4(m.matrix);
        b.geos.push(g);
        node.remove(m);
        m.geometry.dispose();
      }
      const merged = mergeAll(b.geos);
      if (!merged) continue;
      const out = new THREE.Mesh(merged, mat);
      out.castShadow = b.cast; out.receiveShadow = true;
      node.add(out);
    }
  };
  visit(root);
  return root;
}
