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

level.geometry.push(...out);
fs.writeFileSync(FILE, JSON.stringify(level, null, 2) + '\n');
console.log(`appended ${out.length} geometry entries; total ${level.geometry.length}`);
