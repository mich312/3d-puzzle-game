// Unit tests for the shared (client + server) core: expression evaluator,
// client-message validation, collision, and level validation.
// Run: npm test   (node:test via tsx — no extra dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evalExpr, exprIdents } from '../shared/expr';
import { validateClientMsg, hasKey, cleanName, sanitizeText, isVec3 } from '../shared/validate';
import { aabbFromGeometry, buildColliders, raycast, groundHeight, segmentClear, type AABB } from '../shared/collision';
import { validateLevel, type LevelDef, type GeometryDef } from '../shared/level';
import { SKILLS } from '../shared/skills';

const lookupOf = (vals: Record<string, number | boolean>) => (p: string) => vals[p];

// ---------- expressions ----------
test('expr: literals, comparison and boolean precedence', () => {
  const l = lookupOf({ 'a.on': true, 'b.on': false, 'plate.mass': 2, allEnemiesDown: true });
  assert.equal(evalExpr('true', l), true);
  assert.equal(evalExpr('a.on && b.on', l), false);
  assert.equal(evalExpr('a.on || b.on', l), true);
  assert.equal(evalExpr('!b.on', l), true);
  assert.equal(evalExpr('plate.mass >= 2 && allEnemiesDown', l), true);
  assert.equal(evalExpr('plate.mass > 2', l), false);
  assert.equal(evalExpr('plate.mass == 2', l), true);
  assert.equal(evalExpr('plate.mass != 2', l), false);
  // && binds tighter than ||
  assert.equal(evalExpr('b.on && b.on || a.on', l), true);
  assert.equal(evalExpr('b.on && (b.on || a.on)', l), false);
});

test('expr: unknown identifiers are falsy, never evaluated as code', () => {
  const seen: string[] = [];
  const l = (p: string) => { seen.push(p); return undefined; };
  assert.equal(evalExpr('constructor', l), false);
  assert.equal(evalExpr('__proto__.polluted', l), false);
  assert.deepEqual(seen, ['constructor', '__proto__.polluted']);
});

test('expr: malformed input throws instead of guessing', () => {
  const l = lookupOf({});
  for (const bad of ['a &&', '(a', 'a ) b', 'a; process.exit()', 'a + b', '"str"']) {
    assert.throws(() => evalExpr(bad, l), `should reject: ${bad}`);
  }
});

test('expr: exprIdents lists referenced paths', () => {
  assert.deepEqual(exprIdents('door1.open && !lever.on || x.mass >= 2').sort(), ['door1.open', 'lever.on', 'x.mass'].sort());
});

// ---------- client message validation ----------
test('validate: well-formed messages pass', () => {
  const ok: unknown[] = [
    { t: 'hello', v: 1, name: 'Aster' },
    { t: 'move', v: 1, p: [0, 1, 0], yaw: 0.5, pitch: -0.2, anim: 3 },
    { t: 'fire', v: 1, device: 'pulse', origin: [0, 1, 0], dir: [0, 0, -1] },
    { t: 'place_portal', v: 1, slot: 1, pos: [0, 1, 0], normal: [0, 1, 0] },
    { t: 'unlock_skill', v: 1, skill: Object.keys(SKILLS)[0] },
    { t: 'telemetry', v: 1, name: 'ui', payload: { a: 1 } },
    { t: 'reset_level', v: 1 },
  ];
  for (const m of ok) assert.equal(validateClientMsg(m), true, JSON.stringify(m));
});

test('validate: malformed and hostile messages are rejected', () => {
  const bad: unknown[] = [
    null, [], 'move', { t: 'move' }, { t: 'move', v: 2, p: [0, 0, 0], yaw: 0, pitch: 0 },
    { t: 'move', v: 1, p: [null, 1, 0], yaw: 0, pitch: 0 },
    { t: 'move', v: 1, p: [0, 1], yaw: 0, pitch: 0 },
    { t: 'move', v: 1, p: [0, 1, 0, 4], yaw: 0, pitch: 0 },
    { t: 'move', v: 1, p: ['1', 1, 0], yaw: 0, pitch: 0 },
    { t: 'move', v: 1, p: [1e9, 1, 0], yaw: 0, pitch: 0 },
    { t: 'move', v: 1, p: [0, 1, 0], yaw: 0, pitch: 0, anim: 99 },
    { t: 'unlock_skill', v: 1, skill: 'constructor' },
    { t: 'unlock_skill', v: 1, skill: '__proto__' },
    { t: 'equip', v: 1, device: 'toString' },
    { t: 'fire', v: 1, device: 'pulse', origin: [0, 0, 0], dir: [0, 0, 0] },
    { t: 'fire', v: 1, device: 'pulse', origin: [0, 0, 0], dir: [0, 0, 1], targetId: 'x'.repeat(65) },
    { t: 'place_portal', v: 1, slot: 5, pos: [0, 1, 0], normal: [0, 1, 0] },
    { t: 'telemetry', v: 1, name: 'solved' },
    { t: 'telemetry', v: 1, name: 'ui', payload: { big: 'x'.repeat(4000) } },
    { t: 'set_name', v: 1, name: ['x'] },
    { t: 'echo', v: 1, place: true, path: Array.from({ length: 200 }, () => [0, 0, 0]) },
    { t: 'nope', v: 1 },
  ];
  for (const m of bad) assert.equal(validateClientMsg(m), false, JSON.stringify(m)?.slice(0, 80));
});

test('validate: hasKey refuses prototype keys', () => {
  assert.equal(hasKey(SKILLS, 'constructor'), false);
  assert.equal(hasKey(SKILLS, '__proto__'), false);
  assert.equal(hasKey(SKILLS, 42), false);
  assert.equal(hasKey(SKILLS, Object.keys(SKILLS)[0]), true);
});

test('validate: names are sanitized and reserved names refused', () => {
  assert.equal(cleanName('  Aster  '), 'Aster');
  assert.equal(cleanName('Mal‮lory\u0007'), 'Mallory');
  assert.equal(cleanName('THRESHOLD'), null);
  assert.equal(cleanName('T​HRESHOLD'), null);
  assert.equal(cleanName('sys tem'), null);
  assert.equal(cleanName(['x']), null);
  assert.equal(cleanName(''), null);
  assert.equal(cleanName('x'.repeat(100))?.length, 24);
  assert.equal(sanitizeText('a\n\n  b\tc', 50), 'a b c');
  assert.equal(isVec3([0, 0, 0]), true);
  assert.equal(isVec3([0, NaN, 0]), false);
});

// ---------- collision ----------
const box = (pos: [number, number, number], size: [number, number, number], extra: Partial<GeometryDef> = {}) =>
  ({ pos, size, material: 'stone', ...extra }) as GeometryDef;

test('collision: AABB from box, cylinder and quarter-turn rotation', () => {
  const b = aabbFromGeometry(box([0, 0, 0], [2, 1, 4]), 0)!;
  assert.deepEqual(b.min, [-1, -0.5, -2]);
  assert.deepEqual(b.max, [1, 0.5, 2]);
  const r = aabbFromGeometry(box([0, 0, 0], [2, 1, 4], { rotY: Math.PI / 2 }), 0)!;
  assert.deepEqual([r.min[0], r.max[0], r.min[2], r.max[2]], [-2, 2, -1, 1]);
  const c = aabbFromGeometry(box([0, 0, 0], [1, 2, 1], { shape: 'cylinder' }), 0)!;
  assert.deepEqual(c.round, { x: 0, z: 0, r: 1 });
  assert.equal(aabbFromGeometry(box([0, 0, 0], [1, 1, 1], { collider: false }), 0), null);
});

test('collision: raycast returns nearest hit with face normal, skips inactive', () => {
  const near = aabbFromGeometry(box([0, 1, -5], [2, 2, 1]), 0)!;
  const far = aabbFromGeometry(box([0, 1, -10], [2, 2, 1]), 1)!;
  const cols: AABB[] = [far, near];
  const hit = raycast(cols, [0, 1, 0], [0, 0, -1], 50)!;
  assert.ok(Math.abs(hit.dist - 4.5) < 1e-9);
  assert.equal(hit.box, near);
  assert.deepEqual(hit.normal, [0, 0, 1]);
  near.active = false;
  assert.equal(raycast(cols, [0, 1, 0], [0, 0, -1], 50)!.box, far);
  assert.equal(raycast(cols, [0, 1, 0], [0, 0, -1], 5), null);
  assert.equal(segmentClear(cols, [0, 1, 0], [0, 1, -8]), true);
  assert.equal(segmentClear(cols, [0, 1, 0], [0, 1, -12]), false);
});

test('collision: groundHeight picks the highest reachable top surface', () => {
  const cols = [
    aabbFromGeometry(box([0, -0.5, 0], [10, 1, 10]), 0)!,    // floor top y=0
    aabbFromGeometry(box([0, 0.25, 0], [2, 0.5, 2]), 1)!,    // step top y=0.5
    aabbFromGeometry(box([0, 5, 0], [2, 1, 2]), 2)!,         // ceiling slab well above
  ];
  assert.equal(groundHeight(cols, 0, 0.5, 0), 0.5);
  assert.equal(groundHeight(cols, 4, 0.5, 4), 0);
  assert.equal(groundHeight(cols, 20, 0, 20), null);
});

// ---------- level validation ----------
const CONTENT = join(import.meta.dirname, '..', 'content', 'worlds');
const loadLevel = (world: string, id: string) =>
  JSON.parse(readFileSync(join(CONTENT, world, `${id}.json`), 'utf8')) as LevelDef;

test('level: shipped tutorial level validates clean', () => {
  const lv = loadLevel('atrium', 'atrium-01');
  assert.deepEqual(validateLevel(lv), []);
  assert.ok(buildColliders(lv).length > 0);
});

test('level: self-referencing and cyclic doors are rejected', () => {
  const base = loadLevel('atrium', 'atrium-01');
  const self = structuredClone(base);
  self.geometry.push(box([0, 1, 0], [1, 2, 0.2], { door: { id: 'dSelf', openWhen: 'dSelf.open' } }));
  assert.ok(validateLevel(self).some((e) => e.includes('dSelf') && e.includes('itself')), validateLevel(self).join('; '));

  const cyc = structuredClone(base);
  cyc.geometry.push(
    box([0, 1, 0], [1, 2, 0.2], { door: { id: 'd1', openWhen: 'd2.open' } }),
    box([2, 1, 0], [1, 2, 0.2], { door: { id: 'd2', openWhen: 'd3.open' } }),
    box([4, 1, 0], [1, 2, 0.2], { door: { id: 'd3', openWhen: 'd1.open' } }),
  );
  assert.ok(validateLevel(cyc).some((e) => e.startsWith('door cycle')), validateLevel(cyc).join('; '));
});

test('level: objectives are validated like other expressions', () => {
  const lv = loadLevel('atrium', 'atrium-01');
  assert.ok((lv.objectives?.length ?? 0) > 0, 'tutorial ships objectives');
  const bad = structuredClone(lv);
  bad.objectives = [{ text: '', done: 'lever1.state==1' }, { text: 'ok', done: 'ghost.on' }, { text: 'ok', done: 'a &&' }];
  const errs = validateLevel(bad);
  assert.ok(errs.some((e) => e.startsWith('objectives[0]: text')), errs.join('; '));
  assert.ok(errs.some((e) => e.includes('unknown identifier "ghost.on"')), errs.join('; '));
  assert.ok(errs.some((e) => e.includes('objectives[2].done: unparseable')), errs.join('; '));
});
