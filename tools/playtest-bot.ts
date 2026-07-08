// Headless WS playtest bots — the automated "dual-path playtest" (spec §17).
// Drives real protocol messages against a running server and asserts gameplay:
//   1. solo player solves atrium-01 (lever → pulse switch → kill drifter → shard)
//   2. two players solve atrium-02 (simultaneity plates) with base gear
//   3. down/revive round-trip
// Usage: npx tsx tools/playtest-bot.ts [ws://localhost:8080/ws]
import WebSocket from 'ws';
import type { ClientMsg, ServerMsg, InstanceSnapshot } from '../shared/messages';
import type { Vec3 } from '../shared/level';

const URL = process.argv[2] ?? 'ws://localhost:8080/ws';
let failures = 0;

class Bot {
  ws: WebSocket;
  id = '';
  pos: Vec3 = [0, 1, 0];
  yaw = 0;
  hp = 100;
  state = 'alive';
  snapshot?: InstanceSnapshot;
  levelId?: string;
  solved = false;
  shards: string[] = [];
  msgs: ServerMsg[] = [];
  private mover?: ReturnType<typeof setInterval>;

  constructor(public name: string) {
    this.ws = new WebSocket(URL);
    this.ws.on('message', (raw) => {
      const m = JSON.parse(String(raw)) as ServerMsg;
      this.msgs.push(m);
      if (m.t === 'welcome') { this.id = m.playerId; this.shards = m.profile.shards; }
      if (m.t === 'joined') {
        this.snapshot = m.snapshot;
        this.levelId = m.snapshot.levelId ?? m.snapshot.level?.id;
        this.pos = [...m.spawn] as Vec3;
        this.solved = !!m.snapshot.solved;
      }
      if (m.t === 'snap') {
        const states = this.snapshot?.states;      // tick snaps omit states; keep last known
        this.snapshot = m.s;
        if (states && !this.snapshot.states) this.snapshot.states = states;
        this.solved = !!m.s.solved;
      }
      if (m.t === 'state_update') {
        if (this.snapshot) {
          this.snapshot.states = this.snapshot.states ?? {};
          this.snapshot.states[m.id] = { ...(this.snapshot.states[m.id] ?? {}), ...m.state };
        }
      }
      if (m.t === 'hp' && 'id' in m && m.id === this.id) this.hp = m.hp;
      if (m.t === 'downed' && m.id === this.id) this.state = 'downed';
      if (m.t === 'revived' && m.id === this.id) this.state = 'alive';
      if (m.t === 'respawn' && m.id === this.id) { this.state = 'alive'; this.pos = [...m.p] as Vec3; }
      if (m.t === 'portal_traverse' && m.player === this.id) this.pos = [...m.to] as Vec3;
      if (m.t === 'shards') this.shards = m.shards;
    });
    this.mover = setInterval(() => {
      if (this.ws.readyState === WebSocket.OPEN && this.id)
        this.send({ t: 'move', v: 1, p: this.pos, yaw: this.yaw, pitch: 0, anim: 0 });
    }, 80);
  }
  send(m: ClientMsg) { this.ws.send(JSON.stringify(m)); }
  async open() {
    if (this.ws.readyState !== WebSocket.OPEN) {
      await new Promise<void>((res, rej) => {
        this.ws.once('open', res);
        this.ws.once('error', rej);
        setTimeout(() => rej(new Error(`${this.name}: ws open timeout`)), 8000);
      });
    }
    this.send({ t: 'hello', v: 1, name: this.name });
    await this.until(() => !!this.id, 'welcome');
    await this.until(() => !!this.snapshot, 'joined lobby');
    // Story difficulty (40% incoming damage) — the audit verifies puzzle LOGIC,
    // so combat attrition on a dumb noclip-shooter bot shouldn't mask solvability.
    this.send({ t: 'set_opts', v: 1, difficulty: 'story' });
  }
  /** teleport-free walk: move in small legal steps (server rejects >12m jumps).
      Aborts if a portal/transfer changes the level mid-walk — the target
      coordinates belong to the old level. */
  async walkTo(p: Vec3) {
    const startLevel = this.levelId;
    for (let guard = 0; guard < 200; guard++) {
      if (this.levelId !== startLevel) return;
      const dx = p[0] - this.pos[0], dy = p[1] - this.pos[1], dz = p[2] - this.pos[2];
      const d = Math.hypot(dx, dy, dz);
      if (d < 0.4) return;
      const step = Math.min(3, d);
      this.pos = [this.pos[0] + (dx / d) * step, this.pos[1] + (dy / d) * step, this.pos[2] + (dz / d) * step];
      await sleep(90);
    }
  }
  async until(cond: () => boolean, what: string, ms = 8000): Promise<void> {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error(`${this.name}: timeout waiting for ${what}`);
      await sleep(60);
    }
  }
  /** repeat an action until a condition holds (server ignores early inputs while placing) */
  async attempt(action: () => void, cond: () => boolean, what: string, ms = 10000): Promise<void> {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error(`${this.name}: timeout attempting ${what}`);
      action();
      await sleep(500);
    }
  }
  st(id: string) { return this.snapshot?.states?.[id]; }
  enemy(id: string) { return this.snapshot?.enemies?.find((e) => e.id === id); }
  close() { clearInterval(this.mover); this.ws.close(); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function check(ok: boolean, what: string) {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${what}`);
  if (!ok) failures++;
}

async function fireAt(bot: Bot, device: 'pulse' | 'freeze', target: Vec3, targetId?: string) {
  const origin: Vec3 = [bot.pos[0], bot.pos[1] + 1.5, bot.pos[2]];
  const d: Vec3 = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
  const l = Math.hypot(...d) || 1;
  bot.send({ t: 'fire', v: 1, device, origin, dir: [d[0] / l, d[1] / l, d[2] / l], targetId });
}

async function testSoloAtrium01() {
  console.log('\n— TEST 1: solo playthrough of atrium-01 (First Light) —');
  const a = new Bot('BotSolo');
  await a.open();
  check(a.snapshot?.kind === 'lobby', 'spawned in shared lobby');
  a.send({ t: 'enter_level', v: 1, level: 'atrium-01' });
  await a.until(() => a.levelId === 'atrium-01', 'enter atrium-01');
  check(true, 'entered level instance');
  a.send({ t: 'reset_level', v: 1 });                 // clean slate (also tests §19 reset)
  await sleep(800);

  // lever opens gate1
  await a.walkTo([2.2, 1, -5]);
  await a.attempt(() => a.send({ t: 'interact', v: 1, target: 'lever1' }),
    () => a.st('lever1')?.state === 1, 'lever1 state 1');
  check(true, 'lever pulled → gate1 open');

  // pulse the bridge switch from across the gap
  await a.walkTo([0, 1, -7.5]);
  await a.walkTo([0, 1, -10]);
  await a.attempt(() => fireAt(a, 'pulse', [0, 2.2, -20.4]),
    () => a.st('bridgeSwitch')?.on === true, 'bridgeSwitch on');
  check(true, 'pulse activated the bridge switch');

  // cross bridge, fight the drifter with pulses
  await a.walkTo([0, 1, -14]);
  await a.walkTo([0, 1, -19]);
  await a.walkTo([0, 1, -24]);
  for (let i = 0; i < 12 && a.enemy('d1')?.state !== 'down'; i++) {
    const e = a.enemy('d1');
    if (e) await fireAt(a, 'pulse', [e.p[0], e.p[1] + 0.8, e.p[2]], 'd1');
    await sleep(700);
  }
  await a.until(() => a.enemy('d1')?.state === 'down', 'drifter down', 15000);
  check(true, 'drifter defeated with pulse');
  await a.until(() => a.solved, 'level solved');
  check(a.shards.includes('atrium-01'), 'shard granted');

  // exit portal back to nexus
  await a.walkTo([0, 1, -33]);
  await a.walkTo([0, 1.3, -36.5]);
  await a.until(() => a.levelId === 'nexus' || a.snapshot?.kind === 'lobby', 'return to nexus', 10000);
  check(true, 'threshold portal returned to the Nexus');
  const survivedHp = a.hp;
  check(survivedHp > 0, `survived (hp ${survivedHp})`);
  a.close();
}

async function testCoopAtrium02() {
  console.log('\n— TEST 2: two-player base-gear solve of atrium-02 (Two Bells) —');
  const a = new Bot('BotA');
  const b = new Bot('BotB');
  await a.open(); await b.open();
  // co-op entry gate: both must request; the second request admits the pair
  a.send({ t: 'enter_level', v: 1, level: 'atrium-02' });
  await sleep(400);
  b.send({ t: 'enter_level', v: 1, level: 'atrium-02' });
  await a.until(() => a.levelId === 'atrium-02', 'A enters');
  await b.until(() => b.levelId === 'atrium-02', 'B enters');
  a.send({ t: 'reset_level', v: 1 });
  await sleep(800);
  check((a.snapshot?.players.length ?? 0) === 2, 'both bots share one instance');

  // kill the drifters first (they'd interrupt) — fight from range; they chase
  for (let i = 0; i < 40; i++) {
    const alive = (a.snapshot?.enemies ?? []).filter((e) => e.state !== 'down');
    if (!alive.length) break;
    const e = alive[0];
    const dx = a.pos[0] - e.p[0], dz = a.pos[2] - e.p[2];
    const dist = Math.hypot(dx, dz) || 1;
    if (dist > 12) {   // close to firing range but stay off hazards
      await a.walkTo([e.p[0] + (dx / dist) * 10, e.p[1], e.p[2] + (dz / dist) * 10]);
    }
    await fireAt(a, 'pulse', [e.p[0], e.p[1] + 0.8, e.p[2]], e.id);
    await sleep(700);
  }
  check((a.snapshot?.enemies ?? []).every((e) => e.state === 'down'), 'arena cleared');

  // the intended multi-step solve (see designNotes in atrium-02.json):
  // 1. A holds bellA (extends the east bridge)
  await a.walkTo([-11, 1.2, 6]);
  await a.until(() => a.st('bellA')?.pressed === true, 'bellA held');
  check(true, 'A holds bellA — east bridge extends');
  // 2. B ferries the cube across to the tuner, sets it to state 2
  await b.walkTo([-6, 1, 11]);
  await b.attempt(() => b.send({ t: 'grab', v: 1, target: 'cube' }),
    () => (b.snapshot?.bodies ?? []).some((bd) => bd.id === 'cube' && bd.heldBy === b.id), 'grab cube');
  await b.walkTo([11, 1, 2]);      // across the east bridge line
  await b.walkTo([8, 1, -7]);
  await b.attempt(() => b.send({ t: 'interact', v: 1, target: 'tuner' }),
    () => b.st('tuner')?.state === 2, 'tuner to state 2', 12000);
  check(true, 'B set the tuner (west bridge + exit gate open)');
  // 3. B drops the cube on mass-2 bellB and stands with it (cube + player = mass 2);
  //    ferryTo re-drops if the cube slips off the plate before B settles on it.
  const belled = await ferryTo(b, 'cube', [], [11, 1, -8.4],
    () => b.st('bellB')?.pressed === true, { after: [11, 1, -9] });
  check(belled, 'B + cube satisfy the mass-2 bell');
  await a.until(() => a.solved, 'multi-step co-op solve', 12000);
  check(true, 'both bells held + tuner set → solved');
  check(a.shards.includes('atrium-02') , 'A got shard');
  await b.until(() => b.shards.includes('atrium-02'), 'B shard');
  check(true, 'B got shard (everyone present)');
  a.close(); b.close();
}

async function testDownRevive() {
  console.log('\n— TEST 3: down & revive —');
  const a = new Bot('BotDown');
  const b = new Bot('BotMedic');
  await a.open(); await b.open();
  // this test is ABOUT getting downed, so A takes full (normal) damage again
  a.send({ t: 'set_opts', v: 1, difficulty: 'normal' });
  a.send({ t: 'enter_level', v: 1, level: 'atrium-01' });
  await a.until(() => a.levelId === 'atrium-01', 'A in');
  b.send({ t: 'enter_level', v: 1, level: 'atrium-01' });
  await b.until(() => b.levelId === 'atrium-01', 'B in');
  a.send({ t: 'reset_level', v: 1 });
  await sleep(800);
  // A runs to the drifter courtyard and stands still until downed
  await a.walkTo([2.2, 1, -5]);
  await a.attempt(() => a.send({ t: 'interact', v: 1, target: 'lever1' }),
    () => a.st('lever1')?.state === 1, 'lever');
  await a.walkTo([0, 1, -9]);
  await a.attempt(() => fireAt(a, 'pulse', [0, 2.2, -20.4]),
    () => a.st('bridgeSwitch')?.on === true, 'switch');
  await a.walkTo([0, 1, -14]);
  await a.walkTo([0, 1, -26]);
  await a.walkTo([0, 1, -30]);
  await a.until(() => a.state === 'downed', 'A downed by drifter', 30000);
  check(true, 'enemy downed player A');
  // B walks to A and revives
  await b.walkTo([0, 1, -9]);
  await b.walkTo([0, 1, -14]);
  await b.walkTo([a.pos[0] + 1, a.pos[1], a.pos[2]]);
  b.send({ t: 'revive_start', v: 1, target: a.id });
  await a.until(() => a.state === 'alive', 'revive completes', 8000);
  check(true, 'B revived A');
  a.close(); b.close();
}

async function testFreezeVaults01() {
  console.log('\n— TEST 4: co-op Freeze mechanics in vaults-01 (Cold Store) —');
  const a = new Bot('BotFrost');
  const b = new Bot('BotFrostMate');
  await a.open(); await b.open();
  a.send({ t: 'enter_level', v: 1, level: 'vaults-01' });
  await sleep(400);
  b.send({ t: 'enter_level', v: 1, level: 'vaults-01' });
  await a.until(() => a.levelId === 'vaults-01', 'A enters');
  await b.until(() => b.levelId === 'vaults-01', 'B enters');
  a.send({ t: 'reset_level', v: 1 });
  await sleep(800);
  const gotFreeze = a.msgs.some((m) => m.t === 'devices' && m.devices.includes('freeze'));
  check(gotFreeze, 'Freeze Ray granted on entry');

  // clear the drifter pack: freeze-shatter the first, pulse the rest
  await a.walkTo([0, 1, -12]);
  await a.attempt(() => {
    const e = a.enemy('d1');
    if (e && e.state !== 'down') fireAt(a, 'freeze', [e.p[0], e.p[1] + 0.8, e.p[2]], 'd1');
  }, () => ['frozen', 'down'].includes(a.enemy('d1')?.state ?? ''), 'freeze d1', 15000);
  check(true, 'drifter frozen solid');
  await a.attempt(() => {
    const e = a.enemy('d1');
    if (e) fireAt(a, 'pulse', [e.p[0], e.p[1] + 0.8, e.p[2]], 'd1');
  }, () => a.enemy('d1')?.state === 'down', 'freeze-shatter', 12000);
  check(true, 'frozen enemy shattered by pulse');
  for (let i = 0; i < 30; i++) {
    const alive = (a.snapshot?.enemies ?? []).filter((e) => e.state !== 'down');
    if (!alive.length) break;
    const e = alive[0];
    await fireAt(a, 'pulse', [e.p[0], e.p[1] + 0.8, e.p[2]], e.id);
    await sleep(700);
  }
  check((a.snapshot?.enemies ?? []).every((e) => e.state === 'down'), 'pack cleared');

  // B ferries the coolant cell to its mount (kills the exit steam curtain).
  // Route through real doorways: held cargo collides with walls even though bots
  // noclip, so ferryTo re-grabs and retries if the cell snags on the doorway frame.
  await b.walkTo([-8.5, 1, -16]);
  const docked = await ferryTo(b, 'coolant',
    [[-8.5, 1, -19], [-8.5, 1, -16], [0, 1, -20], [0, 1, -24.5]],   // alcove → hall → doorway
    [3, 1, -26.6], () => b.st('coolantMount')?.filled === true);     // face the mount
  check(docked, 'coolant cell docked in its mount — curtain drops, blast door open');

  // A holds the lift plate while B flash-freezes the exit vent
  await a.walkTo([-3, 1, -31]);
  await a.until(() => a.st('liftPlate')?.pressed === true, 'lift plate held');
  await b.walkTo([0, 1, -30]);
  await b.attempt(() => {
    const origin: Vec3 = [b.pos[0], b.pos[1] + 1.5, b.pos[2]];
    const d: Vec3 = [0 - origin[0], 1.5 - origin[1], -33.5 - origin[2]];
    const l = Math.hypot(...d) || 1;
    b.send({ t: 'fire', v: 1, device: 'freeze', origin, dir: [d[0] / l, d[1] / l, d[2] / l] });
  }, () => a.st('exitVent')?.frozen === true, 'freeze exit vent', 15000);
  await a.until(() => a.solved, 'vaults-01 solved');
  check(a.shards.includes('vaults-01') && b.shards.includes('vaults-01'), 'shards granted to both');
  a.close(); b.close();
}

async function testPortalsGardens02() {
  console.log('\n— TEST 5: portal logistics in gardens-02 (Root & Bloom) —');
  const a = new Bot('BotPortal');
  const b = new Bot('BotBloom');
  await a.open(); await b.open();
  a.send({ t: 'enter_level', v: 1, level: 'gardens-02' });
  await sleep(400);
  b.send({ t: 'enter_level', v: 1, level: 'gardens-02' });
  await a.until(() => a.levelId === 'gardens-02', 'A enters');
  await b.until(() => b.levelId === 'gardens-02', 'B enters');
  a.send({ t: 'reset_level', v: 1 });
  await sleep(800);
  const gotGun = a.msgs.some((m) => m.t === 'devices' && m.devices.includes('portalgun'));
  check(gotGun, 'Portal Device granted on entry');

  // place a portal pair on the flanking portalSurface walls and traverse the chasm
  await a.walkTo([0, 1, 14]);
  a.send({ t: 'place_portal', v: 1, slot: 0, pos: [-12.4, 1.6, 14], normal: [1, 0, 0] });
  a.send({ t: 'place_portal', v: 1, slot: 1, pos: [-12.4, 1.6, -14], normal: [1, 0, 0] });
  await a.until(() => (a.snapshot?.portalsPlaced?.length ?? 0) >= 2, 'both portals placed', 6000);
  check(true, 'two portals placed on legal surfaces');
  const before = a.pos[2];
  await a.walkTo([-11.6, 1.6, 14]);
  await a.until(() => a.pos[2] < 0, 'traversal', 8000);
  check(a.pos[2] < 0, `traversed the chasm via portals (z ${before.toFixed(0)} → ${a.pos[2].toFixed(0)})`);

  // clear the sower (stops the adds) then the warden + stragglers.
  // Both bots fight, and strafe between volleys so sower bolts miss.
  await b.walkTo([-11.6, 1.6, 14]);      // B follows through the portal pair
  await b.until(() => b.pos[2] < 0, 'B traversal', 8000);
  for (let i = 0; i < 90; i++) {
    const alive = (a.snapshot?.enemies ?? []).filter((e) => e.state !== 'down');
    if (!alive.length) break;
    const target = alive.find((e) => e.id === 's1') ?? alive[0];
    for (const bot of [a, b]) {
      const dx = bot.pos[0] - target.p[0], dz = bot.pos[2] - target.p[2];
      const dist = Math.hypot(dx, dz) || 1;
      if (dist > 12) await bot.walkTo([target.p[0] + (dx / dist) * 9, target.p[1], target.p[2] + (dz / dist) * 9]);
      await fireAt(bot, 'pulse', [target.p[0], target.p[1] + 0.9, target.p[2]], target.id);
      bot.pos = [bot.pos[0] + (Math.random() - 0.5) * 4, bot.pos[1], bot.pos[2] + (Math.random() - 0.5) * 4];
    }
    await sleep(700);
  }
  check((a.snapshot?.enemies ?? []).every((e) => e.state === 'down'), 'sower + warden cleared');

  // B holds the far plate → cage opens; A collects the bloom bulb + sockets it
  await b.walkTo([-6, 1, -8]);
  await b.until(() => b.st('holdPlateFar')?.pressed === true, 'far plate held');
  await a.walkTo([8, 1, 15]);
  await a.attempt(() => a.send({ t: 'pickup', v: 1, itemId: 'bloomBulb' }),
    () => a.st('bloomBulb')?.collected === true, 'collect bloom bulb', 12000);
  await a.walkTo([8, 1, -16.5]);
  await a.attempt(() => a.send({ t: 'use_item', v: 1, item: 'bloombulb', socketId: 'bloomMount' }),
    () => a.st('bloomMount')?.filled === true, 'socket bloom bulb', 12000);
  check(true, 'bloom bulb ferried and socketed');

  // final: both exit plates at once (B's is the portal-only high ledge)
  await a.walkTo([6, 1, -20]);
  await b.walkTo([-9, 5.2, -16]);
  await a.until(() => a.solved, 'gardens-02 solved', 15000);
  check(a.shards.includes('gardens-02') && b.shards.includes('gardens-02'), 'shards granted to both');
  a.close(); b.close();
}

async function testChatAndPing() {
  console.log('\n— TEST 0: chat + ping relay in the shared lobby —');
  const a = new Bot('BotTalk');
  const b = new Bot('BotListen');
  await a.open(); await b.open();
  await sleep(300);
  a.send({ t: 'chat', v: 1, text: 'hello threshold' });
  await b.until(() => b.msgs.some((m) => m.t === 'chat' && m.text === 'hello threshold'), 'chat relayed');
  check(true, 'chat relayed to instance peers');
  a.send({ t: 'chat', v: 1, text: 'spam1' });
  a.send({ t: 'chat', v: 1, text: 'spam2' });   // within 700ms — must be dropped
  await sleep(500);
  check(!b.msgs.some((m) => m.t === 'chat' && m.text === 'spam2'), 'rate limit drops rapid messages');
  a.send({ t: 'ping', v: 1, pos: [a.pos[0] + 3, a.pos[1], a.pos[2]] });
  await b.until(() => b.msgs.some((m) => m.t === 'ping'), 'ping relayed');
  check(true, 'ping marker relayed');
  a.close(); b.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// SOLVABILITY AUDIT — the 7 co-op levels not covered by the scenario tests above.
// Bots noclip, so these verify PUZZLE LOGIC (can `solved` be reached by triggering
// the interactables the intended way) — not physical navigability.
// ─────────────────────────────────────────────────────────────────────────────

async function pairEnter(a: Bot, b: Bot, level: string) {
  a.send({ t: 'enter_level', v: 1, level });
  await sleep(400);
  b.send({ t: 'enter_level', v: 1, level });
  await a.until(() => a.levelId === level, `A→${level}`, 14000);
  await b.until(() => b.levelId === level, `B→${level}`, 14000);
  await sleep(500);
}

/** cycle a lever/rotator to a target state by repeated interact */
async function setState(bot: Bot, id: string, pos: Vec3, target: number) {
  await bot.walkTo([pos[0], pos[1] + 0.6, pos[2] + 1.2]);
  try {
    await bot.attempt(() => bot.send({ t: 'interact', v: 1, target: id }),
      () => bot.st(id)?.state === target, `${id}=${target}`, 14000);
  } catch {
    const me = bot.snapshot?.players?.find((p) => p.id === bot.id);
    throw new Error(`${id} stuck at ${JSON.stringify(bot.st(id))} (bot ${bot.pos.map((n) => n.toFixed(1)).join(',')} hp=${bot.hp} state=${me?.state ?? bot.state})`);
  }
}

/** pulse every alive enemy until all down; tractor-expose a colossus while firing */
async function clearEnemies(bots: Bot[]): Promise<boolean> {
  for (let i = 0; i < 70; i++) {
    const alive = (bots[0].snapshot?.enemies ?? []).filter((e) => e.state !== 'down');
    if (!alive.length) return true;
    for (const e of alive) {
      const shooter = bots[0];
      const dx = shooter.pos[0] - e.p[0], dz = shooter.pos[2] - e.p[2];
      const d = Math.hypot(dx, dz) || 1;
      // approach at the enemy's height (bots noclip) so an elevated foe is in view
      if (d > 12 || Math.abs(shooter.pos[1] - e.p[1]) > 2)
        await shooter.walkTo([e.p[0] + (dx / d) * 8, e.p[1] + 0.2, e.p[2] + (dz / d) * 8]);
      if (e.type === 'colossus' && bots[1]) {
        bots[1].send({ t: 'tractor', v: 1, active: true, targetId: e.id, aim: [e.p[0], e.p[1], e.p[2] - 2] });
        await sleep(150);
      }
      for (const s of bots) await fireAt(s, 'pulse', [e.p[0], e.p[1] + 0.8, e.p[2]], e.id);
    }
    await sleep(650);
  }
  return (bots[0].snapshot?.enemies ?? []).every((e) => e.state === 'down');
}

async function grabBody(bot: Bot, bodyId: string, pos: Vec3) {
  // Walk to the body's LIVE position — a pulse during combat can knock an unheld
  // carryable off its start spot, so a hardcoded hint would leave the bot out of reach.
  const live = () => bot.snapshot?.bodies?.find((b) => b.id === bodyId)?.p as Vec3 | undefined;
  const carrying = () => bot.snapshot?.players?.find((p) => p.id === bot.id)?.carrying === bodyId;
  await bot.walkTo(live() ?? [pos[0], pos[1], pos[2]]);
  // a heavy body's snapshot heldBy only shows holders[0], so verify via the
  // grabber's own player.carrying instead (set for every holder)
  try {
    await bot.attempt(() => bot.send({ t: 'grab', v: 1, target: bodyId }), carrying, `grab ${bodyId}`, 6000);
  } catch {
    await bot.walkTo(live() ?? [pos[0], pos[1], pos[2]]);   // it may have drifted; re-approach once
    await bot.attempt(() => bot.send({ t: 'grab', v: 1, target: bodyId }), carrying, `grab ${bodyId}`, 6000);
  }
}

/** carry a held body so it drops centred on a target x,z (holder south of it, facing -z) */
async function dropAt(holders: Bot[], target: Vec3) {
  for (const h of holders) { h.yaw = 0; await h.walkTo([target[0], 1, target[2] + 1.2]); }
  await sleep(400);
  for (const h of holders) h.send({ t: 'release', v: 1 });
  await sleep(900);
}

async function standOn(bot: Bot, plate: Vec3) { await bot.walkTo([plate[0], plate[1] + 0.9, plate[2]]); }

/** Carry a body to a drop point and release; if it doesn't land on target (held
    cargo collides with walls even though bots noclip, so it can snag on a doorway),
    re-grab from wherever it ended up and retry the routed approach. `after` lets the
    holder step onto a plate with the body (mass puzzles). Returns whether `done` held. */
async function ferryTo(bot: Bot, bodyId: string, approach: Vec3[], drop: Vec3,
  done: () => boolean, opts: { tries?: number; after?: Vec3 } = {}): Promise<boolean> {
  const { tries = 4, after } = opts;
  const carrying = () => bot.snapshot?.players?.find((p) => p.id === bot.id)?.carrying === bodyId;
  for (let i = 0; i < tries && !done(); i++) {
    if (!carrying()) {
      const bp = bot.snapshot?.bodies?.find((b) => b.id === bodyId)?.p;
      if (bp) await bot.walkTo([bp[0], 1, bp[2]]);
      try { await bot.attempt(() => bot.send({ t: 'grab', v: 1, target: bodyId }), carrying, `grab ${bodyId}`, 6000); } catch { /* retry */ }
    }
    for (const wp of approach) await bot.walkTo(wp);
    bot.yaw = 0;
    await bot.walkTo(drop);
    await sleep(400);
    bot.send({ t: 'release', v: 1 });
    if (after) await bot.walkTo(after);
    await sleep(900);
  }
  return done();
}

/** enter a device-granting level (co-op gate) so the pair keeps the device */
async function provision(a: Bot, b: Bot, level: string, device: string) {
  await pairEnter(a, b, level);
  await a.until(() => a.msgs.some((m) => m.t === 'devices' && m.devices.includes(device as never)), `A gets ${device}`, 9000);
  await b.until(() => b.msgs.some((m) => m.t === 'devices' && m.devices.includes(device as never)), `B gets ${device}`, 9000);
}

async function audit(name: string, fn: (a: Bot, b: Bot) => Promise<void>) {
  console.log(`\n— ${name} —`);
  const a = new Bot(`${name}-A`), b = new Bot(`${name}-B`);
  try {
    await a.open(); await b.open();
    await fn(a, b);
    await a.until(() => a.solved, `${name} solved`, 8000);
    check(true, `${name}: solved by the intended path`);
    check(a.shards.includes(name), `${name}: shard granted`);
  } catch (e) {
    check(false, `${name}: ${(e as Error).message}`);
  } finally { a.close(); b.close(); }
}

async function auditAll() {
  // atrium-03 — three levers to a posture combo + a mass-2 choir plate (no combat)
  await audit('atrium-03', async (a, b) => {
    await pairEnter(a, b, 'atrium-03');
    a.send({ t: 'reset_level', v: 1 }); await sleep(700);
    await setState(a, 'choirA', [-2, 0.8, -5.4], 2);
    await setState(a, 'choirC', [2, 0.8, -5.4], 1);   // choirB stays 0
    await standOn(a, [0, 0.15, 4]); await standOn(b, [0.6, 0.15, 4]);   // mass 2
  });

  // vaults-02 — clear, pre-set both rotators, then 2-carry the heavy keystone to its plate
  await audit('vaults-02', async (a, b) => {
    await pairEnter(a, b, 'vaults-02');
    a.send({ t: 'reset_level', v: 1 }); await sleep(700);
    check(await clearEnemies([a, b]), 'vaults-02: enemies cleared');
    await setState(a, 'rotator1', [-6, 0.9, -3], 2);
    await setState(a, 'rotator2', [6, 0.9, -3], 1);
    await grabBody(a, 'keystone', [0, 1.1, 14]);
    await grabBody(b, 'keystone', [0, 1.1, 14]);
    await dropAt([a, b], [0, 0.15, -16]);             // keystonePlate (mass 3)
  });

  // vaults-03 — needs Freeze (from vaults-01): prism→socket, aim emitter, hold shutter, freeze column
  await audit('vaults-03', async (a, b) => {
    await provision(a, b, 'vaults-01', 'freeze');
    a.send({ t: 'equip', v: 1, device: 'freeze' }); b.send({ t: 'equip', v: 1, device: 'freeze' });
    await pairEnter(a, b, 'vaults-03');
    a.send({ t: 'reset_level', v: 1 }); await sleep(700);
    check(await clearEnemies([a, b]), 'vaults-03: enemies cleared');
    await a.walkTo([7, 1, 15]);
    await a.attempt(() => a.send({ t: 'pickup', v: 1, itemId: 'prism' }), () => a.st('prism')?.collected === true, 'take prism');
    await a.walkTo([0, 1, -1]);                        // prismMount now sits where the beam crosses x=0
    await a.attempt(() => a.send({ t: 'use_item', v: 1, item: 'prism', socketId: 'prismMount' }),
      () => a.st('prismMount')?.filled === true, 'socket prism');
    await a.walkTo([-8, 1, 3]);                            // skirt north of the steam column (still hot)
    await setState(a, 'emitterMount', [-8, 0.9, -1], 1);   // state 1 retracts the aperture rib
    await standOn(b, [3, 0.15, -13]);                 // hold shutterPlate
    await a.until(() => b.st('shutterPlate')?.pressed === true, 'shutter held');
    // freeze the column last (7s window) and expect the beam to light r1
    await a.walkTo([-3, 1, 2]);
    await a.attempt(() => { a.yaw = 0; a.send({ t: 'equip', v: 1, device: 'freeze' }); fireAt(a, 'freeze', [-3, 1.5, -1], undefined); },
      () => a.st('column')?.frozen === true && a.st('r1')?.lit === true, 'freeze column → beam lights r1', 14000);
  });

  // gardens-01 — grants Tractor: seed-stones onto rising plate-islands + rotate the aim ring
  await audit('gardens-01', async (a, b) => {
    await pairEnter(a, b, 'gardens-01');
    a.send({ t: 'reset_level', v: 1 }); await sleep(700);
    check(await clearEnemies([a, b]), 'gardens-01: enemies cleared');
    await setState(a, 'aimRing', [-12.5, 0.8, 6], 1);
    await grabBody(a, 'seedA', [-3, 0.9, 12.6]); await dropAt([a], [-3, 0.15, 3]);   // plateA
    await grabBody(a, 'seedB', [0, 0.9, 12.6]); await dropAt([a], [3, 0.15, 3]);     // plateB
    await a.until(() => a.st('plateA')?.pressed === true && a.st('plateB')?.pressed === true, 'A+B pressed (cage opens)');
    await grabBody(a, 'seedC', [3, 0.9, 12.6]); await dropAt([a], [0, 0.15, -6]);    // plateC (needs 2)
    await grabBody(a, 'seedD', [-6, 0.9, -15.8]); await dropAt([a], [0, 0.15, -6]);
  });

  // gardens-03 — set the bridge wheel, drop the shutter for the beam, hold the summit plate
  await audit('gardens-03', async (a, b) => {
    await pairEnter(a, b, 'gardens-03');
    a.send({ t: 'reset_level', v: 1 }); await sleep(700);
    check(await clearEnemies([a, b]), 'gardens-03: enemies cleared');
    await setState(a, 'wheel', [6, 1, 6], 2);
    await standOn(a, [5, 6, -4]);                     // shutterPlate → drops shutter for em1→rec1
    await standOn(b, [0, 6, -7]);                     // summitPlate
  });

  // observatory-01 — orrery alignment threads the beam, then a two-plate sync
  await audit('observatory-01', async (a, b) => {
    await pairEnter(a, b, 'observatory-01');
    a.send({ t: 'reset_level', v: 1 }); await sleep(700);
    await setState(a, 'ringX', [-6, 0.8, 2], 3);
    await setState(a, 'ringY', [0, 0.8, 2], 1);
    await setState(a, 'ringZ', [6, 0.8, 2], 2);
    await a.until(() => a.st('rec1')?.lit === true, 'beam threads all rings → rec1 lit', 6000);
    check(await clearEnemies([a, b]), 'observatory-01: enemies cleared');
    await standOn(a, [-5.5, 0, -10]); await standOn(b, [5.5, 0, -10]);   // syncA + syncB
  });

  // observatory-02 — finale: wake (prisms→sockets), colossus (tractor), reach the final plate
  await audit('observatory-02', async (a, b) => {
    await provision(a, b, 'gardens-01', 'tractor');   // colossus needs the Tractor
    await pairEnter(a, b, 'observatory-02');
    a.send({ t: 'reset_level', v: 1 }); await sleep(700);
    check(await clearEnemies([a, b]), 'observatory-02: colossus + wardens down');
    await grabBody(a, 'prismL', [-15, 1.4, 6]); await dropAt([a], [-13, 1, 2]);   // socketL
    await grabBody(b, 'prismR', [15, 1.4, 6]); await dropAt([b], [13, 1, 2]);     // socketR
    await a.until(() => a.st('recL')?.lit === true && a.st('recR')?.lit === true, 'both receivers lit');
    await standOn(a, [0, 8.5, -48]);                  // finalPlate
  });
}

async function guarded(name: string, fn: () => Promise<void>) {
  try { await fn(); } catch (e) { check(false, `${name}: aborted — ${(e as Error).message}`); }
}

try {
  await guarded('chat/ping', testChatAndPing);
  await guarded('atrium-01', testSoloAtrium01);
  await guarded('atrium-02', testCoopAtrium02);
  await guarded('down/revive', testDownRevive);
  await guarded('vaults-01', testFreezeVaults01);
  await guarded('gardens-02', testPortalsGardens02);
  await auditAll();
  console.log(failures ? `\n${failures} FAILURES` : '\nALL PLAYTESTS PASSED');
  process.exit(failures ? 1 : 0);
} catch (e) {
  console.error('\nPLAYTEST ERROR:', (e as Error).message);
  process.exit(1);
}
