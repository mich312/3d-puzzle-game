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
      if (m.t === 'shards') this.shards = m.shards;
    });
    this.mover = setInterval(() => {
      if (this.ws.readyState === WebSocket.OPEN && this.id)
        this.send({ t: 'move', v: 1, p: this.pos, yaw: this.yaw, pitch: 0, anim: 0 });
    }, 80);
  }
  send(m: ClientMsg) { this.ws.send(JSON.stringify(m)); }
  async open() {
    await new Promise<void>((res) => this.ws.on('open', () => res()));
    this.send({ t: 'hello', v: 1, name: this.name });
    await this.until(() => !!this.id, 'welcome');
    await this.until(() => !!this.snapshot, 'joined lobby');
  }
  /** teleport-free walk: move in small legal steps (server rejects >12m jumps) */
  async walkTo(p: Vec3) {
    for (let guard = 0; guard < 200; guard++) {
      const dx = p[0] - this.pos[0], dy = p[1] - this.pos[1], dz = p[2] - this.pos[2];
      const d = Math.hypot(dx, dy, dz);
      if (d < 0.4) return;
      const step = Math.min(4, d);
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
  a.send({ t: 'enter_level', v: 1, level: 'atrium-02' });
  await a.until(() => a.levelId === 'atrium-02', 'A enters');
  b.send({ t: 'enter_level', v: 1, level: 'atrium-02' });
  await b.until(() => b.levelId === 'atrium-02', 'B enters');
  a.send({ t: 'reset_level', v: 1 });
  await sleep(800);
  check((a.snapshot?.players.length ?? 0) === 2, 'both bots share one instance');

  // read plate positions from the level def the server sent
  const lv = a.snapshot?.level ?? (a.msgs.find((m) => m.t === 'joined') as { snapshot?: InstanceSnapshot })?.snapshot?.level;
  const joined = a.msgs.find((m) => m.t === 'joined' && (m as { snapshot: InstanceSnapshot }).snapshot.levelId === 'atrium-02') as { snapshot: InstanceSnapshot } | undefined;
  const def = joined?.snapshot.level;
  const bellA = def?.interactables?.find((i) => i.id === 'bellA') as { pos: Vec3 } | undefined;
  const bellB = def?.interactables?.find((i) => i.id === 'bellB') as { pos: Vec3 } | undefined;
  if (!bellA || !bellB) throw new Error('bells not found in level def');

  // kill the drifters first (they'd interrupt)
  for (let i = 0; i < 25; i++) {
    const alive = (a.snapshot?.enemies ?? []).filter((e) => e.state !== 'down');
    if (!alive.length) break;
    const e = alive[0];
    await a.walkTo([e.p[0] - 3, e.p[1], e.p[2]]);
    await fireAt(a, 'pulse', [e.p[0], e.p[1] + 0.8, e.p[2]], e.id);
    await sleep(700);
  }
  check((a.snapshot?.enemies ?? []).every((e) => e.state === 'down'), 'arena cleared');

  await a.walkTo([bellA.pos[0], bellA.pos[1] + 1, bellA.pos[2]]);
  await b.walkTo([bellB.pos[0], bellB.pos[1] + 1, bellB.pos[2]]);
  await a.until(() => a.solved, 'simultaneity solve', 12000);
  check(true, 'both plates pressed at once → solved');
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
  console.log('\n— TEST 4: Freeze Ray mechanics in vaults-01 (Cold Store) —');
  const a = new Bot('BotFrost');
  await a.open();
  a.send({ t: 'enter_level', v: 1, level: 'vaults-01' });
  await a.until(() => a.levelId === 'vaults-01', 'enter vaults-01');
  a.send({ t: 'reset_level', v: 1 });
  await sleep(800);
  const gotFreeze = a.msgs.some((m) => m.t === 'devices' && m.devices.includes('freeze'));
  check(gotFreeze, 'Freeze Ray granted on entry');

  // freeze the first steam hazard from in front of it
  await a.walkTo([0, 1, -2]);
  a.send({ t: 'equip', v: 1, device: 'freeze' });
  await a.attempt(() => {
    const origin: Vec3 = [a.pos[0], a.pos[1] + 1.5, a.pos[2]];
    const d: Vec3 = [0 - origin[0], 1.5 - origin[1], -5 - origin[2]];
    const l = Math.hypot(...d) || 1;
    a.send({ t: 'fire', v: 1, device: 'freeze', origin, dir: [d[0] / l, d[1] / l, d[2] / l] });
  }, () => a.st('steamA')?.frozen === true, 'steamA frozen');
  check(true, 'steam hazard frozen (puzzle use)');

  // freeze the drifter, then shatter it with a pulse (environmental kill)
  await a.walkTo([0, 1, -8]);
  await a.attempt(() => {
    const origin: Vec3 = [a.pos[0], a.pos[1] + 1.5, a.pos[2]];
    const d2: Vec3 = [0 - origin[0], 1.5 - origin[1], -11 - origin[2]];
    const l = Math.hypot(...d2) || 1;
    a.send({ t: 'fire', v: 1, device: 'freeze', origin, dir: [d2[0] / l, d2[1] / l, d2[2] / l] });
  }, () => a.st('steamB')?.frozen === true, 'steamB frozen');
  await a.walkTo([0, 1, -15]);
  await a.attempt(() => {
    const e = a.enemy('d1');
    if (e) fireAt(a, 'freeze', [e.p[0], e.p[1] + 0.8, e.p[2]], 'd1');
  }, () => a.enemy('d1')?.state === 'frozen', 'drifter frozen', 15000);
  check(true, 'drifter frozen solid');
  await a.attempt(() => {
    const e = a.enemy('d1');
    if (e) fireAt(a, 'pulse', [e.p[0], e.p[1] + 0.8, e.p[2]], 'd1');
  }, () => a.enemy('d1')?.state === 'down', 'freeze-shatter', 12000);
  check(true, 'frozen enemy shattered by pulse');

  // pulse the exit switch and finish
  await a.walkTo([0, 1, -24]);
  await a.walkTo([0, 1, -30]);
  await a.attempt(() => fireAt(a, 'pulse', [3.6, 1.8, -33.4]),
    () => a.st('exitSwitch')?.on === true, 'exitSwitch');
  await a.until(() => a.solved, 'vaults-01 solved');
  check(a.shards.includes('vaults-01'), 'shard granted (solo freeze route)');
  a.close();
}

try {
  await testSoloAtrium01();
  await testCoopAtrium02();
  await testDownRevive();
  await testFreezeVaults01();
  console.log(failures ? `\n${failures} FAILURES` : '\nALL PLAYTESTS PASSED');
  process.exit(failures ? 1 : 0);
} catch (e) {
  console.error('\nPLAYTEST ERROR:', (e as Error).message);
  process.exit(1);
}
