// DOM HUD: minimal chrome (spec §10) — roster, level name, shard pips, health,
// device bar, crosshair, prompts, toasts, loadout/skill panels, settings, beacons,
// screen-space feedback (damage direction, downed, level cards, solve banner).
// Styling lives in ui/hud-css.ts; the title backdrop in ui/backdrop.ts.
// Safety: every user-/server-provided string goes through esc() or textContent.
import { DEVICES, type DeviceId } from '../shared/devices';
import { SKILLS, type SkillId } from '../shared/skills';
import { PLAYER_ACCENTS } from '../shared/palette';
import type { InstanceSnapshot } from '../shared/messages';
import { icon, DEVICE_ICON, SKILL_ICON } from './icons';
import { HUD_CSS } from './ui/hud-css';
import { startBackdrop, type Backdrop } from './ui/backdrop';

export interface HudCallbacks {
  onStart(name: string, accent: string): void;
  onEquip(d: DeviceId): void;
  onUnlockSkill(s: SkillId): void;
  onRespec(): void;
  onJoinBeacon(instanceId: string): void;
  onReset(): void;
  onLeaveLevel(): void;
  onBeacon(): void;
  onSettings(s: HudSettings): void;
}

export interface HudSettings {
  sensitivity: number; master: number; music: number; sfx: number;
  difficulty: 'normal' | 'story'; reduceMotion: boolean;
  quality: 'low' | 'medium' | 'high';
}

/** accent choices = the server's player palette: the pick is your in-world colour AND the HUD theme */
const ACCENT_NAMES = ['Cyan', 'Rose', 'Mint', 'Gold', 'Violet', 'Teal'];
const ACCENTS: [string, string][] = PLAYER_ACCENTS.map((c, i) => [c, ACCENT_NAMES[i] ?? c]);
const REVIVE_C = 2 * Math.PI * 27;
const LEVELINFO_HOLD_MS = 8000;

function lsGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } }

export class Hud {
  private root: HTMLElement;
  private cb: HudCallbacks;
  private owned: DeviceId[] = ['pulse'];
  private equipped: DeviceId = 'pulse';
  private skills: SkillId[] = [];
  private skillPoints = 0;
  private inventory: string[] = [];
  private shardCount = -1;
  private accent = '#6ec6ff';
  private backdrop?: Backdrop;
  settings: HudSettings = {
    sensitivity: Number(lsGet('t-sens') ?? 1),
    master: Number(lsGet('t-master') ?? 0.8),
    music: Number(lsGet('t-music') ?? 0.7),
    sfx: Number(lsGet('t-sfx') ?? 0.9),
    difficulty: (lsGet('t-diff') ?? 'normal') as 'normal' | 'story',
    reduceMotion: lsGet('t-motion') === '1',
    quality: (lsGet('t-quality') ?? 'medium') as 'low' | 'medium' | 'high',
  };

  constructor(cb: HudCallbacks) {
    this.cb = cb;
    const style = document.createElement('style');
    style.textContent = HUD_CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div id="vignette"></div>
      <div id="dmgdir"><i class="arc"></i><i class="arc"></i><i class="arc"></i></div>
      <div id="letterbox"><i></i><i></i></div>
      <div id="crosshair"><i class="t t-u"></i><i class="t t-d"></i><i class="t t-l"></i><i class="t t-r"></i><i class="c-dot"></i><div class="hm"><i></i><i></i><i></i><i></i></div></div>
      <div id="levelinfo"><div class="tier" id="li-tier"></div><b id="li-name">…</b><div class="obj" id="li-obj"></div></div>
      <div id="objectives"></div>
      <div id="conn"><div class="cn-chip panel"><i class="cn-dot"></i><span class="cn-t"></span></div>
        <div class="cn-panel panel"><h3>PLAYING IN ANOTHER TAB</h3><p>This profile connected from another tab or device, so this one was paused.</p><button id="cn-take">PLAY HERE INSTEAD</button></div></div>
      <div id="shards"></div>
      <div id="shardcall"></div>
      <div id="roster"></div>
      <div id="health"><div class="hp-head"><span class="lbl">${icon('heart', 13)}VITALS</span><span class="num"><span id="hp-num">100</span><small>HP</small></span></div>
        <div class="bar"><b></b><i></i><span class="seg"></span></div></div>
      <div id="devices"></div>
      <div id="prompt"></div>
      <div id="hint" class="panel"></div>
      <div id="gate" class="panel"></div>
      <div id="vote" class="panel"></div>
      <div id="chatlog" class="dim"></div>
      <div id="chatinput"><input maxlength="200" placeholder="say something… (Enter to send, Esc to cancel)"/></div>
      <div id="toasts"></div>
      <div id="beacons"></div>
      <div id="downed"><div class="dn-t">${icon('downed', 30)}DOWNED</div><div class="sub" id="downed-sub"></div></div>
      <div id="reviveBar"><svg viewBox="0 0 64 64"><circle class="bg" cx="32" cy="32" r="27" fill="none" stroke-width="3"/>
        <circle class="fg" cx="32" cy="32" r="27" fill="none" stroke-width="3" stroke-linecap="round" stroke-dasharray="${REVIVE_C.toFixed(2)}" stroke-dashoffset="${REVIVE_C.toFixed(2)}"/></svg>
        <span class="rv-lbl">REVIVING</span></div>
      <div id="levelcard"><div class="lc-world" id="lc-world"></div><div class="lc-line"></div><div class="lc-name" id="lc-name"></div><div class="lc-line"></div><div class="lc-sub" id="lc-sub"></div></div>
      <div id="banner"><div class="bn-mark">${icon('threshold', 38)}</div><h2 id="banner-h"></h2><div class="lc-line"></div><p id="banner-p"></p></div>
      <div id="scrim"></div>
      <div id="loadout" class="bigpanel panel"><span class="close" data-close="loadout" title="Close (Esc)">✕</span><div class="ph"><h2>LOADOUT</h2><span class="sub">DEVICES · SKILLS · INVENTORY</span></div><div id="lo-content"></div></div>
      <div id="menu" class="bigpanel panel"><span class="close" data-close="menu" title="Close (Esc)">✕</span><div class="ph"><h2>THRESHOLD</h2><span class="sub">PAUSED</span></div><div id="menu-content"></div></div>
      <div id="tip"></div>
    `;
    document.body.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.dataset.close) this.hidePanel(t.dataset.close);
    });
    const savedAcc = lsGet('t-accent');
    this.setAccent(savedAcc && ACCENTS.some(([c]) => c === savedAcc) ? savedAcc : ACCENTS[0][0]);
    this.applyMotion();
    this.buildIntro();
  }

  // ---------- theming ----------
  private setAccent(hex: string) {
    if (!ACCENTS.some(([c]) => c === hex)) return;
    this.accent = hex;
    const n = parseInt(hex.slice(1), 16);
    const s = document.documentElement.style;
    s.setProperty('--acc', hex);
    s.setProperty('--acc-rgb', `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`);
    lsSet('t-accent', hex);
    document.querySelectorAll<HTMLElement>('.sw').forEach((el) => el.classList.toggle('on', el.dataset.accent === hex));
    this.backdrop?.setAccent(hex);
  }
  private swatches() {
    return `<div class="swatches" role="radiogroup" aria-label="Accent colour">${ACCENTS.map(([c, n]) =>
      `<button type="button" class="sw ${c === this.accent ? 'on' : ''}" data-accent="${c}" style="--c:${c}" title="${n}" aria-label="${n}"></button>`).join('')}</div>`;
  }
  private bindSwatches(scope: HTMLElement) {
    scope.querySelectorAll<HTMLElement>('.sw').forEach((el) => el.addEventListener('click', () => this.setAccent(el.dataset.accent!)));
  }
  private applyMotion() {
    const rm = this.settings.reduceMotion;
    this.root.classList.toggle('rm', rm);
    document.getElementById('intro')?.classList.toggle('rm', rm);
  }

  // ---------- title screen ----------
  private buildIntro() {
    const intro = document.createElement('div');
    intro.id = 'intro';
    intro.classList.toggle('rm', this.settings.reduceMotion);
    const saved = lsGet('threshold-name') ?? '';
    const keys: [string, string][] = [['WASD', 'move'], ['MOUSE', 'look'], ['SPACE', 'jump'], ['E', 'interact'], ['F', 'carry'],
      ['LMB', 'device'], ['1-4', 'equip'], ['ENTER', 'chat'], ['MMB', 'ping'], ['Q', 'beacon'], ['L', 'loadout'], ['T', 'echo'], ['ESC', 'menu']];
    intro.innerHTML = `
      <canvas id="intro-bg"></canvas>
      <div class="in-wrap">
        <div class="mark">${icon('threshold', 54)}</div>
        <h1 aria-label="THRESHOLD">${[...'THRESHOLD'].map((ch, i) => `<span style="animation-delay:${(0.15 + i * 0.06).toFixed(2)}s">${ch}</span>`).join('')}</h1>
        <div class="rule">A COOPERATIVE PUZZLE-ADVENTURE</div>
        <p class="tag">Walk through a portal and think your way out — alone, or with whoever else steps through.
        Share this page's URL to bring a friend into your world.</p>
        <div class="in-card">
          ${saved ? `<div class="wb">WELCOME BACK, <b>${esc(saved.slice(0, 24))}</b></div>` : ''}
          <label class="fld"><span>CALLSIGN</span><input id="intro-name" maxlength="24" placeholder="your name" autocomplete="off" spellcheck="false" /></label>
          <div class="fld"><span>ACCENT — YOUR COLOUR IN THE WORLD</span>${this.swatches()}</div>
          <button id="intro-go">STEP THROUGH <span class="kc">↵</span></button>
        </div>
        <div class="keys">${keys.map(([k, v]) => `<span><span class="kc ghost">${k}</span>${v}</span>`).join('')}</div>
      </div>
      <div class="foot">13 LEVELS · 12 SHARDS · 1–4 PLAYERS · DROP-IN CO-OP</div>
    `;
    document.body.appendChild(intro);
    const nameInput = intro.querySelector('#intro-name') as HTMLInputElement;
    nameInput.value = saved.slice(0, 24);      // value set as a property — never parsed as HTML
    this.bindSwatches(intro);
    this.backdrop = startBackdrop(intro.querySelector('#intro-bg') as HTMLCanvasElement, this.accent, this.settings.reduceMotion);
    let gone = false;
    const go = () => {
      if (gone) return;
      gone = true;
      const name = nameInput.value.trim() || 'Wanderer';
      lsSet('threshold-name', name);
      this.cb.onStart(name, this.accent);        // boot the game behind the fade
      intro.classList.add('out');
      setTimeout(() => { this.backdrop?.stop(); this.backdrop = undefined; intro.remove(); }, this.settings.reduceMotion ? 0 : 720);
    };
    intro.querySelector('#intro-go')!.addEventListener('click', go);
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    setTimeout(() => nameInput.focus(), 50);
  }

  private $(sel: string) { return this.root.querySelector(sel) as HTMLElement; }
  /** restart a CSS animation by toggling a class */
  private replay(el: Element, cls = 'on') { el.classList.remove(cls); void (el as HTMLElement).offsetWidth; el.classList.add(cls); }

  // ---------- live HUD ----------
  private levelKey = '';
  private liTimer?: ReturnType<typeof setTimeout>;
  setLevelInfo(name: string, world: string, tier: string, best?: number) {
    this.$('#li-name').textContent = name;
    this.$('#li-tier').textContent = `${world}${tier ? ' · ' + tier : ''}`;
    this.$('#li-obj').textContent = best ? `Best ${(best / 1000).toFixed(1)}s` : '';
    const li = this.$('#levelinfo');
    li.classList.remove('faded');
    clearTimeout(this.liTimer);
    this.liTimer = setTimeout(() => li.classList.add('faded'), LEVELINFO_HOLD_MS);
    const key = `${world}|${name}`;
    if (key !== this.levelKey) {
      this.levelKey = key;
      this.$('#lc-world').textContent = world;
      this.$('#lc-name').textContent = name;
      this.$('#lc-sub').textContent = tier;
      this.replay(this.$('#levelcard'));
    }
  }
  setShards(count: number, total: number) {
    const el = this.$('#shards');
    if (el.querySelectorAll('.pip').length !== total) {
      el.innerHTML = `${'<div class="pip"></div>'.repeat(total)}<span class="lbl"></span>`;
    }
    const pips = el.querySelectorAll('.pip');
    pips.forEach((p, i) => p.classList.toggle('on', i < count));
    (el.querySelector('.lbl') as HTMLElement).innerHTML = `<b>${count}</b> / ${total}`;
    if (this.shardCount >= 0 && count > this.shardCount) {
      for (let i = this.shardCount; i < count && i < pips.length; i++) this.replay(pips[i], 'gain');
      const call = this.$('#shardcall');
      call.textContent = `SHARD RECOVERED · ${count}/${total}`;
      this.replay(call);
    }
    this.shardCount = count;
  }
  setHealth(hp: number, downed: boolean) {
    const el = this.$('#health');
    const v = Math.max(0, Math.min(100, hp));
    const low = v < 35 && !downed;
    el.classList.toggle('low', v < 35);
    (el.querySelector('.bar i') as HTMLElement).style.width = `${v}%`;
    (el.querySelector('.bar b') as HTMLElement).style.width = `${v}%`;
    this.$('#hp-num').textContent = String(Math.round(v));
    this.$('#downed').style.display = downed ? 'flex' : 'none';
    this.$('#vignette').classList.toggle('low', low);
  }
  setDownedSub(text: string) { this.$('#downed-sub').textContent = text; }
  /** red edge flash; `angle` (radians, 0 = ahead, +right) adds a direction arc toward the source */
  private arcIdx = 0;
  damageFlash(angle?: number) {
    const v = this.$('#vignette');
    v.classList.add('hit');
    setTimeout(() => v.classList.remove('hit'), 180);
    if (angle === undefined || !Number.isFinite(angle)) return;
    const arcs = this.root.querySelectorAll<HTMLElement>('#dmgdir .arc');
    const a = arcs[this.arcIdx++ % arcs.length];
    a.style.transform = `rotate(${angle.toFixed(3)}rad)`;
    this.replay(a);
  }
  /** crosshair bloom on fire */
  private fireTimer?: ReturnType<typeof setTimeout>;
  fired() {
    const c = this.$('#crosshair');
    c.classList.add('fire');
    clearTimeout(this.fireTimer);
    this.fireTimer = setTimeout(() => c.classList.remove('fire'), 70);
  }
  /** confirmed hit on an enemy by our own shot; kill = it went down / shattered */
  hitMarker(kill = false) {
    const hm = this.$('#crosshair .hm');
    hm.classList.toggle('kill', kill);
    this.replay(hm);
  }
  private rosterKey = '';
  setRoster(players: { name: string; accent: string; hp: number; downed: boolean; self: boolean }[]) {
    const el = this.$('#roster');
    const key = players.map((p) => `${p.name}\u0000${p.accent}\u0000${p.self}`).join('\u0001');
    if (key !== this.rosterKey) {
      this.rosterKey = key;
      el.innerHTML = players.map((p) =>
        `<div class="row${p.self ? ' self' : ''}"><span class="dot" style="background:${safeColor(p.accent)};color:${safeColor(p.accent)}"></span>
         <span class="nm">${esc(p.name)}</span><span class="hp"><i></i></span></div>`).join('');
    }
    const rows = el.querySelectorAll<HTMLElement>('.row');
    players.forEach((p, i) => {
      const r = rows[i];
      if (!r) return;
      r.classList.toggle('down', p.downed);
      (r.querySelector('.hp i') as HTMLElement).style.width = `${Math.max(0, Math.min(100, p.hp))}%`;
    });
  }
  private devKey = '';
  setDevices(owned: DeviceId[], equipped: DeviceId, chargeOf: (d: DeviceId) => string, cooldownPct: (d: DeviceId) => number) {
    this.owned = owned; this.equipped = equipped;
    const el = this.$('#devices');
    const key = owned.join(',');
    if (key !== this.devKey) {
      this.devKey = key;
      el.innerHTML = `<div class="dv-sel"></div>` + owned.map((d, i) => {
        const words = DEVICES[d].name.split(' ');
        return `<div class="slot" data-slot="${d}" style="--dc:${DEVICES[d].color}">
          <span class="k">${i + 1}</span>
          ${icon(DEVICE_ICON[d], 22, DEVICES[d].color)}
          <div class="nm">${words[words.length - 1]}</div>
          <div class="pips"></div>
          <div class="cd"></div>
        </div>`;
      }).join('');
    }
    const idx = Math.max(0, owned.indexOf(equipped));
    (el.querySelector('.dv-sel') as HTMLElement).style.transform = `translate(${idx * 5.3}em, -3px)`;
    el.querySelectorAll<HTMLElement>('.slot').forEach((s) => {
      const d = s.dataset.slot as DeviceId;
      s.classList.toggle('eq', d === equipped);
      const cd = cooldownPct(d);
      (s.querySelector('.cd') as HTMLElement).style.width = `${(cd * 100).toFixed(1)}%`;
      s.classList.toggle('cool', cd > 0.02);
      const ch = chargeOf(d);
      const pips = s.querySelector('.pips') as HTMLElement;
      if (pips.dataset.ch !== ch) {
        pips.dataset.ch = ch;
        const m = /^(\d+)\/(\d+)$/.exec(ch);
        pips.innerHTML = m
          ? Array.from({ length: Number(m[2]) }, (_, i) => `<i class="${i < Number(m[1]) ? 'on' : ''}"></i>`).join('')
          : '∞';
      }
    });
  }

  // ---------- chat ----------
  private chatDimTimer?: ReturnType<typeof setTimeout>;
  chatOpen = false;
  private onChatSubmit?: (text: string) => void;

  addChat(name: string, accent: string, text: string, system = false) {
    const log = this.$('#chatlog');
    const line = document.createElement('div');
    line.className = `line${system ? ' sys' : ''}`;
    line.innerHTML = system
      ? esc(text)
      : `<span class="who" style="color:${safeColor(accent)}">${esc(name)}</span>${esc(text)}`;
    log.appendChild(line);
    while (log.children.length > 9) log.removeChild(log.firstChild!);
    log.classList.remove('dim');
    clearTimeout(this.chatDimTimer);
    this.chatDimTimer = setTimeout(() => log.classList.add('dim'), 7000);
  }
  bindChat(onSubmit: (text: string) => void) { this.onChatSubmit = onSubmit; }
  openChat() {
    if (this.chatOpen) return;
    this.chatOpen = true;
    const box = this.$('#chatinput');
    const input = box.querySelector('input')!;
    box.style.display = 'block';
    this.$('#chatlog').classList.remove('dim');
    input.value = '';
    setTimeout(() => input.focus(), 0);
    const close = () => {
      this.chatOpen = false;
      input.blur();
      box.style.display = 'none';
      input.onkeydown = null;
      dispatchEvent(new CustomEvent('hud-closed'));
    };
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = input.value.trim();
        if (text) this.onChatSubmit?.(text);
        close();
      } else if (e.key === 'Escape') close();
    };
  }

  gateBanner(text: string | null) {
    const el = this.$('#gate');
    el.style.display = text ? 'block' : 'none';
    if (text) el.innerHTML = `${icon('players', 16)}${esc(text)} <span class="gk"><span class="kc">X</span> stop waiting</span>`;
  }
  /** open reset vote: who asked, tally, and how to answer (null hides) */
  voteBanner(v: { by: string; yes: number; needed: number; mine: boolean } | null) {
    const el = this.$('#vote');
    el.style.display = v ? 'block' : 'none';
    if (!v) return;
    el.innerHTML = `${icon('reset', 16)}<b>${esc(v.by)}</b> wants to reset the level · ${v.yes}/${v.needed}` +
      (v.mine ? ' <span class="gk">waiting for your partner…</span>'
        : ' <span class="gk"><span class="kc">Y</span> agree <span class="kc">N</span> decline</span>');
  }
  /** player id used for invite links (?join=@id) */
  inviteId = '';
  /** `text` is trusted markup from main.ts ("<b>E</b> — label", label already escaped) */
  private lastPrompt: string | null = null;
  private objKey = '';
  /** ordered checklist: done steps are ticked, the first open step is highlighted */
  setObjectives(list: { text: string; done: boolean }[]) {
    const key = list.map((o) => `${o.done ? 1 : 0}${o.text}`).join('|');
    if (key === this.objKey) return;
    const prev = this.objKey.split('|');
    this.objKey = key;
    const el = this.$('#objectives');
    const firstOpen = list.findIndex((o) => !o.done);
    el.innerHTML = list.map((o, i) =>
      `<div class="ob${o.done ? ' done' : ''}${i === firstOpen ? ' cur' : ''}${o.done && prev[i]?.[0] === '0' ? ' just' : ''}"><i></i><span>${esc(o.text)}</span></div>`).join('');
    el.style.display = list.length ? 'block' : 'none';
  }

  private connTake?: () => void;
  /** connection chip (connecting / reconnecting) and the "another tab took over" panel */
  setConnection(status: 'connecting' | 'online' | 'reconnecting' | 'replaced', onTakeOver: () => void) {
    this.connTake = onTakeOver;
    const el = this.$('#conn');
    el.dataset.st = status;
    this.$('#conn .cn-t').textContent = status === 'reconnecting' ? 'Connection lost — reconnecting…' : 'Connecting…';
    const btn = this.$('#cn-take') as HTMLButtonElement;
    btn.onclick = () => this.connTake?.();
    if (status === 'replaced') {
      for (const id of ['menu', 'loadout']) if (this.$(`#${id}`).style.display === 'block') this.hidePanel(id);
      document.exitPointerLock?.();
    }
  }

  prompt(text: string | null) {
    if (text === this.lastPrompt) return;
    this.lastPrompt = text;
    const el = this.$('#prompt');
    this.root.classList.toggle('focus', !!text);
    if (!text) { el.style.display = 'none'; return; }
    const m = /^<b>(.*?)<\/b>\s*[—–-]\s*(.*)$/.exec(text);
    if (m) {
      const words = m[1].trim().split(/\s+/);
      const key = words.pop()!;
      const pre = words.join(' ');
      el.innerHTML = `<span class="kc">${key}</span><span class="pl">${pre ? `<em>${pre.toUpperCase()}</em>` : ''}${m[2]}</span>`;
    } else el.innerHTML = `<span class="pl">${text}</span>`;
    el.style.display = 'flex';
  }
  hint(text: string | null) {
    const el = this.$('#hint');
    el.style.display = text ? 'block' : 'none';
    if (text) el.textContent = text;
  }
  toast(text: string, kind = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind === 'success' || kind === 'warn' ? kind : 'info'}`;
    el.textContent = text;
    this.$('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }
  private bannerTimers: ReturnType<typeof setTimeout>[] = [];
  banner(title: string, sub: string) {
    this.$('#banner-h').textContent = title;
    this.$('#banner-p').textContent = sub;
    const b = this.$('#banner'), lb = this.$('#letterbox');
    this.bannerTimers.forEach(clearTimeout);
    this.replay(b);
    lb.classList.add('on');
    this.bannerTimers = [
      setTimeout(() => lb.classList.remove('on'), 3900),
      setTimeout(() => b.classList.remove('on'), 4500),
    ];
  }
  reviveProgress(pct: number | null) {
    const el = this.$('#reviveBar');
    el.style.display = pct === null ? 'none' : 'block';
    if (pct !== null) {
      const p = Math.max(0, Math.min(1, pct));
      (el.querySelector('.fg') as SVGCircleElement).setAttribute('stroke-dashoffset', (REVIVE_C * (1 - p)).toFixed(2));
    }
  }
  setBeacons(beacons: NonNullable<InstanceSnapshot['beacons']>, inLobby: boolean) {
    const el = this.$('#beacons');
    if (!inLobby || !beacons?.length) { el.innerHTML = ''; return; }
    el.innerHTML = beacons.map((b) => `
      <div class="b panel" data-join="${esc(b.instanceId)}">
        <span class="lvl">${icon('beacon', 13)} ${esc(b.levelName)}</span> needs a hand —
        ${Number(b.present)} inside${b.needed ? `, wants ${Number(b.needed)} more` : ''}. <u>Click to jump in.</u>
      </div>`).join('');
    el.querySelectorAll('[data-join]').forEach((n) =>
      n.addEventListener('click', () => this.cb.onJoinBeacon((n as HTMLElement).dataset.join!)));
  }

  // ---------- panels ----------
  panelOpen = false;
  private openPanel(id: string) {
    this.$(`#${id}`).style.display = 'block';
    this.panelOpen = true;
    this.root.classList.add('panel-open');
  }
  showLoadout(profile: { devices: DeviceId[]; skills: SkillId[]; skillPoints: number; inventory: string[] }) {
    this.skills = profile.skills; this.skillPoints = profile.skillPoints; this.inventory = profile.inventory;
    const c = this.$('#lo-content');
    const state = (id: SkillId) => {
      const s = SKILLS[id];
      if (this.skills.includes(id)) return 'owned';
      return this.skillPoints >= s.cost && (!s.requires || this.skills.includes(s.requires)) ? 'can' : 'locked';
    };
    const node = (id: SkillId) => {
      const s = SKILLS[id];
      const st = state(id);
      const col = st === 'owned' ? '#a8f0c6' : st === 'can' ? '#ffd98a' : '#8f89a8';
      return `<div class="sk-node ${st}" data-skill="${id}" tabindex="0" aria-label="${esc(s.name)}: ${esc(s.description)}">
        <span class="hx">${icon(SKILL_ICON[id], 18, col)}</span>
        <span style="min-width:0"><b>${esc(s.name)}</b><span class="cost">${st === 'owned' ? 'ACQUIRED' : `${s.cost} PT${s.cost > 1 ? 'S' : ''}`}</span></span>
      </div>`;
    };
    const chain = (ids: SkillId[]) => `<div class="sk-row">${ids.map((id, i) =>
      `${i > 0 ? `<div class="sk-link ${this.skills.includes(ids[i - 1]) ? 'owned' : ''}"></div>` : ''}${node(id)}`).join('')}</div>`;
    const branch = (label: string, chains: SkillId[][]) =>
      `<div class="sk-branch"><div class="bl">${label}</div>${chains.map(chain).join('')}</div>`;
    const inv = this.inventory.map((i) => `<div class="card item"><div class="ct"><span class="ib" style="color:var(--gold)">${icon('gem', 14, '#ffd98a')}</span>${esc(i)}</div>carried item — find its socket</div>`);
    for (let k = inv.length; k < 6; k++) inv.push(`<div class="card empty">${k === this.inventory.length && !this.inventory.length ? 'empty — explore for hidden secrets' : '—'}</div>`);
    c.innerHTML = `
      <h3>DEVICES</h3>
      <div class="lo-grid dev">${this.owned.map((d, i) => `
        <div class="card ${d === this.equipped ? 'active' : ''}" data-dev="${d}" style="--dc:${DEVICES[d].color}" tabindex="0">
          ${d === this.equipped ? '<span class="tag">EQUIPPED</span>' : `<span class="tag" style="color:var(--ink-3)">[${i + 1}]</span>`}
          <div class="ct"><span class="ib" style="color:${DEVICES[d].color}">${icon(DEVICE_ICON[d], 16, DEVICES[d].color)}</span>${DEVICES[d].name}</div>
          ${DEVICES[d].puzzleUse}<span class="cu">${DEVICES[d].combatUse}</span>
        </div>`).join('')}</div>
      <h3>SKILL MATRIX <span class="lo-pts"><i></i>${this.skillPoints} POINT${this.skillPoints === 1 ? '' : 'S'}</span>
        <button id="lo-respec" class="sm">${icon('respec', 12)} Respec</button></h3>
      <div class="sk-wrap">
        ${branch('TRAVERSAL', [['double-jump', 'phase-sight'], ['quick-carry', 'echo-core']])}
        ${branch('COMBAT', [['charged-pulse', 'overcharge'], ['dash', 'field-medic']])}
      </div>
      <h3>INVENTORY · ${this.inventory.length}/6</h3>
      <div class="lo-grid">${inv.join('')}</div>
    `;
    c.querySelectorAll('[data-dev]').forEach((n) => n.addEventListener('click', () => {
      this.cb.onEquip((n as HTMLElement).dataset.dev as DeviceId);
      this.hidePanel('loadout');
    }));
    const tip = this.$('#tip');
    c.querySelectorAll<HTMLElement>('[data-skill]').forEach((n) => {
      const id = n.dataset.skill as SkillId;
      n.addEventListener('click', () => { if (!this.skills.includes(id)) this.cb.onUnlockSkill(id); });
      const show = () => {
        const s = SKILLS[id], st = state(id);
        const status = st === 'owned' ? '<span class="ts" style="color:var(--mint)">ACQUIRED</span>'
          : st === 'can' ? `<span class="ts" style="color:var(--gold)">CLICK TO UNLOCK · ${s.cost} PT</span>`
          : `<span class="ts" style="color:var(--ink-3)">${s.requires && !this.skills.includes(s.requires) ? `REQUIRES ${esc(SKILLS[s.requires].name.toUpperCase())}` : `NEEDS ${s.cost} PT`}</span>`;
        tip.innerHTML = `<b>${esc(s.name)}</b>${esc(s.description)}${status}`;
        const r = n.getBoundingClientRect();
        const tw = tip.offsetWidth, th = tip.offsetHeight;
        const x = Math.min(innerWidth - tw - 8, Math.max(8, r.left + r.width / 2 - tw / 2));
        const y = r.top - th - 8 > 8 ? r.top - th - 8 : r.bottom + 8;
        tip.style.left = `${x}px`; tip.style.top = `${y}px`;
        tip.classList.add('on');
      };
      n.addEventListener('mouseenter', show); n.addEventListener('focus', show);
      n.addEventListener('mouseleave', () => tip.classList.remove('on'));
      n.addEventListener('blur', () => tip.classList.remove('on'));
    });
    c.querySelector('#lo-respec')?.addEventListener('click', () => this.cb.onRespec());
    this.openPanel('loadout');
  }
  showMenu(inLevel: boolean) {
    const c = this.$('#menu-content');
    const s = this.settings;
    const range = (id: string, label: string, min: number, max: number, step: number, v: number) =>
      `<div class="st-row"><span>${label}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}"/><output for="${id}"></output></div>`;
    const seg = (id: string, v: string, opts: [string, string][]) =>
      `<input type="hidden" id="${id}" value="${v}"/><div class="segc" data-seg="${id}">${opts.map(([o, l]) =>
        `<button type="button" data-v="${o}" class="${o === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const QNOTE: Record<string, string> = { low: 'Fastest — for integrated GPUs.', medium: 'Reflections and dynamic lights.', high: 'Full effects.' };
    const DNOTE: Record<string, string> = { normal: 'Enemies hit as designed.', story: '60% less damage taken.' };
    c.innerHTML = `
      <div class="mn-grid">
        <div>
          <h3>CONTROLS</h3>
          ${range('st-sens', 'Mouse sensitivity', 0.3, 2.5, 0.1, s.sensitivity)}
          <h3>AUDIO</h3>
          ${range('st-master', 'Master volume', 0, 1, 0.05, s.master)}
          ${range('st-music', 'Music', 0, 1, 0.05, s.music)}
          ${range('st-sfx', 'Effects', 0, 1, 0.05, s.sfx)}
          <h3>GAMEPLAY &amp; DISPLAY</h3>
          <div class="st-row wide"><span>Combat difficulty</span><div>${seg('st-diff', s.difficulty, [['normal', 'Normal'], ['story', 'Story']])}</div><div class="st-note" id="st-diff-note">${DNOTE[s.difficulty]}</div></div>
          <div class="st-row wide"><span>Graphics quality</span><div>${seg('st-quality', s.quality, [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])}</div><div class="st-note" id="st-quality-note">${QNOTE[s.quality]}</div></div>
          <div class="st-row wide"><span>Reduce motion</span><label class="tgl"><input type="checkbox" id="st-motion" ${s.reduceMotion ? 'checked' : ''} aria-label="Reduce motion"/><span></span></label></div>
        </div>
        <div class="mn-actions">
          <h3>SESSION</h3>
          <button id="mn-resume" class="primary">${icon('resume', 14)} Resume</button>
          <button id="mn-invite">${icon('link', 14)} Copy invite link</button>
          ${inLevel ? `<div class="sep"></div>
            <button id="mn-beacon">${icon('beacon', 14)} Raise help beacon</button>
            <button id="mn-reset" class="danger">${icon('reset', 14)} Reset level</button>
            <button id="mn-leave" class="danger">${icon('leave', 14)} Return to Nexus</button>` : ''}
          <p class="mn-foot">Guest progress is saved in this browser. Every co-op level is beatable by two players with the starter Pulse — devices, items and skills open extra solo routes.</p>
        </div>
      </div>
    `;
    const val = (id: string) => (c.querySelector(`#${id}`) as HTMLInputElement).value;
    const paintRange = (r: HTMLInputElement) => {
      const min = Number(r.min), max = Number(r.max), v = Number(r.value);
      r.style.setProperty('--v', `${((v - min) / (max - min)) * 100}%`);
      const out = r.parentElement!.querySelector('output');
      if (out) out.textContent = r.id === 'st-sens' ? v.toFixed(1) : `${Math.round(v * 100)}`;
    };
    const upd = () => {
      s.sensitivity = Number(val('st-sens'));
      s.master = Number(val('st-master'));
      s.music = Number(val('st-music'));
      s.sfx = Number(val('st-sfx'));
      s.difficulty = val('st-diff') as 'normal' | 'story';
      s.quality = val('st-quality') as 'low' | 'medium' | 'high';
      s.reduceMotion = (c.querySelector('#st-motion') as HTMLInputElement).checked;
      lsSet('t-sens', String(s.sensitivity));
      lsSet('t-master', String(s.master));
      lsSet('t-music', String(s.music));
      lsSet('t-sfx', String(s.sfx));
      lsSet('t-diff', s.difficulty);
      lsSet('t-motion', s.reduceMotion ? '1' : '0');
      this.applyMotion();
      this.cb.onSettings(s);
    };
    c.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((r) => {
      paintRange(r);
      r.addEventListener('input', () => paintRange(r));
    });
    c.querySelectorAll<HTMLElement>('[data-seg]').forEach((g) => g.querySelectorAll<HTMLElement>('button').forEach((b) =>
      b.addEventListener('click', () => {
        const id = g.dataset.seg!;
        (c.querySelector(`#${id}`) as HTMLInputElement).value = b.dataset.v!;
        g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        const note = c.querySelector(`#${id}-note`);
        if (note) note.textContent = (id === 'st-quality' ? QNOTE : DNOTE)[b.dataset.v!] ?? '';
        upd();
      })));
    c.querySelectorAll('input').forEach((n) => n.addEventListener('change', upd));
    c.querySelector('#mn-resume')!.addEventListener('click', () => this.hidePanel('menu'));
    c.querySelector('#mn-invite')!.addEventListener('click', () => {
      const url = location.origin + location.pathname + (this.inviteId ? `?join=@${encodeURIComponent(this.inviteId)}` : '');
      navigator.clipboard?.writeText(url);
      this.toast('Invite link copied — whoever opens it joins your party, right where you are.', 'success');
    });
    c.querySelector('#mn-beacon')?.addEventListener('click', () => { this.cb.onBeacon(); this.hidePanel('menu'); });
    c.querySelector('#mn-reset')?.addEventListener('click', () => { this.cb.onReset(); this.hidePanel('menu'); });
    c.querySelector('#mn-leave')?.addEventListener('click', () => { this.cb.onLeaveLevel(); this.hidePanel('menu'); });
    this.openPanel('menu');
  }
  hidePanel(id: string) {
    this.$(`#${id}`).style.display = 'none';
    this.$('#tip').classList.remove('on');
    this.panelOpen = !!(this.root.querySelector('.bigpanel[style*="block"]'));
    this.root.classList.toggle('panel-open', this.panelOpen);
    if (!this.panelOpen) dispatchEvent(new CustomEvent('hud-closed'));
  }
  hideAllPanels() { this.hidePanel('loadout'); this.hidePanel('menu'); }
}

function esc(s: string) { return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!)); }
/** colours arrive from the server; only let plain hex through into style attributes */
function safeColor(c: string) { return /^#[0-9a-f]{3,8}$/i.test(c) ? c : '#6ec6ff'; }
