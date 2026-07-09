// Solvability audit for proving-01 (The Proving Ground): drives one protocol bot
// through every new mechanic — resonator order (incl. wrong-note reset), the
// weight scale, the mimic ambush, and the carried-prism beam relay.
// Usage: PORT=8080 tsx server/index.ts &  then  tsx tools/playtest-proving.ts
import WebSocket from 'ws';
import type { ClientMsg, ServerMsg } from '../shared/messages';
import type { Vec3 } from '../shared/level';

const URL = process.env.WS_URL ?? 'ws://127.0.0.1:8080/ws';
const results: { name: string; ok: boolean; note?: string }[] = [];
const check = (name: string, ok: boolean, note?: string) => {
  results.push({ name, ok, note });
  console.log(`  ${ok ? '✓' : '✗ FAIL'} ${name}${note ? `: ${note}` : ''}`);
};

class Bot {
  ws: WebSocket;
  pos: Vec3 = [0, 1, 0];
  yaw = 0;
  states = new Map<string, Record<string, number | boolean>>();
  enemies = new Map<string, { state: string; hp: number }>();
  shards: string[] = [];
  solved = false;
  levelId = '';
  private moveTimer?: ReturnType<typeof setInterval>;

  constructor() { this.ws = new WebSocket(URL); }

  send(m: ClientMsg) { this.ws.send(JSON.stringify(m)); }

  async start(): Promise<void> {
    await new Promise<void>((res, rej) => {
      this.ws.on('open', () => res());
      this.ws.on('error', rej);
    });
    this.ws.on('message', (raw) => this.onMsg(JSON.parse(String(raw)) as ServerMsg));
    this.send({ t: 'hello', v: 1, name: 'ProvingBot' });
    // stream position at client cadence so the server tracks us
    this.moveTimer = setInterval(() => this.send({ t: 'move', v: 1, p: this.pos, yaw: this.yaw, pitch: 0 }), 66);
  }

  onMsg(m: ServerMsg) {
    if (m.t === 'joined') {
      this.levelId = m.snapshot.levelId ?? '';
      this.pos = [...m.spawn] as Vec3;
      this.states.clear();
      for (const [id, st] of Object.entries(m.snapshot.states ?? {})) this.states.set(id, { ...st });
    }
    if (m.t === 'state_update') this.states.set(m.id, { ...(this.states.get(m.id) ?? {}), ...m.state });
    if (m.t === 'snap') for (const e of m.s.enemies ?? []) this.enemies.set(e.id, { state: e.state, hp: e.hp });
    if (m.t === 'shards') this.shards = m.shards;
    if (m.t === 'solved') this.solved = true;
  }

  /** walk in server-acceptable hops (< 12m per accepted move) */
  async walkTo(p: Vec3) {
    for (let guard = 0; guard < 60; guard++) {
      const d = [p[0] - this.pos[0], p[1] - this.pos[1], p[2] - this.pos[2]];
      const l = Math.hypot(...d);
      if (l < 0.3) { this.pos = [...p] as Vec3; return; }
      const s = Math.min(1, 6 / l);
      this.pos = [this.pos[0] + d[0] * s, this.pos[1] + d[1] * s, this.pos[2] + d[2] * s];
      await sleep(140);
    }
  }

  /** pulse at a world point (validated server-side by ray + LOS) */
  fireAt(target: Vec3, targetId?: string) {
    const origin: Vec3 = [this.pos[0], this.pos[1] + 1.5, this.pos[2]];
    const d: Vec3 = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
    const l = Math.hypot(...d) || 1;
    this.send({ t: 'fire', v: 1, device: 'pulse', origin, dir: [d[0] / l, d[1] / l, d[2] / l], targetId });
  }

  lit(id: string) { return !!this.states.get(id)?.lit; }
  stop() { clearInterval(this.moveTimer); this.ws.close(); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return true;
    await sleep(120);
  }
  return cond();
}

async function main() {
  console.log('— PROVING GROUND: solo audit of the new mechanics —');
  const bot = new Bot();
  await bot.start();
  await until(() => bot.levelId !== '', 5000);
  bot.send({ t: 'enter_level', v: 1, level: 'proving-01' });
  check('entered proving-01', await until(() => bot.levelId === 'proving-01', 6000));
  await sleep(600);
  // a lingering instance may already be part-solved — always audit from scratch
  bot.send({ t: 'reset_level', v: 1 });
  bot.solved = false;
  await sleep(1200);

  // chamber 1: resonators — wrong note first, then the rising order
  await bot.walkTo([0, 1, 17]);
  bot.fireAt([0, 0.6, 12]);                                   // chime2 out of order
  await sleep(800);
  check('wrong-order note resets the chord', !bot.lit('chime2'));
  bot.fireAt([-6, 0.6, 14]); await sleep(800);                // chime1
  bot.fireAt([0, 0.6, 12]); await sleep(800);                 // chime2
  bot.fireAt([6, 0.6, 14]); await sleep(800);                 // chime3
  check('chimes sounded in rising order', await until(() => bot.lit('chime1') && bot.lit('chime2') && bot.lit('chime3'), 3000));

  // chamber 2: both crates onto the LEFT pan of the scale
  for (const crate of ['c1', 'c2'] as const) {
    const at = bot.states.get(crate);                          // crates aren't in states — walk to spawn spots
    void at;
    await bot.walkTo(crate === 'c1' ? [3, 1, 1] : [5, 1, -1]);
    bot.send({ t: 'grab', v: 1, target: crate });
    await sleep(400);
    bot.yaw = -Math.PI / 2;                                    // face +X: carried crate floats toward the pan
    await bot.walkTo([-6.7, 1, -2]);
    await sleep(600);
    bot.send({ t: 'release', v: 1 });
    await sleep(900);
  }
  check('scale reads 2 on the left pan', await until(() => (bot.states.get('pgscale')?.left as number) >= 2, 5000),
    `left=${bot.states.get('pgscale')?.left}`);

  // chamber 3: put down the mimic, ferry the prism into the beam mount
  await bot.walkTo([0, 1, -14]);
  await bot.walkTo([-4, 1, -19]);
  const sawMimic = await until(() => (bot.enemies.get('mim1')?.state ?? 'idle') !== 'idle', 4000);
  check('mimic sprang its ambush', sawMimic, bot.enemies.get('mim1')?.state);
  for (let i = 0; i < 6 && bot.enemies.get('mim1')?.state !== 'down'; i++) {
    bot.fireAt([-2, 0.55, -21.5], 'mim1');
    await sleep(750);
  }
  check('mimic destroyed', await until(() => bot.enemies.get('mim1')?.state === 'down', 4000));
  await bot.walkTo([-4, 1, -22]);
  bot.send({ t: 'grab', v: 1, target: 'prism1' });
  await sleep(400);
  bot.yaw = -Math.PI / 2;
  await bot.walkTo([2.6, 1, -16]);
  await sleep(600);
  bot.send({ t: 'release', v: 1 });
  check('prism docked in the beam mount', await until(() => !!bot.states.get('mount1')?.filled, 5000));
  check('receiver lit through the prism relay', await until(() => bot.lit('recv1'), 4000));

  check('level solved', await until(() => bot.solved, 6000));
  check('proving shard granted', await until(() => bot.shards.includes('shard-proving'), 4000));

  bot.stop();
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `\n${failed.length} FAILURES` : '\nPROVING GROUND AUDIT PASSED');
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
