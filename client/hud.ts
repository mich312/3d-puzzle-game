// DOM HUD: minimal chrome (spec §10) — roster, level name, shard pips, health,
// device bar, prompts, toasts, loadout/skill panels, settings, beacons, overlays.
import { DEVICES, type DeviceId } from '../shared/devices';
import { SKILLS, type SkillId } from '../shared/skills';
import type { InstanceSnapshot } from '../shared/messages';

export interface HudCallbacks {
  onStart(name: string): void;
  onEquip(d: DeviceId): void;
  onUnlockSkill(s: SkillId): void;
  onRespec(): void;
  onJoinBeacon(instanceId: string): void;
  onReset(): void;
  onLeaveLevel(): void;
  onBeacon(): void;
  onSettings(s: { sensitivity: number; master: number; music: number; sfx: number; difficulty: 'normal' | 'story'; reduceMotion: boolean }): void;
}

const CSS = `
#hud, #hud * { box-sizing: border-box; margin: 0; user-select: none; }
#hud { position: fixed; inset: 0; pointer-events: none; color: #e8e4f0; font-family: 'Segoe UI', system-ui, sans-serif; z-index: 10; }
#hud .panel { background: rgba(18,16,32,0.82); border: 1px solid rgba(160,150,220,0.25); border-radius: 10px; backdrop-filter: blur(6px); }
#crosshair { position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px; border-radius: 50%; background: rgba(255,255,255,0.85); box-shadow: 0 0 6px rgba(255,255,255,0.6); }
#levelinfo { position: absolute; top: 14px; left: 16px; padding: 8px 14px; font-size: 13px; }
#levelinfo b { font-size: 16px; letter-spacing: 0.06em; }
#levelinfo .tier { opacity: 0.75; font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; }
#shards { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); display:flex; gap: 5px; }
#shards .pip { width: 10px; height: 14px; clip-path: polygon(50% 0, 100% 30%, 80% 100%, 20% 100%, 0 30%); background: #3a3550; }
#shards .pip.on { background: #ffd98a; box-shadow: 0 0 8px #ffd98a; }
#roster { position: absolute; top: 14px; right: 16px; padding: 8px 12px; font-size: 13px; min-width: 150px; }
#roster .row { display: flex; align-items: center; gap: 8px; margin: 3px 0; }
#roster .dot { width: 9px; height: 9px; border-radius: 50%; }
#roster .hp { flex: 1; height: 4px; background: #2a2740; border-radius: 2px; overflow: hidden; }
#roster .hp i { display: block; height: 100%; background: #a8f0c6; }
#health { position: absolute; bottom: 22px; left: 20px; width: 230px; padding: 10px 14px; }
#health .bar { height: 10px; background: #2a2740; border-radius: 5px; overflow: hidden; margin-top: 5px; }
#health .bar i { display: block; height: 100%; width: 100%; background: linear-gradient(90deg,#a8f0c6,#6ec6ff); transition: width 0.2s; }
#health.low .bar i { background: #e0654a; }
#devices { position: absolute; bottom: 22px; right: 20px; display: flex; gap: 8px; }
#devices .slot { width: 74px; padding: 8px 6px; text-align: center; font-size: 10px; border-radius: 10px; background: rgba(18,16,32,0.82); border: 1px solid rgba(160,150,220,0.25); position: relative; overflow: hidden; }
#devices .slot.eq { border-color: #ffd98a; box-shadow: 0 0 10px rgba(255,217,138,0.35); }
#devices .slot .icon { font-size: 20px; }
#devices .slot .cd { position: absolute; left: 0; bottom: 0; height: 3px; background: #6ec6ff; }
#devices .slot .ch { opacity: 0.8; }
#prompt { position: absolute; left: 50%; bottom: 130px; transform: translateX(-50%); padding: 8px 18px; font-size: 14px; display: none; }
#prompt b { color: #ffd98a; }
#toasts { position: absolute; left: 50%; top: 76px; transform: translateX(-50%); display: flex; flex-direction: column; gap: 6px; align-items: center; }
#toasts .toast { padding: 8px 18px; font-size: 14px; border-radius: 8px; background: rgba(18,16,32,0.9); border: 1px solid rgba(160,150,220,0.3); animation: fadein 0.25s; }
#toasts .toast.success { border-color: #a8f0c6; color: #cdf7e0; }
#toasts .toast.warn { border-color: #e0654a; color: #f0b0a0; }
@keyframes fadein { from { opacity: 0; transform: translateY(-6px); } }
#beacons { position: absolute; left: 16px; top: 100px; display: flex; flex-direction: column; gap: 6px; max-width: 280px; }
#beacons .b { padding: 8px 12px; font-size: 13px; pointer-events: auto; cursor: pointer; }
#beacons .b:hover { border-color: #ffd98a; }
#beacons .b .lvl { color: #ffd98a; font-weight: 600; }
#vignette { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity 0.3s; box-shadow: inset 0 0 140px 60px rgba(224,101,74,0.55); }
#downed { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; gap: 12px; background: radial-gradient(ellipse, transparent 40%, rgba(30,8,10,0.7)); font-size: 22px; letter-spacing: 0.1em; }
#downed .sub { font-size: 14px; opacity: 0.8; }
#reviveBar { width: 260px; height: 8px; background: #2a2740; border-radius: 4px; overflow: hidden; display: none; position: absolute; left: 50%; bottom: 170px; transform: translateX(-50%); }
#reviveBar i { display: block; height: 100%; background: #a8f0c6; width: 0; }
.bigpanel { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); width: min(760px, 92vw); max-height: 84vh; overflow-y: auto; padding: 22px 26px; pointer-events: auto; display: none; }
.bigpanel h2 { letter-spacing: 0.15em; font-weight: 300; margin-bottom: 12px; color: #ffd98a; }
.bigpanel h3 { margin: 14px 0 8px; font-weight: 500; font-size: 14px; letter-spacing: 0.08em; opacity: 0.9; }
.bigpanel .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px,1fr)); gap: 8px; }
.bigpanel .card { padding: 10px; border: 1px solid rgba(160,150,220,0.25); border-radius: 8px; font-size: 12px; cursor: pointer; background: rgba(30,27,50,0.6); }
.bigpanel .card:hover { border-color: #ffd98a; }
.bigpanel .card.active { border-color: #ffd98a; box-shadow: 0 0 8px rgba(255,217,138,0.3); }
.bigpanel .card.locked { opacity: 0.45; cursor: default; }
.bigpanel .card b { display: block; margin-bottom: 4px; font-size: 13px; }
.bigpanel .close { position: absolute; top: 14px; right: 18px; cursor: pointer; opacity: 0.7; font-size: 18px; }
.bigpanel label { display: flex; justify-content: space-between; align-items: center; margin: 10px 0; font-size: 13px; gap: 16px; }
.bigpanel input[type=range] { width: 220px; }
.bigpanel button { pointer-events: auto; background: #2a2740; color: #e8e4f0; border: 1px solid rgba(160,150,220,0.4); border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.bigpanel button:hover { border-color: #ffd98a; }
#intro { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 18px; background: radial-gradient(ellipse at 50% 30%, #2a2545, #14121f); z-index: 20; pointer-events: auto; }
#intro h1 { font-weight: 200; letter-spacing: 0.5em; font-size: 42px; color: #e8e4f0; text-shadow: 0 0 30px rgba(110,198,255,0.5); }
#intro p { opacity: 0.7; max-width: 420px; text-align: center; line-height: 1.5; font-size: 14px; }
#intro input { background: #221f38; border: 1px solid rgba(160,150,220,0.4); color: #e8e4f0; padding: 9px 14px; border-radius: 8px; font-size: 15px; text-align: center; outline: none; }
#intro button { background: linear-gradient(135deg,#6ec6ff33,#ff9ecb33); border: 1px solid #6ec6ff; color: #fff; font-size: 16px; padding: 12px 44px; border-radius: 10px; cursor: pointer; letter-spacing: 0.2em; }
#intro button:hover { box-shadow: 0 0 24px rgba(110,198,255,0.5); }
#intro .keys { font-size: 12px; opacity: 0.55; }
#banner { position: absolute; left: 50%; top: 34%; transform: translateX(-50%); text-align: center; display: none; }
#banner h2 { font-weight: 200; letter-spacing: 0.4em; font-size: 34px; color: #ffd98a; text-shadow: 0 0 24px rgba(255,217,138,0.7); }
#banner p { opacity: 0.85; margin-top: 6px; }
#hint { position: absolute; bottom: 90px; left: 50%; transform: translateX(-50%); font-size: 13px; opacity: 0.8; padding: 6px 14px; display: none; }
`;

const DEVICE_ICONS: Record<DeviceId, string> = { pulse: '◎', freeze: '❄', tractor: '☍', portalgun: '⊙' };

export class Hud {
  private root: HTMLElement;
  private cb: HudCallbacks;
  private owned: DeviceId[] = ['pulse'];
  private equipped: DeviceId = 'pulse';
  private skills: SkillId[] = [];
  private skillPoints = 0;
  private inventory: string[] = [];
  private shardCount = 0;
  settings = {
    sensitivity: Number(localStorage.getItem('t-sens') ?? 1),
    master: Number(localStorage.getItem('t-master') ?? 0.8),
    music: Number(localStorage.getItem('t-music') ?? 0.7),
    sfx: Number(localStorage.getItem('t-sfx') ?? 0.9),
    difficulty: (localStorage.getItem('t-diff') ?? 'normal') as 'normal' | 'story',
    reduceMotion: localStorage.getItem('t-motion') === '1',
  };

  constructor(cb: HudCallbacks) {
    this.cb = cb;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div id="vignette"></div>
      <div id="crosshair"></div>
      <div id="levelinfo" class="panel"><b id="li-name">…</b><div class="tier" id="li-tier"></div></div>
      <div id="shards"></div>
      <div id="roster" class="panel"></div>
      <div id="health" class="panel">HEALTH<div class="bar"><i></i></div></div>
      <div id="devices"></div>
      <div id="prompt" class="panel"></div>
      <div id="hint" class="panel"></div>
      <div id="toasts"></div>
      <div id="beacons"></div>
      <div id="reviveBar"><i></i></div>
      <div id="downed"><div>DOWNED</div><div class="sub" id="downed-sub"></div></div>
      <div id="banner"><h2 id="banner-h"></h2><p id="banner-p"></p></div>
      <div id="loadout" class="bigpanel panel"><span class="close" data-close="loadout">✕</span><h2>LOADOUT</h2><div id="lo-content"></div></div>
      <div id="menu" class="bigpanel panel"><span class="close" data-close="menu">✕</span><h2>THRESHOLD</h2><div id="menu-content"></div></div>
    `;
    document.body.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.dataset.close) this.hidePanel(t.dataset.close);
    });
    this.buildIntro();
  }

  private buildIntro() {
    const intro = document.createElement('div');
    intro.id = 'intro';
    const saved = localStorage.getItem('threshold-name') ?? '';
    intro.innerHTML = `
      <h1>THRESHOLD</h1>
      <p>A cooperative puzzle-adventure. Walk through a portal and think your way out —
      alone, or with whoever else steps through. Share this page's URL to bring a friend into your world.</p>
      <input id="intro-name" maxlength="24" placeholder="your name" value="${saved.replace(/"/g, '')}" />
      <button id="intro-go">ENTER</button>
      <p class="keys">WASD move · mouse look · SPACE jump · E interact · F carry · LMB device ·
      1-4 equip · Q beacon · L loadout · T echo · ESC menu</p>
    `;
    document.body.appendChild(intro);
    const go = () => {
      const name = (intro.querySelector('#intro-name') as HTMLInputElement).value.trim() || 'Wanderer';
      localStorage.setItem('threshold-name', name);
      intro.remove();
      this.cb.onStart(name);
    };
    intro.querySelector('#intro-go')!.addEventListener('click', go);
    (intro.querySelector('#intro-name') as HTMLInputElement).addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  private $(sel: string) { return this.root.querySelector(sel) as HTMLElement; }

  // ---------- live HUD ----------
  setLevelInfo(name: string, world: string, tier: string, best?: number) {
    this.$('#li-name').textContent = name;
    this.$('#li-tier').textContent = `${world}${tier ? ' · ' + tier : ''}${best ? ' · best ' + (best / 1000).toFixed(1) + 's' : ''}`;
  }
  setShards(count: number, total: number) {
    this.shardCount = count;
    const el = this.$('#shards');
    el.innerHTML = '';
    for (let i = 0; i < total; i++) el.innerHTML += `<div class="pip ${i < count ? 'on' : ''}"></div>`;
  }
  setHealth(hp: number, downed: boolean) {
    const el = this.$('#health');
    el.classList.toggle('low', hp < 35);
    (el.querySelector('i') as HTMLElement).style.width = `${Math.max(0, hp)}%`;
    this.$('#downed').style.display = downed ? 'flex' : 'none';
    this.$('#vignette').style.opacity = downed ? '0.9' : hp < 35 ? '0.5' : '0';
  }
  setDownedSub(text: string) { this.$('#downed-sub').textContent = text; }
  damageFlash() {
    const v = this.$('#vignette');
    v.style.opacity = '0.8';
    setTimeout(() => { v.style.opacity = '0'; }, 220);
  }
  setRoster(players: { name: string; accent: string; hp: number; downed: boolean; self: boolean }[]) {
    this.$('#roster').innerHTML = players.map((p) =>
      `<div class="row"><span class="dot" style="background:${p.accent};${p.downed ? 'box-shadow:0 0 6px #e0654a' : ''}"></span>
       <span style="flex:0 0 auto;${p.self ? 'color:#ffd98a' : ''}">${esc(p.name)}</span>
       <span class="hp"><i style="width:${p.hp}%"></i></span></div>`).join('');
  }
  setDevices(owned: DeviceId[], equipped: DeviceId, chargeOf: (d: DeviceId) => string, cooldownPct: (d: DeviceId) => number) {
    this.owned = owned; this.equipped = equipped;
    this.$('#devices').innerHTML = owned.map((d, i) => `
      <div class="slot ${d === equipped ? 'eq' : ''}">
        <div class="icon" style="color:${DEVICES[d].color}">${DEVICE_ICONS[d]}</div>
        <div>${DEVICES[d].name.split(' ')[DEVICES[d].name.split(' ').length - 1]}</div>
        <div class="ch">${chargeOf(d)} <span style="opacity:0.5">[${i + 1}]</span></div>
        <div class="cd" style="width:${cooldownPct(d) * 100}%"></div>
      </div>`).join('');
  }
  prompt(text: string | null) {
    const el = this.$('#prompt');
    if (!text) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.innerHTML = text;
  }
  hint(text: string | null) {
    const el = this.$('#hint');
    el.style.display = text ? 'block' : 'none';
    if (text) el.textContent = text;
  }
  toast(text: string, kind = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.$('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }
  banner(title: string, sub: string) {
    this.$('#banner-h').textContent = title;
    this.$('#banner-p').textContent = sub;
    this.$('#banner').style.display = 'block';
    setTimeout(() => { this.$('#banner').style.display = 'none'; }, 4500);
  }
  reviveProgress(pct: number | null) {
    const el = this.$('#reviveBar');
    el.style.display = pct === null ? 'none' : 'block';
    if (pct !== null) (el.querySelector('i') as HTMLElement).style.width = `${pct * 100}%`;
  }
  setBeacons(beacons: NonNullable<InstanceSnapshot['beacons']>, inLobby: boolean) {
    const el = this.$('#beacons');
    if (!inLobby || !beacons?.length) { el.innerHTML = ''; return; }
    el.innerHTML = beacons.map((b) => `
      <div class="b panel" data-join="${b.instanceId}">
        <span class="lvl">⚑ ${esc(b.levelName)}</span> needs a hand —
        ${b.present} inside${b.needed ? `, wants ${b.needed} more` : ''}. <u>Click to jump in.</u>
      </div>`).join('');
    el.querySelectorAll('[data-join]').forEach((n) =>
      n.addEventListener('click', () => this.cb.onJoinBeacon((n as HTMLElement).dataset.join!)));
  }

  // ---------- panels ----------
  panelOpen = false;
  showLoadout(profile: { devices: DeviceId[]; skills: SkillId[]; skillPoints: number; inventory: string[] }) {
    this.skills = profile.skills; this.skillPoints = profile.skillPoints; this.inventory = profile.inventory;
    const c = this.$('#lo-content');
    const skillCard = (id: SkillId) => {
      const s = SKILLS[id];
      const ownedS = this.skills.includes(id);
      const can = !ownedS && this.skillPoints >= s.cost && (!s.requires || this.skills.includes(s.requires));
      return `<div class="card ${ownedS ? 'active' : can ? '' : 'locked'}" data-skill="${id}">
        <b>${s.name} ${ownedS ? '✓' : `· ${s.cost}pt`}</b>${s.description}
        ${s.requires && !this.skills.includes(s.requires) ? `<div style="opacity:0.6;margin-top:4px">needs ${SKILLS[s.requires].name}</div>` : ''}
      </div>`;
    };
    const trav = Object.values(SKILLS).filter((s) => s.branch === 'traversal').map((s) => skillCard(s.id)).join('');
    const comb = Object.values(SKILLS).filter((s) => s.branch === 'combat').map((s) => skillCard(s.id)).join('');
    c.innerHTML = `
      <h3>DEVICES — click to equip</h3>
      <div class="grid">${this.owned.map((d) => `
        <div class="card ${d === this.equipped ? 'active' : ''}" data-dev="${d}">
          <b style="color:${DEVICES[d].color}">${DEVICE_ICONS[d]} ${DEVICES[d].name}</b>
          ${DEVICES[d].puzzleUse}<br/><span style="opacity:0.7">${DEVICES[d].combatUse}</span>
        </div>`).join('')}</div>
      <h3>SKILLS — ${this.skillPoints} point${this.skillPoints === 1 ? '' : 's'} <button id="lo-respec" style="margin-left:12px">respec (refund all)</button></h3>
      <div style="font-size:11px;opacity:0.6;margin-bottom:6px">TRAVERSAL</div><div class="grid">${trav}</div>
      <div style="font-size:11px;opacity:0.6;margin:8px 0 6px">COMBAT</div><div class="grid">${comb}</div>
      <h3>INVENTORY (${this.inventory.length}/6)</h3>
      <div class="grid">${this.inventory.length ? this.inventory.map((i) => `<div class="card"><b>◈ ${esc(i)}</b>carried item — find its socket</div>`).join('') : '<div style="opacity:0.5;font-size:12px">empty — explore for hidden items</div>'}</div>
    `;
    c.querySelectorAll('[data-dev]').forEach((n) => n.addEventListener('click', () => {
      this.cb.onEquip((n as HTMLElement).dataset.dev as DeviceId);
      this.hidePanel('loadout');
    }));
    c.querySelectorAll('[data-skill]').forEach((n) => n.addEventListener('click', () => {
      const id = (n as HTMLElement).dataset.skill as SkillId;
      if (!this.skills.includes(id)) this.cb.onUnlockSkill(id);
    }));
    c.querySelector('#lo-respec')?.addEventListener('click', () => this.cb.onRespec());
    this.$('#loadout').style.display = 'block';
    this.panelOpen = true;
  }
  showMenu(inLevel: boolean) {
    const c = this.$('#menu-content');
    const s = this.settings;
    c.innerHTML = `
      <label>Mouse sensitivity <input type="range" id="st-sens" min="0.3" max="2.5" step="0.1" value="${s.sensitivity}"/></label>
      <label>Master volume <input type="range" id="st-master" min="0" max="1" step="0.05" value="${s.master}"/></label>
      <label>Music volume <input type="range" id="st-music" min="0" max="1" step="0.05" value="${s.music}"/></label>
      <label>SFX volume <input type="range" id="st-sfx" min="0" max="1" step="0.05" value="${s.sfx}"/></label>
      <label>Combat difficulty
        <select id="st-diff" style="background:#221f38;color:#e8e4f0;border:1px solid #555;padding:4px 8px;border-radius:6px">
          <option value="normal" ${s.difficulty === 'normal' ? 'selected' : ''}>Normal</option>
          <option value="story" ${s.difficulty === 'story' ? 'selected' : ''}>Story (60% less damage)</option>
        </select></label>
      <label>Reduce motion <input type="checkbox" id="st-motion" ${s.reduceMotion ? 'checked' : ''}/></label>
      <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
        <button id="mn-resume">Resume</button>
        <button id="mn-invite">Copy invite link</button>
        ${inLevel ? '<button id="mn-beacon">Raise help beacon</button><button id="mn-reset">Reset level</button><button id="mn-leave">Return to Nexus</button>' : ''}
      </div>
      <p style="opacity:0.55;font-size:12px;margin-top:14px">Guest progress is saved in this browser. Every co-op level is beatable by two players with the starter Pulse — devices, items and skills open extra solo routes.</p>
    `;
    const upd = () => {
      s.sensitivity = Number((c.querySelector('#st-sens') as HTMLInputElement).value);
      s.master = Number((c.querySelector('#st-master') as HTMLInputElement).value);
      s.music = Number((c.querySelector('#st-music') as HTMLInputElement).value);
      s.sfx = Number((c.querySelector('#st-sfx') as HTMLInputElement).value);
      s.difficulty = (c.querySelector('#st-diff') as HTMLSelectElement).value as 'normal' | 'story';
      s.reduceMotion = (c.querySelector('#st-motion') as HTMLInputElement).checked;
      localStorage.setItem('t-sens', String(s.sensitivity));
      localStorage.setItem('t-master', String(s.master));
      localStorage.setItem('t-music', String(s.music));
      localStorage.setItem('t-sfx', String(s.sfx));
      localStorage.setItem('t-diff', s.difficulty);
      localStorage.setItem('t-motion', s.reduceMotion ? '1' : '0');
      this.cb.onSettings(s);
    };
    c.querySelectorAll('input,select').forEach((n) => n.addEventListener('change', upd));
    c.querySelector('#mn-resume')!.addEventListener('click', () => this.hidePanel('menu'));
    c.querySelector('#mn-invite')!.addEventListener('click', () => {
      navigator.clipboard.writeText(location.origin + location.pathname);
      this.toast('Invite link copied — anyone who opens it lands in the shared Nexus.', 'success');
    });
    c.querySelector('#mn-beacon')?.addEventListener('click', () => { this.cb.onBeacon(); this.hidePanel('menu'); });
    c.querySelector('#mn-reset')?.addEventListener('click', () => { this.cb.onReset(); this.hidePanel('menu'); });
    c.querySelector('#mn-leave')?.addEventListener('click', () => { this.cb.onLeaveLevel(); this.hidePanel('menu'); });
    this.$('#menu').style.display = 'block';
    this.panelOpen = true;
  }
  hidePanel(id: string) {
    this.$(`#${id}`).style.display = 'none';
    this.panelOpen = !!(this.root.querySelector('.bigpanel[style*="block"]'));
    if (!this.panelOpen) dispatchEvent(new CustomEvent('hud-closed'));
  }
  hideAllPanels() { this.hidePanel('loadout'); this.hidePanel('menu'); }
}

function esc(s: string) { return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!)); }
