// Security regression suite: sends malformed and malicious protocol messages to a
// running server and asserts every one is rejected without crashing it
// (prototype-key skills, NaN/oversize moves, speed hacks, sealed levels, name
// spoofing, portal/fire/tractor/telemetry abuse, ghost sessions, token takeover,
// oversize payloads, floods). Must run WITHOUT THRESHOLD_DEV_UNLOCK.
// Usage: PORT=8080 npx tsx server/index.ts &   then   npx tsx tools/playtest-security.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import WebSocket from 'ws';
const URL = process.env.WS_URL ?? 'ws://127.0.0.1:8080/ws';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${what}`); if (!ok) fails++; };

class C {
  ws: WebSocket; msgs: any[] = []; id = ''; token = ''; closed = false; closeCode = 0;
  constructor() {
    this.ws = new WebSocket(URL);
    this.ws.on('message', (r: any) => { const m = JSON.parse(String(r)); this.msgs.push(m); if (m.t === 'welcome') { this.id = m.playerId; this.token = m.token; } });
    this.ws.on('close', (code: number) => { this.closed = true; this.closeCode = code; });
  }
  async open(hello: any = {}) {
    await new Promise((res) => this.ws.once('open', res));
    this.raw({ t: 'hello', v: 1, name: 'Mallory', ...hello });
    for (let i = 0; i < 100 && !this.msgs.some((m) => m.t === 'joined'); i++) await sleep(50);
  }
  raw(m: any) { this.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); }
  last(t: string) { return [...this.msgs].reverse().find((m) => m.t === t); }
  joined() { return this.msgs.filter((m) => m.t === 'joined'); }
  me() { const s = [...this.msgs].reverse().find((m) => m.t === 'snap' || m.t === 'joined'); const snap = s?.s ?? s?.snapshot; return snap?.players?.find((p: any) => p.id === this.id); }
}
async function health() { return (await fetch(URL.replace('ws://', 'http://').replace('/ws', '/api/health'))).json(); }

async function main() {
  const a = new C(); await a.open();
  check(!!a.id, 'connected');
  const welcome = a.last('welcome');
  console.log('    profile skillPoints', welcome.profile.skillPoints, 'shards', welcome.profile.shards.length);

  // 1. prototype-key skill
  a.msgs = [];
  for (const skill of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) a.raw({ t: 'unlock_skill', v: 1, skill });
  await sleep(300);
  check(!a.msgs.some((m) => m.t === 'skills'), 'unlock_skill "constructor"/"__proto__" rejected (no skills msg)');
  a.raw({ t: 'unlock_skill', v: 1, skill: 'dash' }); await sleep(300);
  check(!a.msgs.some((m) => m.t === 'skills'), 'real skill without points still rejected (skillPoints not NaN)');

  // 2. NaN / malformed moves
  await sleep(700);
  const before = a.me()?.p;
  a.raw('{"t":"move","v":1,"p":[NaN,1,0],"yaw":0,"pitch":0}');           // invalid JSON actually
  a.raw({ t: 'move', v: 1, p: [null, 1, 0], yaw: 0, pitch: 0 });            // NaN serialises to null
  a.raw({ t: 'move', v: 1, p: [1e308 * 10, 1, 0], yaw: 0, pitch: 0 });
  a.raw({ t: 'move', v: 1, p: [0, 1], yaw: 0, pitch: 0 });
  a.raw({ t: 'move', v: 1, p: [0, 1, 0, 5], yaw: 0, pitch: 0 });
  a.raw({ t: 'move', v: 1, p: ['1', 1, 0], yaw: 0, pitch: 0 });
  a.raw({ t: 'move', v: 1, p: [0, 1, 0], yaw: null, pitch: 0 });
  a.raw({ t: 'move', v: 1, p: [0, 1, 0], yaw: 0, pitch: 0, anim: 'x' });
  await sleep(400);
  const after = a.me()?.p;
  check(!!after && after.every((n: any) => typeof n === 'number' && Number.isFinite(n)), `malformed moves rejected, position still finite (${JSON.stringify(after)})`);
  check(JSON.stringify(before) === JSON.stringify(after), 'position unchanged by malformed moves');

  // 2b. speed budget: 10 hops of 8 m in 0.5 s (each under the 12 m cap) must be corrected
  a.msgs = [];
  let p = [...after];
  for (let i = 0; i < 10; i++) { p = [p[0] + 8, p[1], p[2]]; a.raw({ t: 'move', v: 1, p, yaw: 0, pitch: 0, anim: 0 }); await sleep(50); }
  await sleep(300);
  const sp = a.me()?.p;
  check(a.msgs.some((m) => m.t === 'respawn') && sp[0] < after[0] + 20, `speed hack corrected (moved ${(sp[0] - after[0]).toFixed(1)} m of 80 m)`);

  // 3. enter locked level without dev flag
  a.msgs = [];
  a.raw({ t: 'enter_level', v: 1, level: 'observatory-02' });
  a.raw({ t: 'enter_level', v: 1, level: 'nexus' });
  a.raw({ t: 'enter_level', v: 1, level: 'constructor' });
  await sleep(600);
  check(!a.msgs.some((m) => m.t === 'joined'), 'enter_level to locked observatory-02 / nexus / constructor rejected');
  check(a.msgs.some((m) => m.t === 'error' && m.code === 'sealed'), 'sealed error reported');
  a.raw({ t: 'join_instance', v: 1, instanceId: 'wait-vaults-01' }); await sleep(400);
  check(!a.msgs.some((m) => m.t === 'joined' || m.t === 'gate_wait'), 'join_instance wait-<locked level> rejected');
  // locked hello target
  const t = new C(); await t.open({ target: 'wait-observatory-01' });
  check(t.joined()[0]?.snapshot?.kind === 'lobby' && !t.msgs.some((m) => m.t === 'gate_wait'), 'hello target to locked level lands in lobby, not queued');
  t.ws.close();

  // 4. array / reserved / zero-width names
  a.msgs = [];
  a.raw({ t: 'set_name', v: 1, name: ['x', 'y'] });
  a.raw({ t: 'set_name', v: 1, name: { toString: 1 } });
  a.raw({ t: 'set_name', v: 1, name: 'THRESHOLD' });
  a.raw({ t: 'set_name', v: 1, name: 'T​HRESHOLD' });
  await sleep(400);
  check(a.me()?.name === 'Mallory', `array/object/"THRESHOLD"/zero-width names rejected (name=${a.me()?.name})`);
  a.raw({ t: 'set_name', v: 1, name: 'Mal‮lory\u0007' }); await sleep(300);
  check(a.me()?.name === 'Mallory', 'bidi/control chars stripped from names');

  // 5. portal slot 5 / NaN fire / bogus tractor / bad telemetry — must not crash the server
  a.raw({ t: 'enter_level', v: 1, level: 'atrium-01' });
  for (let i = 0; i < 40 && a.last('joined')?.snapshot?.levelId !== 'atrium-01'; i++) await sleep(100);
  check(a.last('joined')?.snapshot?.levelId === 'atrium-01', 'legit enter_level to unlocked atrium-01 still works');
  a.msgs = [];
  a.raw({ t: 'place_portal', v: 1, slot: 5, pos: [0, 1, 0], normal: [0, 1, 0] });
  a.raw({ t: 'place_portal', v: 1, slot: 0, pos: [null, 1, 0], normal: [0, 1, 0] });
  a.raw({ t: 'fire', v: 1, device: 'pulse', origin: [null, 0, 0], dir: [0, 0, 0] });
  a.raw({ t: 'fire', v: 1, device: 'constructor', origin: [0, 0, 0], dir: [0, 0, 1] });
  a.raw({ t: 'fire', v: 1, device: 'pulse', origin: [0, 1, 0], dir: [0, 0, -1], targetId: 'x'.repeat(5000) });
  a.raw({ t: 'tractor', v: 1, active: true, targetId: 'cube', aim: [1e9, 0, 0] });
  a.raw({ t: 'ping', v: 1, pos: [null, 0, 0] });
  a.raw({ t: 'telemetry', v: 1, name: 'solved', payload: {} });
  a.raw({ t: 'telemetry', v: 1, name: 'ui', payload: { big: 'x'.repeat(4000) } });
  a.raw({ t: 'chat', v: 1, text: ['hi'] });
  a.raw({ t: 'equip', v: 1, device: '__proto__' });
  await sleep(500);
  check(!a.msgs.some((m) => m.t === 'portal_placed' || m.t === 'ping'), 'portal slot 5 / NaN portal / NaN ping rejected');
  check((await health()).ok === true, 'server alive after malformed fire/tractor/telemetry/chat');

  // 6. second hello on the same socket doesn't create a ghost session
  const h0 = (await health()).players;
  a.raw({ t: 'hello', v: 1, name: 'Ghost' }); a.raw({ t: 'hello', v: 1, name: 'Ghost2' });
  await sleep(400);
  check((await health()).players === h0, `second hello ignored (players ${h0} → ${(await health()).players})`);

  // 7. token takeover keeps level slot, closes old socket
  const b = new C(); await b.open({ token: a.token });
  await sleep(400);
  check(b.id === a.id, 'takeover resumes the same session id');
  check(b.joined()[0]?.snapshot?.levelId === 'atrium-01', 'takeover resumes in-level slot (not dumped to lobby)');
  check(a.closed && a.closeCode === 4001, `old socket closed (code ${a.closeCode})`);
  check((await health()).players === h0, 'no extra session after takeover');

  // 8. oversize payload closes socket
  const big = new C(); await big.open();
  big.raw({ t: 'chat', v: 1, text: 'x'.repeat(20000) });
  await sleep(400);
  check(big.closed, `oversize (20 KiB) message closes socket (code ${big.closeCode})`);

  // 9. message flood
  const f = new C(); await f.open();
  for (let i = 0; i < 1000; i++) f.raw({ t: 'revive_cancel', v: 1 });
  await sleep(600);
  check(f.closed, `flooding socket closed (code ${f.closeCode})`);
  check((await health()).ok === true, 'server still healthy');

  b.ws.close();
  console.log(fails ? `\n${fails} FAILURES` : '\nALL MALICIOUS INPUTS REJECTED');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
