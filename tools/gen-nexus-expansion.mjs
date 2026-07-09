// Expands the Nexus: diagonal sky-step chains → mid-tier platforms → a halo
// plaza around the spire → a crow's-nest summit, plus 4 outer leisure islands
// reached by stepping stones. All risers <= 1.0m (jump 1.3m), steps <= 0.55m.
import fs from 'fs';

const FILE = '/home/user/3d-puzzle-game/content/worlds/nexus/nexus.json';
const MARK = 'gen';
const level = JSON.parse(fs.readFileSync(FILE, 'utf8'));

// drop any previous expansion (idempotent regeneration)
level.geometry = level.geometry.filter((g) => g[MARK] !== 'nexus-expansion');

const R = (v) => Math.round(v * 1000) / 1000;
const out = [];
const add = (g) => { g[MARK] = 'nexus-expansion'; out.push(g); };

const cyl = (x, top, z, r, h, extra = {}) =>
  add({ shape: 'cylinder', pos: [R(x), R(top - h / 2), R(z)], size: [R(r), R(h), R(r)], material: 'stone', ...extra });
const glow = (x, top, z, r, emissive, intensity = 0.35) =>
  add({
    shape: 'cylinder', pos: [R(x), R(top + 0.041), R(z)], size: [R(r), 0.08, R(r)],
    material: 'tile', collider: false, emissive, emissiveIntensity: intensity,
  });
const crystal = (x, y, z, s, emissive, intensity = 1.4, rotY = 0.6) =>
  add({
    shape: 'box', pos: [R(x), R(y), R(z)], size: [R(s), R(s), R(s)],
    material: 'crystal', collider: false, emissive, emissiveIntensity: intensity, rotY,
  });

const DIAG = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([x, z]) => [x / Math.SQRT2, z / Math.SQRT2]);
const GLOW_BLUE = '#8b9fd0';
const GLOW_GOLD = '#ffd98a';
const GLOW_VIOLET = '#b8a8ff';

// ---- tier 1: sky-step chains up from the island rim (all four diagonals) ----
for (const [dx, dz] of DIAG) {
  const steps = [[13.4, 0.9], [12.1, 1.8], [10.8, 2.7]];
  for (const [dist, top] of steps) {
    cyl(dx * dist, top, dz * dist, 1.1, 0.5);
    glow(dx * dist, top, dz * dist, 0.95, GLOW_BLUE, 0.3);
  }
  // mid-tier platform on a floating drift-rock
  cyl(dx * 8.6, 3.6, dz * 8.6, 2.8, 0.6);
  glow(dx * 8.6, 3.6, dz * 8.6, 2.55, GLOW_BLUE, 0.25);
  cyl(dx * 8.6, 3.0, dz * 8.6, 1.7, 2.2, { collider: false, color: '#413c56' });
  crystal(dx * 8.6 + dz * 2.0, 4.3, dz * 8.6 - dx * 2.0, 0.55, GLOW_VIOLET, 1.2);
}

// ---- tier 2: floating steps from two mid platforms up to the halo plaza ----
for (const [dx, dz] of [DIAG[0], DIAG[2]]) {
  const steps = [[7.0, 4.5], [6.0, 5.4], [5.2, 6.2]];
  for (const [dist, top] of steps) {
    cyl(dx * dist, top, dz * dist, 1.0, 0.45);
    glow(dx * dist, top, dz * dist, 0.85, GLOW_VIOLET, 0.35);
  }
}
// halo plaza: a floating disc around the spire
cyl(0, 7.0, 0, 5.4, 0.55);
glow(0, 7.0, 0, 5.15, GLOW_VIOLET, 0.22);
cyl(0, 6.45, 0, 2.6, 1.8, { collider: false, color: '#413c56' });
// plaza rim crystals
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2 + 0.26;
  crystal(Math.cos(a) * 4.7, 7.55, Math.sin(a) * 4.7, 0.45, GLOW_VIOLET, 1.3, R(a));
}

// ---- tier 3: spiral steps around the spire to the crow's nest ----
const spiral = [[45, 7.9], [135, 8.8], [225, 9.6]];
for (const [deg, top] of spiral) {
  const a = (deg * Math.PI) / 180;
  cyl(Math.cos(a) * 2.6, top, Math.sin(a) * 2.6, 1.0, 0.45);
  glow(Math.cos(a) * 2.6, top, Math.sin(a) * 2.6, 0.85, GLOW_GOLD, 0.35);
}
// crow's nest: caps the spire (spire collider ends at y=10)
cyl(0, 10.4, 0, 2.6, 0.5);
glow(0, 10.4, 0, 2.4, GLOW_GOLD, 0.4);
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2;
  crystal(Math.cos(a) * 2.15, 10.75, Math.sin(a) * 2.15, 0.34, GLOW_GOLD, 1.5, R(a * 0.7));
}

// ---- outer leisure islands on the diagonals, with stepping-stone paths ----
DIAG.forEach(([dx, dz], i) => {
  const top = i % 2 === 0 ? 1.6 : 2.4;
  const ix = dx * 30, iz = dz * 30;
  // stepping stones out from the rim (rises <= 0.6)
  const stones = [[18, top * 0.3], [21, top * 0.62], [24, top * 0.88]];
  for (const [dist, stTop] of stones) {
    cyl(dx * dist, stTop, dz * dist, 1.1, 0.5);
  }
  // the island + its underside cone (matches the drift-rock style)
  cyl(ix, top, iz, 5.5, 1.2);
  glow(ix, top, iz, 5.1, i % 2 === 0 ? GLOW_GOLD : GLOW_BLUE, 0.18);
  cyl(ix, top - 1.2, iz, 3.5, 4.0, { collider: false, color: '#413c56' });
  cyl(ix, top - 5.0, iz, 1.5, 3.0, { collider: false, color: '#38344a' });
  // lamp: pillar + crystal
  cyl(ix + dz * 3.4, top + 3.0, iz - dx * 3.4, 0.35, 3.0, { color: '#403a63' });
  crystal(ix + dz * 3.4, top + 3.35, iz - dx * 3.4, 0.6, i % 2 === 0 ? GLOW_GOLD : GLOW_VIOLET, 1.3);
  // parkour perch
  cyl(ix - dz * 2.6, top + 0.9, iz + dx * 2.6, 1.6, 0.6);
  glow(ix - dz * 2.6, top + 0.9, iz + dx * 2.6, 1.4, GLOW_VIOLET, 0.3);
});

// ---- nature: bioluminescent spirit trees + glow bushes ----
// Only box/cylinder primitives exist, so trees are a wood trunk under stacked
// foliage discs; night-garden palette (deep leaf colours, soft emissive rims).
const LEAF = [
  { color: '#26413a', emissive: '#3f7a5c' },   // moss teal (muted, night-lit)
  { color: '#332e4c', emissive: '#7a68ab' },   // dusk violet
  { color: '#3f3527', emissive: '#9c7d54' },   // ember amber
];
let natureIdx = 0;
const vary = () => {                          // deterministic per-placement variation
  natureIdx++;
  return 0.85 + ((natureIdx * 37) % 30) / 100; // 0.85 .. 1.14
};
const tree = (x, baseY, z, leafIdx = 0) => {
  const s = vary();
  const leaf = LEAF[leafIdx % LEAF.length];
  const trunkH = 2.7 * s;
  cyl(x, baseY + trunkH, z, 0.18 * s, trunkH, { material: 'wood', color: '#8a6a50', emissive: '#6a4a34', emissiveIntensity: 0.12 });
  const tiers = [[0.95, 0.55], [0.7, 0.5], [0.42, 0.45]];
  tiers.forEach(([r, h], i) => {
    add({
      shape: 'cylinder', pos: [R(x), R(baseY + trunkH + 0.1 + i * 0.52 * s), R(z)],
      size: [R(r * s), R(h * s), R(r * s)], material: 'stone', collider: false,
      color: leaf.color, emissive: leaf.emissive, emissiveIntensity: 0.07,
    });
  });
  // a couple of glow-fruit motes hanging in the canopy
  crystal(x + 0.9 * s, baseY + trunkH + 0.4, z + 0.3, 0.16, leaf.emissive, 1.1, R(s));
  crystal(x - 0.5, baseY + trunkH + 0.9 * s, z - 0.8 * s, 0.13, leaf.emissive, 1.0, R(s * 2));
};
const bush = (x, baseY, z, leafIdx = 0) => {
  const s = vary();
  const leaf = LEAF[leafIdx % LEAF.length];
  add({
    shape: 'cylinder', pos: [R(x), R(baseY + 0.28 * s), R(z)], size: [R(0.62 * s), R(0.56 * s), R(0.62 * s)],
    material: 'stone', collider: false, color: leaf.color, emissive: leaf.emissive, emissiveIntensity: 0.12,
  });
  add({
    shape: 'cylinder', pos: [R(x + 0.4 * s), R(baseY + 0.18), R(z - 0.3 * s)], size: [R(0.38 * s), R(0.36), R(0.38 * s)],
    material: 'stone', collider: false, color: leaf.color, emissive: leaf.emissive, emissiveIntensity: 0.12,
  });
  crystal(x - 0.2, baseY + 0.55 * s, z + 0.25, 0.1, leaf.emissive, 0.9, R(s * 3));
};

// centre island rim: a broken ring of trees + undergrowth (clear of bridges,
// benches, and the diagonal sky steps)
for (const deg of [33, 57, 123, 147, 213, 237, 303, 327]) {
  const a = (deg * Math.PI) / 180;
  const x = Math.cos(a) * 13.6, z = Math.sin(a) * 13.6;
  tree(x, 0, z, deg % 3);
  bush(x + Math.cos(a + 1.9) * 1.7, 0, z + Math.sin(a + 1.9) * 1.7, (deg + 1) % 3);
}
// gardens island grove (amber)
for (const [x, z] of [[-7.5, 44.5], [7.5, 44.5], [-7.5, 55.5], [7.5, 55.5]]) {
  tree(x, 2.05, z, 2);
  bush(x + 1.9, 2.05, z + 0.7, 2);
}
// atrium + observatory get a violet pair each; vaults stays barren ice
tree(-8, 4.0, -45, 1); tree(8, 4.0, -45, 1);
tree(-45, 6.05, -7, 1); tree(-45, 6.05, 7, 1);
// outer leisure islands: low undergrowth only — a full tree crowds a 5.5m
// island that already holds a lamp, a perch, and (NE) the Proving Ground
// portal. Two bushes flank the stepping-stone landing on the inward rim, so
// the sightline back to the spire and the portal pad stay open.
DIAG.forEach(([dx, dz], i) => {
  const top = i % 2 === 0 ? 1.6 : 2.4;
  const ix = dx * 30, iz = dz * 30;
  bush(ix - dx * 3.8 + dz * 2.4, top, iz - dz * 3.8 - dx * 2.4, (i + 1) % 3);
  bush(ix - dx * 3.8 - dz * 2.4, top, iz - dz * 3.8 + dx * 2.4, (i + 2) % 3);
});
// mid-tier platforms: a bush beside each crystal
for (const [dx, dz] of DIAG) bush(dx * 8.6 - dz * 1.9, 3.6, dz * 8.6 + dx * 1.9, 0);

// slow-spinning decor: nest + plaza crystals get a spin rate
for (const g of out) {
  if (g.material === 'crystal' && g.collider === false && g.size[0] >= 0.3 && g.size[0] <= 0.6) g.spin = 0.5;
}

level.geometry.push(...out);

// ---- portal to The Proving Ground on the NE leisure island ----
level.portals = (level.portals ?? []).filter((p) => p.id !== 'to-proving-01');
level.portals.push({
  id: 'to-proving-01',
  pos: [23.3, 2.9, 23.3],
  linkedTo: 'proving-01',
  label: 'The Proving Ground',
  color: '#a8f0c6',
});

fs.writeFileSync(FILE, JSON.stringify(level, null, 2) + '\n');
console.log(`appended ${out.length} geometry entries; total ${level.geometry.length}`);
