// THRESHOLD client entry: wires renderer, world, controller, net, HUD, audio.
import * as THREE from 'three';
import { disposeObject } from './render/dispose';
import { Renderer } from './render/renderer';
import { World } from './world';
import { PlayerController } from './player';
import { Peers, Enemies, Echoes, Pings, setModelQuality } from './entities';
import { Viewmodel } from './viewmodel';
import { Particles } from './particles';
import { Projectiles } from './projectiles';
import { DeviceRig } from './devices';
import { Hud } from './hud';
import { Net } from './net';
import { GameAudio } from './audio';
import { DEVICES, type DeviceId } from '../shared/devices';
import type { InteractableDef, LevelDef, Vec3 } from '../shared/level';
import type { ServerMsg } from '../shared/messages';
import { PALETTE } from '../shared/palette';

const TOTAL_SHARDS = 12;

let renderer: Renderer;
let world: World | null = null;
let controller: PlayerController;
let peers: Peers;
let enemies: Enemies;
let echoes: Echoes;
let pings: Pings;
let viewmodel: Viewmodel;
let particles: Particles;
let projectiles: Projectiles;
let rig: DeviceRig;
let net: Net;
const audio = new GameAudio();

let playerId = '';
let profile = {
  name: '', accent: PALETTE.portalA as string, shards: [] as string[], skillPoints: 0,
  skills: [] as string[], devices: ['pulse'] as DeviceId[], inventory: [] as string[],
  bestTimes: {} as Record<string, number>,
};
let levelDef: LevelDef | null = null;
let inLevel = false;
let selfHp = 100;
let selfDowned = false;
let echoPlaced = false;
let lastMoveSent = 0;
let lastTractorSent = 0;
let revivingId: string | null = null;
let blockedHintAt = 0;
let lastDevBar = 0;
let lastObjectives = 0;
let waitingAt: string | null = null;     // level whose co-op threshold we're queued at
let voteOpen = false;
let lastBeacons: NonNullable<Parameters<Hud['setBeacons']>[0]> = [];
/** beacons minus our own gate-wait (you can't answer your own call for help) */
function othersBeacons(list: typeof lastBeacons | undefined) {
  return (list ?? []).filter((b) => !(waitingAt && b.instanceId === `wait-${waitingAt}` && b.present <= 1));
}                     // a reset vote is running in this instance
let votedReset = false;                   // … and we already answered / proposed it
let reviveHideTimer: ReturnType<typeof setTimeout> | undefined;
let started = false;
// Echo Core: rolling 8s of positions (10 Hz) — sent with T so the ghost replays your run
const echoTrail: Vec3[] = [];
let lastEchoSample = 0;

let chosenAccent = '';
const hud = new Hud({
  onStart(name, accent) { chosenAccent = accent; start(name); },
  onEquip(d) { rig.equipped = d; net.send({ t: 'equip', v: 1, device: d }); refreshDeviceBar(); },
  onUnlockSkill(s) { net.send({ t: 'unlock_skill', v: 1, skill: s }); },
  onRespec() { net.send({ t: 'respec', v: 1 }); },
  onJoinBeacon(instanceId) { net.send({ t: 'join_instance', v: 1, instanceId }); },
  onReset() { votedReset = true; net.send({ t: 'reset_level', v: 1 }); },   // proposer counts as a yes
  onLeaveLevel() { net.send({ t: 'leave_level', v: 1 }); },
  onBeacon() { net.send({ t: 'raise_beacon', v: 1 }); audio.play('beacon'); },
  onSettings(s) { applySettings(); },
});

function applySettings() {
  const s = hud.settings;
  if (controller) controller.sensitivity = s.sensitivity;
  audio.setMasterVolume(s.master);
  audio.setMusicVolume(s.music);
  audio.setSfxVolume(s.sfx);
  if (renderer) {
    renderer.reduceMotion = s.reduceMotion;
    if (s.quality !== renderer.quality) {
      renderer.setQuality(s.quality);
      setModelQuality(s.quality);
      projectiles?.setQuality(renderer.q.projectileLights);
      particles?.setQuality(renderer.q);
    }
    particles?.setReduceMotion(s.reduceMotion);
  }
  net?.send({ t: 'set_opts', v: 1, difficulty: s.difficulty });
}

function start(name: string) {
  started = true;
  renderer = new Renderer(document.getElementById('app')!);
  setModelQuality(renderer.quality);
  hud.settings.quality = renderer.quality;   // reflect the auto-detected tier in settings
  controller = new PlayerController(() => world?.playerColliders() ?? []);
  controller.attach(renderer.canvas);
  peers = new Peers(renderer.scene, () => playerId, renderer.lights);
  enemies = new Enemies(renderer.scene, renderer.lights);
  echoes = new Echoes(renderer.scene);
  pings = new Pings(renderer.scene, renderer.lights);
  particles = new Particles(renderer.scene, renderer.lights);
  particles.setQuality(renderer.q);
  projectiles = new Projectiles(renderer.scene, particles, renderer.lights);
  projectiles.setQuality(renderer.q.projectileLights);
  viewmodel = new Viewmodel(renderer.camera);
  renderer.scene.add(renderer.camera);       // camera must be in-scene to carry the viewmodel
  hud.bindChat((text) => net.send({ t: 'chat', v: 1, text }));
  rig = new DeviceRig(renderer.scene, particles);
  audio.init();
  net = new Net();
  net.onMessage(handleMsg);
  net.onStatus((st) => {
    hud.setConnection(st, () => net.takeOver());
    if (st !== 'online') resetLocalActions();
  });
  net.connect();
  applySettings();
  bindInput();
  renderer.canvas.requestPointerLock?.();
  requestAnimationFrame(loop);
  // dev console hook (also used by the visual test rig)
  (window as unknown as Record<string, unknown>).__threshold = {
    hud,                                       // HUD feedback states for the screenshot rig
    enterLevel: (id: string) => net.send({ t: 'enter_level', v: 1, level: id }),
    leave: () => net.send({ t: 'leave_level', v: 1 }),
    pos: () => [controller.pos.x, controller.pos.y, controller.pos.z],
    warp: (x: number, y: number, z: number) => controller.teleport([x, y, z]),
    look: (yaw: number, pitch = 0) => { controller.yaw = yaw; controller.pitch = pitch; },
    // VFX debug: fire the equipped-style device locally, or play a named effect
    // a few metres in front of the camera (visual test rig only)
    fire: (dev: DeviceId = 'pulse') => { rig.owned.includes(dev) || rig.owned.push(dev); fireDevice(dev, false); },
    vfx: (name: string, dist = 4) => {
      const f = controller.forward(), e = controller.eye();
      const p = e.clone().addScaledVector(f, dist);
      const fx = particles.fx as unknown as Record<string, (...a: unknown[]) => void>;
      const back = f.clone().negate();
      if (name === 'impact' || name === 'frostBurst') fx[name](p, back, name === 'impact' ? DEVICES.pulse.color : DEVICES.freeze.color);
      else if (name === 'portalPlaced') fx[name](p, back, PALETTE.portalA);
      else if (name === 'portalTraverse') fx[name](p, PALETTE.portalB);
      else if (name === 'landing') fx[name](controller.pos, 1);
      else if (name === 'tractor') {
        const m = viewmodel.muzzle(new THREE.Vector3());
        const to = p.clone().add(new THREE.Vector3(1.5, -0.8, 0));
        let n = 0;
        const h = setInterval(() => { rig.tractorBeam('debug', viewmodel.muzzle(m), controller.forward(), to, DEVICES.tractor.color, 0.016); if (++n > 400) clearInterval(h); }, 16);
      } else fx[name]?.(p);
    },
  };
}

// ---------- message handling ----------
function handleMsg(msg: ServerMsg) {
  switch (msg.t) {
    case 'welcome': {
      playerId = msg.playerId;
      hud.inviteId = msg.playerId;
      Object.assign(profile, msg.profile);
      // restore skill-driven movement abilities on (re)connect — previously these
      // only applied after a fresh 'skills' message, so double jump / dash were
      // silently dead after every reload until the skill tree was touched again
      controller.canDoubleJump = profile.skills.includes('double-jump');
      controller.canDash = profile.skills.includes('dash');
      // apply the accent picked on the title screen (server validates the palette)
      if (chosenAccent && chosenAccent !== profile.accent) {
        profile.accent = chosenAccent;
        net.send({ t: 'set_name', v: 1, name: profile.name, accent: chosenAccent });
      }
      rig.setOwned(profile.devices);
      hud.setShards(profile.shards.length, TOTAL_SHARDS);
      refreshDeviceBar();
      net.send({ t: 'set_opts', v: 1, difficulty: hud.settings.difficulty });
      break;
    }
    case 'joined': {
      const s = msg.snapshot;
      resetLocalActions();
      waitingAt = null; voteOpen = false; votedReset = false;
      hud.voteBanner(null);
      // the server gives everyone in an instance a distinct colour
      const meSnap = s.players.find((pl) => pl.id === playerId);
      if (meSnap?.accent) profile.accent = meSnap.accent;
      world?.dispose();
      enemies.clear();
      peers.clear();
      echoes.clear();
      projectiles.clear();
      particles.clear();
      rig.clearVfx();
      lastCheckpoint = -1;
      levelDef = s.level ?? null;
      if (!levelDef) break;
      world = new World(renderer.scene, levelDef, s.states, renderer.lights, renderer.quality);
      world.playersPresent = s.players.length;
      world.solved = !!s.solved;
      renderer.setWorld(levelDef.world, world.heroFloor());
      if (levelDef.fog) renderer.setFog(levelDef.fog.color, levelDef.fog.density);
      audio.setWorld(levelDef.world);
      controller.teleport(msg.spawn, msg.spawnYaw);
      particles.fx.arrival(msg.spawn, PALETTE.portalA);
      controller.frozen = false;
      selfDowned = false; selfHp = 100;
      hud.setHealth(100, false);
      enemies.sync(s.enemies ?? []);
      syncEnemyState(s.enemies ?? []);
      peers.sync(s.players);
      world.setPlacedPortals(s.portalsPlaced ?? [], () => profile.accent);
      world.updatePortalLocks(profile.shards.length);
      inLevel = levelDef.world !== 'nexus';
      world.setTrophies(profile.shards.length);
      setupCircuit();
      hud.setLevelInfo(levelDef.name, levelDef.world.toUpperCase(),
        inLevel ? levelDef.coop : 'shared lobby — walk into a portal',
        profile.bestTimes[levelDef.id]);
      lastBeacons = s.beacons ?? [];
      hud.setBeacons(othersBeacons(s.beacons), !inLevel);
      if (levelDef.intro) hud.toast(levelDef.intro);
      audio.play('portal-traverse');
      echoPlaced = false;
      pings.clear();
      hud.gateBanner(null);
      break;
    }
    case 'snap': {
      const s = msg.s;
      peers.sync(s.players);
      echoes.sync(s.players);
      if (world) {
        world.playersPresent = s.players.length;
        if (s.enemies) { enemies.sync(s.enemies); syncEnemyState(s.enemies); }
        for (const b of s.bodies ?? []) world.setBodyPos(b.id, b.p, !!b.heldBy);
        world.setPlacedPortals(s.portalsPlaced ?? [], () => profile.accent);
        if (!!s.solved !== world.solved) {
          world.solved = !!s.solved;
          world.updatePortalLocks(profile.shards.length);
        }
      }
      if (s.beacons) hud.setBeacons(othersBeacons(s.beacons), !inLevel);
      updateRoster(s.players);
      const self = s.players.find((p) => p.id === playerId);
      if (self && Math.abs(self.hp - selfHp) > 0.5 && self.state === 'alive') {
        selfHp = self.hp;
        hud.setHealth(selfHp, selfDowned);
      }
      break;
    }
    case 'peer_joined':
      hud.addChat('', '', `${msg.player.name} stepped through.`, true);
      audio.play('portal');
      break;
    case 'peer_left': peers.remove(msg.id); break;
    case 'chat': {
      hud.addChat(msg.name, msg.accent, msg.text, msg.system);
      if (!msg.system && msg.from !== playerId) {
        peers.say(msg.from, msg.text);
        audio.play('hit');
      }
      break;
    }
    case 'ping': {
      pings.add(msg.pos, msg.accent || PALETTE.portalA);
      audio.play('beacon', { pos: msg.pos });
      break;
    }
    case 'gate_wait':
      if (msg.cancelled) {
        waitingAt = null;
        hud.setBeacons(othersBeacons(lastBeacons), !inLevel);
        hud.gateBanner(null);
        hud.toast(`Stopped waiting at ${msg.levelName}.`);
        break;
      }
      // stays up until the gate opens (joined) or the wait is cancelled/expires
      waitingAt = msg.level;
      hud.setBeacons(othersBeacons(lastBeacons), !inLevel);
      hud.gateBanner(`${msg.levelName} — waiting for a partner (${msg.waiting}/${msg.needed}). Your beacon is up in the Nexus; share an invite from the menu.`);
      break;
    case 'reset_vote':
      if (msg.state === 'open') {
        voteOpen = true;
        hud.voteBanner({ by: msg.by, yes: msg.yes, needed: msg.needed, mine: msg.by === profile.name && votedReset });
      } else {
        voteOpen = false; votedReset = false;
        hud.voteBanner(null);
        if (msg.state === 'failed') hud.toast('Reset vote failed — nothing changed.', 'warn');
      }
      break;
    case 'state_update': {
      if (!world) break;
      const prev = { ...(world.states.get(msg.id) ?? {}) };
      world.setState(msg.id, msg.state);
      if (!prev.pressed && msg.state.pressed) audio.play('plate');
      if (prev.state !== msg.state.state && msg.state.state !== undefined) audio.play('lever');
      if (!prev.on && msg.state.on) audio.play('switch');
      if (!prev.filled && msg.state.filled) audio.play('socket');
      if (!prev.frozen && msg.state.frozen) audio.play('frozen');
      if (!prev.lit && msg.state.lit) audio.play('socket');   // resonators + receivers chime
      if (!prev.collected && msg.state.collected) {
        const vis = world.interactableAt(msg.id);
        if (vis) particles.fx.pickup(vis.position);
      }
      break;
    }
    case 'enemy_event': {
      if (lastShot && msg.id === lastShot.id && performance.now() - lastShot.t < 1500 && msg.ev !== 'telegraph' && msg.ev !== 'attack' && msg.ev !== 'spawn')
        hud.hitMarker(msg.ev === 'down' || msg.ev === 'shatter');
      const pos = enemies.positionOf(msg.id);
      const at = pos ? { pos: [pos.x, pos.y, pos.z] as Vec3 } : undefined;
      enemies.event(msg.id, msg.ev, msg.data);
      if (msg.ev === 'telegraph') { enemies.telegraph(msg.id, (msg.data?.ms as number) ?? 900); audio.play('telegraph', at); }
      else if (msg.ev === 'attack') audio.play('enemy-attack', at);
      else if (msg.ev === 'down') { audio.play('enemy-down', at); if (pos) particles.fx.enemyDeath([pos.x, pos.y + 0.9, pos.z], PALETTE.hostile); }
      else if (msg.ev === 'shatter') { audio.play('shatter', at); if (pos) particles.fx.shatter([pos.x, pos.y + 0.9, pos.z]); }
      else if (msg.ev === 'frozen') { audio.play('frozen', at); if (pos) particles.fx.frozen([pos.x, pos.y + 0.9, pos.z]); }
      else if (msg.ev === 'hit') {
        audio.play('hit', at);
        if (msg.data?.blocked && performance.now() - blockedHintAt > 12000) {
          blockedHintAt = performance.now();
          hud.toast('Its shield holds — stagger it with a Pulse, or find another way.', 'warn');
        }
      }
      else if (msg.ev === 'stagger') audio.play('hit', at);
      break;
    }
    case 'device_effect': {
      const from = peers.positionOf(msg.player);
      const muzzle: Vec3 = from ? [from.x, from.y + 1.4, from.z] : msg.origin;
      const end: Vec3 = msg.hit ?? [
        msg.origin[0] + msg.dir[0] * DEVICES[msg.device].range,
        msg.origin[1] + msg.dir[1] * DEVICES[msg.device].range,
        msg.origin[2] + msg.dir[2] * DEVICES[msg.device].range];
      if (msg.device === 'pulse' || msg.device === 'freeze')
        projectiles.fire(muzzle, end, DEVICES[msg.device].color, { speed: msg.device === 'freeze' ? 52 : 72, kind: msg.device });
      else
        rig.tracer(muzzle, end, DEVICES[msg.device].color);
      audio.play(msg.device === 'freeze' ? 'fire-freeze' : 'fire-pulse', { pos: msg.origin });
      break;
    }
    case 'portal_placed':
      audio.play('portal-place', { pos: msg.placement.pos });
      particles.fx.portalPlaced(msg.placement.pos, msg.placement.normal, msg.placement.slot === 0 ? PALETTE.portalA : PALETTE.portalB);
      break;
    case 'portal_traverse':
      if (msg.player === playerId) { controller.teleport(msg.to); }
      if (msg.player === playerId) particles.fx.arrival(msg.to, PALETTE.portalA);
      else particles.fx.portalTraverse([msg.to[0], msg.to[1] + 1, msg.to[2]], PALETTE.portalA);
      audio.play('portal-traverse', { pos: msg.to });
      break;
    case 'hp': {
      if (msg.id === playerId) {
        if (msg.hp < selfHp) { hud.damageFlash(damageAngle()); audio.play('hurt'); }
        selfHp = msg.hp;
        hud.setHealth(selfHp, selfDowned);
      }
      break;
    }
    case 'downed': {
      const dp = msg.id === playerId ? controller.pos : peers.positionOf(msg.id);
      if (dp) particles.fx.downed(dp);
      if (msg.id === playerId) {
        selfDowned = true; controller.frozen = true;
        hud.setHealth(0, true);
        hud.setDownedSub('a partner can revive you — or you will return to the last checkpoint');
        audio.play('downed');
      } else hud.toast('A partner is down — get to them and hold E!', 'warn');
      break;
    }
    case 'revived': {
      if (msg.id === playerId) { selfDowned = false; controller.frozen = false; selfHp = 60; hud.setHealth(60, false); audio.play('revived'); }
      const rp = msg.id === playerId ? controller.pos : peers.positionOf(msg.id);
      if (rp) particles.fx.revive(rp, PALETTE.success);
      hud.reviveProgress(null);
      break;
    }
    case 'revive_progress': {
      hud.reviveProgress(msg.pct);
      clearTimeout(reviveHideTimer);
      reviveHideTimer = setTimeout(() => hud.reviveProgress(null), 400);
      break;
    }
    case 'respawn': {
      if (msg.id === playerId) {
        controller.teleport(msg.p);
        selfDowned = false; controller.frozen = false; selfHp = 100;
        hud.setHealth(100, false);
      }
      break;
    }
    case 'inventory': profile.inventory = msg.inventory; audio.play('pickup'); break;
    case 'devices': {
      profile.devices = msg.devices;
      rig.setOwned(msg.devices);
      refreshDeviceBar();
      if (msg.note) audio.play('unlock');
      break;
    }
    case 'skills': {
      profile.skills = msg.skills; profile.skillPoints = msg.skillPoints;
      controller.canDoubleJump = msg.skills.includes('double-jump');
      controller.canDash = msg.skills.includes('dash');
      if (hud.panelOpen) hud.showLoadout(profile as Parameters<Hud['showLoadout']>[0]);
      break;
    }
    case 'solved': {
      const styleTag = msg.style?.length ? ` · ${msg.style.join(' · ')}` : '';
      hud.banner('THRESHOLD CROSSED', `${levelDef?.name ?? ''} — ${(msg.timeMs / 1000).toFixed(1)}s (${msg.via})${msg.skillPoints ? ` · +${msg.skillPoints} skill point${msg.skillPoints > 1 ? 's' : ''}` : ''}${styleTag}`);
      audio.play('solve');
      if (levelDef) profile.bestTimes[levelDef.id] = Math.min(profile.bestTimes[levelDef.id] ?? Infinity, msg.timeMs);
      break;
    }
    case 'shards': {
      if (msg.shards.length > profile.shards.length) {
        const f = controller.forward();
        const e = controller.eye();
        particles.fx.shardGained([e.x + f.x * 2.5, e.y + f.y * 2.5, e.z + f.z * 2.5]);
      }
      profile.shards = msg.shards;
      hud.setShards(msg.shards.length, TOTAL_SHARDS);
      world?.updatePortalLocks(msg.shards.length);
      world?.setTrophies(msg.shards.length);
      audio.play('shard');
      break;
    }
    case 'beacons': lastBeacons = msg.beacons ?? []; hud.setBeacons(othersBeacons(lastBeacons), !inLevel); break;
    case 'toast': hud.toast(msg.text, msg.kind); if (msg.kind === 'warn') audio.play('locked'); break;
    case 'reset_done': votedReset = false; hud.toast('Level reset — everything is back where it began.'); break;
    case 'error': hud.toast(msg.message, 'warn'); break;
  }
}

function syncEnemyState(snaps: { id: string; state: string }[]) {
  if (!world) return;
  let changed = false;
  for (const s of snaps) {
    if (!world.enemyIds.has(s.id)) { world.enemyIds.add(s.id); changed = true; }
    const isDown = s.state === 'down';
    if (isDown !== world.enemyDown.has(s.id)) {
      if (isDown) world.enemyDown.add(s.id); else world.enemyDown.delete(s.id);
      changed = true;
    }
  }
  if (changed) world.applyStates();
}

function updateRoster(players: { id: string; name: string; accent: string; hp: number; state: string }[]) {
  hud.setRoster(players.map((p) => ({
    name: p.name, accent: p.accent || PALETTE.portalA, hp: p.hp, downed: p.state === 'downed', self: p.id === playerId,
  })));
}

function refreshDeviceBar() {
  hud.setDevices(rig.owned, rig.equipped, (d) => rig.chargeText(d), (d) => rig.cooldownPct(d));
}

// ---------- input ----------
function bindInput() {
  const canvas = renderer.canvas;
  canvas.addEventListener('click', () => {
    if (!hud.panelOpen && document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
  });
  addEventListener('hud-closed', () => {
    controller.frozen = selfDowned;
    if (net.status !== 'replaced') renderer.canvas.requestPointerLock?.();
  });
  document.addEventListener('pointerlockchange', () => {
    // a tab paused by a takeover shows only the "play here" panel, not the pause menu
    if (document.pointerLockElement !== renderer.canvas && started && !hud.panelOpen && net.status !== 'replaced') {
      hud.showMenu(inLevel);
      controller.frozen = true;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (hud.chatOpen) return;
    // keys typed into a field (the title-screen name box, menus) are not game input —
    // the Enter that submits the title screen used to open chat on the first frame
    const tgt = e.target as HTMLElement | null;
    const typing = tgt instanceof HTMLInputElement ? ['text', 'search', 'email', ''].includes(tgt.type)
      : !!tgt && (tgt.tagName === 'TEXTAREA' || tgt.isContentEditable);
    if (typing) return;
    // OS key auto-repeat would re-send one-shot actions ~30x/s: holding E restarted the
    // revive timer every repeat (revives never finished) and flip-flopped levers/grabs
    if (e.repeat) return;
    if (e.code === 'Enter' && started && !hud.panelOpen) { hud.openChat(); e.preventDefault(); return; }
    if (hud.panelOpen && e.code !== 'Escape') return;
    switch (e.code) {
      case 'KeyE': onInteractDown(); break;
      case 'KeyF': onGrabToggle(); break;
      case 'KeyQ': if (inLevel) { net.send({ t: 'raise_beacon', v: 1 }); audio.play('beacon'); } break;
      case 'KeyL': hud.showLoadout(profile as Parameters<Hud['showLoadout']>[0]); controller.frozen = true; document.exitPointerLock?.(); break;
      case 'KeyT':
        if (profile.skills.includes('echo-core')) {
          echoPlaced = !echoPlaced;
          net.send({ t: 'echo', v: 1, place: echoPlaced, path: echoPlaced ? [...echoTrail] : undefined });
          hud.toast(echoPlaced ? 'Echo placed — it replays your last 8 seconds, on loop.' : 'Echo recalled.');
        }
        break;
      case 'KeyV': if (world && profile.skills.includes('phase-sight')) world.phaseSight = true; break;
      case 'KeyX': if (waitingAt) net.send({ t: 'cancel_wait', v: 1 }); break;
      case 'KeyY': case 'KeyN':
        if (voteOpen && !votedReset) { votedReset = true; net.send({ t: 'reset_vote', v: 1, yes: e.code === 'KeyY' }); }
        break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': {
        const i = Number(e.code.slice(-1)) - 1;
        if (rig.owned[i]) { rig.equipped = rig.owned[i]; net.send({ t: 'equip', v: 1, device: rig.owned[i] }); refreshDeviceBar(); }
        break;
      }
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'KeyE') cancelRevive();
    if (e.code === 'KeyV' && world) world.phaseSight = false;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement !== canvas || selfDowned || hud.panelOpen || hud.chatOpen) return;
    if (e.button === 0) onPrimaryDown();
    else if (e.button === 1) { e.preventDefault(); onPing(); }
    else if (e.button === 2) onSecondaryDown();
  });
  // document-level: releasing over the menu (after Esc unlocks the pointer) must still
  // end a held tractor/charge
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) onPrimaryUp();
  });
  addEventListener('blur', () => { onPrimaryUp(); cancelRevive(); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('wheel', (e) => {
    if (document.pointerLockElement !== canvas || rig.owned.length < 2 || hud.chatOpen || hud.panelOpen) return;
    const i = rig.owned.indexOf(rig.equipped);
    const next = rig.owned[(i + (e.deltaY > 0 ? 1 : rig.owned.length - 1)) % rig.owned.length];
    rig.equipped = next;
    net.send({ t: 'equip', v: 1, device: next });
    refreshDeviceBar();
  });
}

function aim(): { origin: Vec3; dir: Vec3 } {
  const eye = controller.eye();
  const f = controller.forward();
  return { origin: [eye.x, eye.y, eye.z], dir: [f.x, f.y, f.z] };
}

function pickEnemyOnRay(range: number): { id: string; point: Vec3 } | null {
  const { origin, dir } = aim();
  const o = new THREE.Vector3(...origin), d = new THREE.Vector3(...dir);
  let best: { id: string; point: Vec3 } | null = null;
  let bestT = Infinity;
  for (const e of enemies.meshEntries()) {
    if (e.dead) continue;
    const c = e.obj.position.clone().setY(e.obj.position.y + e.height / 2);
    const t = c.clone().sub(o).dot(d);
    if (t < 0 || t > range || t > bestT) continue;
    const closest = o.clone().add(d.clone().multiplyScalar(t));
    if (closest.distanceTo(c) < 1.6) { bestT = t; best = { id: e.id, point: [c.x, c.y, c.z] }; }
  }
  return best;
}

function pickBodyOnRay(range: number): { id: string; point: Vec3 } | null {
  if (!world) return null;
  const { origin, dir } = aim();
  const o = new THREE.Vector3(...origin), d = new THREE.Vector3(...dir);
  let best: { id: string; point: Vec3 } | null = null;
  let bestT = Infinity;
  for (const it of world.interactableDefs()) {
    if (it.type !== 'carryable') continue;
    const vis = world.interactableAt(it.id);
    if (!vis) continue;
    const t = vis.position.clone().sub(o).dot(d);
    if (t < 0 || t > range || t > bestT) continue;
    if (o.clone().add(d.clone().multiplyScalar(t)).distanceTo(vis.position) < 1.3) {
      bestT = t;
      best = { id: it.id, point: [vis.position.x, vis.position.y, vis.position.z] };
    }
  }
  return best;
}

let chargeHeld = false;
let lastShot: { id: string; t: number } | null = null;   // for server-confirmed hit markers
/** screen angle (0 = ahead, +right) toward the nearest aggroed enemy, for the damage-direction arc */
function damageAngle(): number | undefined {
  const p = controller.pos;
  let best: THREE.Vector3 | undefined, bd = Infinity;
  for (const e of enemies.aggroPositions()) { const d = e.distanceToSquared(p); if (d < bd) { bd = d; best = e; } }
  if (!best) return undefined;
  const dx = best.x - p.x, dz = best.z - p.z, y = controller.yaw;
  return Math.atan2(dx * Math.cos(y) - dz * Math.sin(y), -dx * Math.sin(y) - dz * Math.cos(y));
}
function cancelRevive() {
  if (revivingId) { net.send({ t: 'revive_cancel', v: 1 }); revivingId = null; }
}
/** drop every held/in-progress local action — on level change, reconnect or reset */
function resetLocalActions() {
  chargeHeld = false;
  if (rig.tractorActive) { rig.tractorActive = false; rig.tractorTarget = undefined; }
  revivingId = null;
  carryingLocal = null;
}
function onPrimaryDown() {
  const dev = rig.equipped;
  if (dev === 'pulse' && profile.skills.includes('charged-pulse')) {
    chargeHeld = true;
    rig.chargeStart = performance.now();
    return;
  }
  fireDevice(dev, false);
}
function onPrimaryUp() {
  if (chargeHeld) {
    chargeHeld = false;
    fireDevice('pulse', performance.now() - rig.chargeStart > 600);
  }
  if (rig.tractorActive) {
    rig.tractorActive = false;
    rig.tractorTarget = undefined;
    net.send({ t: 'tractor', v: 1, active: false });
  }
}
function onSecondaryDown() {
  if (rig.equipped === 'portalgun') placePortal(1);
}

function onPing() {
  const { origin, dir } = aim();
  const hit = world?.raycastWalls(origin, dir, 60);
  const pos: Vec3 = hit
    ? [origin[0] + dir[0] * (hit.dist - 0.2), origin[1] + dir[1] * (hit.dist - 0.2), origin[2] + dir[2] * (hit.dist - 0.2)]
    : [origin[0] + dir[0] * 12, origin[1] + dir[1] * 12, origin[2] + dir[2] * 12];
  net.send({ t: 'ping', v: 1, pos });
}

function fireDevice(dev: DeviceId, charged: boolean) {
  if (!rig.canFire(dev) && dev !== 'tractor' && dev !== 'portalgun') return;
  const { origin, dir } = aim();
  switch (dev) {
    case 'pulse': case 'freeze': {
      rig.markFired(dev);
      const enemy = pickEnemyOnRay(DEVICES[dev].range);
      hud.fired();
      if (enemy) lastShot = { id: enemy.id, t: performance.now() };
      const wall = world?.raycastWalls(origin, dir, DEVICES[dev].range);
      const end: Vec3 = enemy?.point ?? (wall
        ? [origin[0] + dir[0] * wall.dist, origin[1] + dir[1] * wall.dist, origin[2] + dir[2] * wall.dist]
        : [origin[0] + dir[0] * DEVICES[dev].range, origin[1] + dir[1] * DEVICES[dev].range, origin[2] + dir[2] * DEVICES[dev].range]);
      const muzzle = viewmodel.muzzle(new THREE.Vector3());
      // traveling projectile (carries its own light + impact flash + burst)
      projectiles.fire(muzzle, end, DEVICES[dev].color, {
        speed: dev === 'freeze' ? 52 : 72,
        scale: dev === 'freeze' ? 1.3 : 1,
        kind: dev,
      });
      viewmodel.kick();
      audio.play(dev === 'freeze' ? 'fire-freeze' : 'fire-pulse');
      net.send({ t: 'fire', v: 1, device: dev, origin, dir, charged, targetId: enemy?.id });
      refreshDeviceBar();
      break;
    }
    case 'tractor': {
      const target = pickEnemyOnRay(DEVICES.tractor.range) ?? pickBodyOnRay(DEVICES.tractor.range);
      if (!target) return;
      rig.tractorActive = true;
      rig.tractorTarget = target.id;
      const eye = controller.eye();
      rig.tractorDist = Math.max(2.5, Math.min(12, eye.distanceTo(new THREE.Vector3(...target.point))));
      break;
    }
    case 'portalgun': placePortal(0); break;
  }
}

function placePortal(slot: 0 | 1) {
  if (!world?.level.placeablePortals?.enabled) { hud.toast('Portals find no purchase here.', 'warn'); return; }
  const { origin, dir } = aim();
  const hit = world.raycastWalls(origin, dir, DEVICES.portalgun.range, true);
  if (!hit) { audio.play('locked'); return; }
  const pos: Vec3 = [
    origin[0] + dir[0] * hit.dist + hit.normal[0] * 0.08,
    origin[1] + dir[1] * hit.dist + hit.normal[1] * 0.08,
    origin[2] + dir[2] * hit.dist + hit.normal[2] * 0.08];
  net.send({ t: 'place_portal', v: 1, slot, pos, normal: hit.normal });
  const pm = viewmodel.muzzle(new THREE.Vector3());
  rig.tracer([pm.x, pm.y, pm.z], pos, slot === 0 ? PALETTE.portalA : PALETTE.portalB, 0.03, 220);
  viewmodel.kick(slot);
}

// interact / revive / grab targeting
interface Focus { kind: 'interact' | 'pickup' | 'socket' | 'revive' | 'aim'; id: string; label: string }
let focus: Focus | null = null;

function scanFocus(): Focus | null {
  if (!world || selfDowned) return null;
  const p = controller.pos;
  // downed peers first
  for (const [id, a] of peers.entries()) {
    if (a.downed && a.group.position.distanceTo(p) < (profile.skills.includes('field-medic') ? 4 : 2.5)) {
      return { kind: 'revive', id, label: `<b>Hold E</b> — revive partner` };
    }
  }
  let best: Focus | null = null;
  let bestD = 3;
  for (const it of world.interactableDefs()) {
    const vis = world.interactableAt(it.id);
    const pos = vis ? vis.position : new THREE.Vector3(...(it as { pos: Vec3 }).pos);
    const d = pos.distanceTo(p);
    if (d > bestD) continue;
    const st = world.states.get(it.id) ?? {};
    if (it.type === 'lever') { best = { kind: 'interact', id: it.id, label: '<b>E</b> — pull the lever' }; bestD = d; }
    else if (it.type === 'rotator') { best = { kind: 'interact', id: it.id, label: '<b>E</b> — turn the wheel' }; bestD = d; }
    else if (it.type === 'collectible' && !st.collected) {
      best = { kind: 'pickup', id: it.id, label: `<b>E</b> — take the ${esc(it.grants)}` }; bestD = d;
    } else if (it.type === 'socket' && !st.filled && profile.inventory.includes(it.accepts)) {
      best = { kind: 'socket', id: it.id, label: `<b>E</b> — slot the ${esc(it.accepts)}` }; bestD = d;
    }
  }
  return best ?? scanAimHint();
}

/** Nothing in reach: hint when the crosshair rests on an unlit switch within Pulse range
    (switches are meant to be shot from across a gap, so the E-radius never finds them). */
function scanAimHint(): Focus | null {
  if (!world || !rig.owned.includes('pulse')) return null;
  const { origin, dir } = aim();
  const o = new THREE.Vector3(...origin), d = new THREE.Vector3(...dir);
  for (const it of world.interactableDefs()) {
    if (it.type !== 'switch' || world.states.get(it.id)?.on) continue;
    const c = world.interactableAt(it.id)?.position ?? new THREE.Vector3(...it.pos);
    const t = c.clone().sub(o).dot(d);
    if (t < 0 || t > DEVICES.pulse.range) continue;
    if (o.clone().addScaledVector(d, t).distanceTo(c) < 0.9)
      return { kind: 'aim', id: it.id, label: '<b>LMB</b> — pulse the switch' };
  }
  return null;
}
function esc(s: string) { return s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!)); }

function onInteractDown() {
  if (!focus) return;
  if (focus.kind === 'revive') { net.send({ t: 'revive_start', v: 1, target: focus.id }); revivingId = focus.id; }
  else if (focus.kind === 'pickup') net.send({ t: 'pickup', v: 1, itemId: focus.id });
  else if (focus.kind === 'socket') {
    const it = world?.interactableDefs().find((i) => i.id === focus!.id) as Extract<InteractableDef, { type: 'socket' }> | undefined;
    if (it) net.send({ t: 'use_item', v: 1, item: it.accepts, socketId: it.id });
  } else net.send({ t: 'interact', v: 1, target: focus.id });
}

let carryingLocal: string | null = null;
function onGrabToggle() {
  if (!world) return;
  if (carryingLocal) {
    net.send({ t: 'release', v: 1 });
    carryingLocal = null;
    return;
  }
  let best: string | null = null;
  let bestD = 3;
  for (const it of world.interactableDefs()) {
    if (it.type !== 'carryable') continue;
    const vis = world.interactableAt(it.id);
    if (!vis) continue;
    const d = vis.position.distanceTo(controller.pos);
    if (d < bestD) { bestD = d; best = it.id; }
  }
  if (best) { net.send({ t: 'grab', v: 1, target: best }); carryingLocal = best; }
}

// ---------- main loop ----------
let lastT = performance.now();
function loop(t: number) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;

  controller.frozen = selfDowned || hud.panelOpen || hud.chatOpen || document.pointerLockElement !== renderer.canvas;
  // conveyors move the local player (client-authoritative movement)
  controller.external.set(0, 0, 0);
  const flow = world?.conveyorPush(controller.pos);
  if (flow) controller.external.set(flow[0], 0, flow[2]);
  controller.update(dt);
  if (t - lastEchoSample > 100) {
    lastEchoSample = t;
    echoTrail.push([controller.pos.x, controller.pos.y, controller.pos.z]);
    if (echoTrail.length > 80) echoTrail.shift();
  }
  updateCircuit(t);

  // camera
  renderer.camera.rotation.order = 'YXZ';
  renderer.camera.position.copy(controller.eye());
  renderer.camera.rotation.y = controller.yaw;
  renderer.camera.rotation.x = controller.pitch;
  renderer.followShadow(controller.pos);

  // net: movement + tractor stream
  if (t - lastMoveSent > 66 && net?.connected) {
    lastMoveSent = t;
    const moving = Math.abs(controller.vel.x) + Math.abs(controller.vel.z) > 0.5;
    net.send({
      t: 'move', v: 1,
      p: [controller.pos.x, controller.pos.y, controller.pos.z],
      yaw: controller.yaw, pitch: controller.pitch,
      anim: controller.onGround ? (moving ? 1 : 0) : 2,
    });
  }
  if (rig.tractorActive && rig.tractorTarget && t - lastTractorSent > 100) {
    lastTractorSent = t;
    const { origin, dir } = aim();
    const aimPoint: Vec3 = [
      origin[0] + dir[0] * rig.tractorDist,
      origin[1] + dir[1] * rig.tractorDist,
      origin[2] + dir[2] * rig.tractorDist];
    net.send({ t: 'tractor', v: 1, active: true, targetId: rig.tractorTarget, aim: aimPoint });
  }
  if (rig.tractorActive && rig.tractorTarget) {
    // continuous curved beam, re-aimed every frame (replaces the 100ms tracer spam)
    const tp = enemies.positionOf(rig.tractorTarget) ?? world?.interactableAt(rig.tractorTarget)?.position;
    if (tp) rig.tractorBeam('local', viewmodel.muzzle(tractorFrom), controller.forward(), tp, DEVICES.tractor.color, dt);
  }

  // world + entities
  world?.update(dt, controller.pos);
  peers.update(dt);
  enemies.update(dt);
  pings.update(dt);
  projectiles.update(dt);
  rig.update(dt);
  landingAndCheckpointFx();

  // viewmodel + particles
  viewmodel.setDevice(rig.equipped);
  const movingNow = Math.abs(controller.vel.x) + Math.abs(controller.vel.z) > 0.5;
  viewmodel.setAccent(profile.accent);
  enemies.setTractored(rig.tractorActive ? rig.tractorTarget : undefined);
  viewmodel.update(dt, movingNow, controller.onGround, {
    charge: chargeHeld ? Math.min(1, (performance.now() - rig.chargeStart) / 600) : 0,
    tractor: rig.tractorActive, speed: Math.hypot(controller.vel.x, controller.vel.z),
  });
  renderer.tick(dt, renderer.camera.position);
  if (levelDef && renderer.q.ambientParticles) {
    particles.ambient(levelDef.world, controller.pos, dt);
    // portal motes + ember trails on aggroed enemies (cheap, rate-limited by frame)
    if (Math.random() < dt * 14) {
      for (const pp of world?.portalPoints() ?? []) {
        if (Math.hypot(pp.pos[0] - controller.pos.x, pp.pos[2] - controller.pos.z) < 45)
          particles.motes(pp.pos[0], pp.pos[1], pp.pos[2], pp.color);
      }
    }
    if (Math.random() < dt * 20) {
      for (const ep of enemies.aggroPositions())
        particles.spawn(ep.x, ep.y, ep.z, PALETTE.hostile,
          (Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6, 0.9, { drag: 1 });
    }
  }
  particles.update(dt);

  // device bar cooldown/charges animate
  if (t - lastDevBar > 250) { lastDevBar = t; refreshDeviceBar(); }

  // objectives checklist (cheap: <= 8 expressions, the HUD diffs)
  if (t - lastObjectives > 200) {
    lastObjectives = t;
    hud.setObjectives(levelDef?.objectives?.map((o) => ({ text: o.text, done: world?.evalSafe(o.done) ?? false })) ?? []);
  }

  // prompts
  focus = scanFocus();
  if (carryingLocal) hud.prompt('<b>F</b> — set it down');
  else hud.prompt(focus?.label ?? null);

  // lobby portal hints
  updatePortalHint();

  // audio listener + combat layer
  const f = controller.forward();
  audio.updateListener(
    [controller.pos.x, controller.pos.y + 1.5, controller.pos.z],
    [f.x, f.y, f.z]);
  audio.setCombat(inLevel && enemies.anyAggro(controller.pos));

  renderer.render();
}

// ---------- Nexus parkour circuit ----------
// A timed ring race up the spire: start pad at the NE sky steps, finish on the
// crow's nest. Client-side; best time in localStorage, finishes announced in chat.
const CIRCUIT: Vec3[] = [
  [9.47, 1.6, 9.47],    // first sky step
  [6.08, 4.4, 6.08],    // mid-tier platform
  [4.24, 6.2, 4.24],    // tier-2 floating step
  [1.84, 8.7, 1.84],    // spiral around the spire
  [0, 11.2, 0],         // crow's nest
];
let circuitGroup: THREE.Group | null = null;
let circuitRings: THREE.Mesh[] = [];
let circuitNext = -1;         // -1 idle, 0..n racing
let circuitStart = 0;

function setupCircuit() {
  if (circuitGroup) { renderer.scene.remove(circuitGroup); disposeObject(circuitGroup); circuitGroup = null; circuitRings = []; }
  circuitNext = -1;
  if (levelDef?.world !== 'nexus') return;
  circuitGroup = new THREE.Group();
  for (const p of CIRCUIT) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.07, 8, 32),
      new THREE.MeshStandardMaterial({ color: '#ffd98a', emissive: '#ffd98a', emissiveIntensity: 0.35, transparent: true, opacity: 0.55 }));
    ring.position.set(...p);
    circuitRings.push(ring);
    circuitGroup.add(ring);
  }
  renderer.scene.add(circuitGroup);
}

function updateCircuit(t: number) {
  if (!circuitGroup || levelDef?.world !== 'nexus' || selfDowned) return;
  const p = controller.pos;
  // idle: standing by the first ring arms the race
  if (circuitNext < 0) {
    if (p.distanceTo(circuitRings[0].position) < 2.2) {
      circuitNext = 0; circuitStart = t;
      hud.toast('Circuit started — thread the gold rings to the crow’s nest!');
      audio.play('beacon');
    }
  } else if (p.distanceTo(circuitRings[circuitNext].position) < 1.9) {
    audio.play('plate');
    circuitNext++;
    if (circuitNext >= circuitRings.length) {
      const secs = (t - circuitStart) / 1000;
      const best = Number(localStorage.getItem('t-circuit-best') ?? Infinity);
      if (secs < best) localStorage.setItem('t-circuit-best', String(secs));
      hud.banner('CIRCUIT CLEAR', `${secs.toFixed(1)}s${secs < best ? ' — new personal best!' : ` (best ${best.toFixed(1)}s)`}`);
      audio.play('solve');
      net.send({ t: 'chat', v: 1, text: `cleared the Nexus circuit in ${secs.toFixed(1)}s` });
      circuitNext = -1;
    }
  } else if (t - circuitStart > 90_000) {
    circuitNext = -1;          // wandered off — quietly disarm
  }
  // ring visuals: next ring burns bright, cleared rings dim
  for (let i = 0; i < circuitRings.length; i++) {
    const m = circuitRings[i].material as THREE.MeshStandardMaterial;
    const active = i === circuitNext;
    m.emissiveIntensity = THREE.MathUtils.lerp(m.emissiveIntensity, active ? 2.2 : 0.35, 0.1);
    m.opacity = active ? 0.9 : 0.5;
    circuitRings[i].rotation.y += active ? 0.03 : 0.006;
  }
}

// VFX hooks driven by the local controller: landing dust and checkpoint rings
const tractorFrom = new THREE.Vector3();
let wasGrounded = true;
let airVy = 0;
let lastCheckpoint = -1;
function landingAndCheckpointFx() {
  if (!controller.onGround) airVy = Math.min(airVy, controller.vel.y);
  else {
    if (!wasGrounded && airVy < -5) particles.fx.landing(controller.pos, (-airVy - 5) / 9);
    airVy = 0;
  }
  wasGrounded = controller.onGround;
  const cps = levelDef?.checkpoints;
  if (cps && !selfDowned) {
    for (let i = lastCheckpoint + 1; i < cps.length; i++) {
      const c = cps[i];
      if (Math.hypot(c[0] - controller.pos.x, c[1] - controller.pos.y, c[2] - controller.pos.z) < 3.5) {
        lastCheckpoint = i;
        particles.fx.checkpoint(c);
      }
    }
  }
}

let lastHint = '';
function updatePortalHint() {
  if (!world || !levelDef) return;
  let hint: string | null = null;
  for (const portal of levelDef.portals ?? []) {
    const d = Math.hypot(portal.pos[0] - controller.pos.x, portal.pos[2] - controller.pos.z);
    if (d < 5) {
      const gate = portal.requiresShards ?? 0;
      if (gate > profile.shards.length) hint = `${portal.label ?? 'Portal'} — sealed (${gate} shards needed, you carry ${profile.shards.length})`;
      else if (portal.requiresSolved && !world.solved) hint = `${portal.label ?? 'Threshold'} — solve this place to open it`;
      else hint = `${portal.label ?? 'Portal'} — walk through`;
      break;
    }
  }
  if (hint !== lastHint) { hud.hint(hint); lastHint = hint ?? ''; }
}
