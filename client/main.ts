// THRESHOLD client entry: wires renderer, world, controller, net, HUD, audio.
import * as THREE from 'three';
import { Renderer } from './render/renderer';
import { World } from './world';
import { PlayerController } from './player';
import { Peers, Enemies } from './entities';
import { DeviceRig } from './devices';
import { Hud } from './hud';
import { Net } from './net';
import { GameAudio } from './audio';
import { DEVICES, type DeviceId } from '../shared/devices';
import type { InteractableDef, LevelDef, Vec3 } from '../shared/level';
import type { ServerMsg } from '../shared/messages';
import { PALETTE } from '../shared/palette';

const TOTAL_SHARDS = 11;

let renderer: Renderer;
let world: World | null = null;
let controller: PlayerController;
let peers: Peers;
let enemies: Enemies;
let rig: DeviceRig;
let net: Net;
const audio = new GameAudio();

let playerId = '';
let profile = {
  name: '', accent: PALETTE.portalA, shards: [] as string[], skillPoints: 0,
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
let reviveHideTimer: ReturnType<typeof setTimeout> | undefined;
let started = false;

const hud = new Hud({
  onStart(name) { start(name); },
  onEquip(d) { rig.equipped = d; net.send({ t: 'equip', v: 1, device: d }); refreshDeviceBar(); },
  onUnlockSkill(s) { net.send({ t: 'unlock_skill', v: 1, skill: s }); },
  onRespec() { net.send({ t: 'respec', v: 1 }); },
  onJoinBeacon(instanceId) { net.send({ t: 'join_instance', v: 1, instanceId }); },
  onReset() { net.send({ t: 'reset_level', v: 1 }); },
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
  if (renderer) renderer.reduceMotion = s.reduceMotion;
  net?.send({ t: 'set_opts', v: 1, difficulty: s.difficulty });
}

function start(name: string) {
  started = true;
  renderer = new Renderer(document.getElementById('app')!);
  controller = new PlayerController(() => world?.colliders ?? []);
  controller.attach(renderer.canvas);
  peers = new Peers(renderer.scene, () => playerId);
  enemies = new Enemies(renderer.scene);
  rig = new DeviceRig(renderer.scene);
  audio.init();
  net = new Net();
  net.onMessage(handleMsg);
  net.connect();
  applySettings();
  bindInput();
  renderer.canvas.requestPointerLock?.();
  requestAnimationFrame(loop);
}

// ---------- message handling ----------
function handleMsg(msg: ServerMsg) {
  switch (msg.t) {
    case 'welcome': {
      playerId = msg.playerId;
      Object.assign(profile, msg.profile);
      rig.setOwned(profile.devices);
      hud.setShards(profile.shards.length, TOTAL_SHARDS);
      refreshDeviceBar();
      net.send({ t: 'set_opts', v: 1, difficulty: hud.settings.difficulty });
      break;
    }
    case 'joined': {
      const s = msg.snapshot;
      world?.dispose();
      enemies.clear();
      peers.clear();
      levelDef = s.level ?? null;
      if (!levelDef) break;
      world = new World(renderer.scene, levelDef, s.states);
      world.playersPresent = s.players.length;
      world.solved = !!s.solved;
      renderer.setWorld(levelDef.world);
      if (levelDef.fog) renderer.setFog(levelDef.fog.color, levelDef.fog.density);
      audio.setWorld(levelDef.world);
      controller.teleport(msg.spawn, msg.spawnYaw);
      controller.frozen = false;
      selfDowned = false; selfHp = 100;
      hud.setHealth(100, false);
      enemies.sync(s.enemies ?? []);
      syncEnemyState(s.enemies ?? []);
      peers.sync(s.players);
      world.setPlacedPortals(s.portalsPlaced ?? [], () => profile.accent);
      world.updatePortalLocks(profile.shards.length);
      inLevel = levelDef.world !== 'nexus';
      hud.setLevelInfo(levelDef.name, levelDef.world.toUpperCase(),
        inLevel ? levelDef.coop : 'shared lobby — walk into a portal',
        profile.bestTimes[levelDef.id]);
      hud.setBeacons(s.beacons ?? [], !inLevel);
      if (levelDef.intro) hud.toast(levelDef.intro);
      audio.play('portal-traverse');
      echoPlaced = false;
      break;
    }
    case 'snap': {
      const s = msg.s;
      peers.sync(s.players);
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
      if (s.beacons) hud.setBeacons(s.beacons, !inLevel);
      updateRoster(s.players);
      break;
    }
    case 'peer_joined': hud.toast(`${msg.player.name} stepped through.`); break;
    case 'peer_left': peers.remove(msg.id); break;
    case 'state_update': {
      if (!world) break;
      const prev = { ...(world.states.get(msg.id) ?? {}) };
      world.setState(msg.id, msg.state);
      if (!prev.pressed && msg.state.pressed) audio.play('plate');
      if (prev.state !== msg.state.state && msg.state.state !== undefined) audio.play('lever');
      if (!prev.on && msg.state.on) audio.play('switch');
      if (!prev.filled && msg.state.filled) audio.play('socket');
      if (!prev.frozen && msg.state.frozen) audio.play('frozen');
      break;
    }
    case 'enemy_event': {
      const pos = enemies.positionOf(msg.id);
      const at = pos ? { pos: [pos.x, pos.y, pos.z] as Vec3 } : undefined;
      if (msg.ev === 'telegraph') { enemies.telegraph(msg.id, (msg.data?.ms as number) ?? 900); audio.play('telegraph', at); }
      else if (msg.ev === 'attack') audio.play('enemy-attack', at);
      else if (msg.ev === 'down') { audio.play('enemy-down', at); }
      else if (msg.ev === 'shatter') audio.play('shatter', at);
      else if (msg.ev === 'frozen') audio.play('frozen', at);
      else if (msg.ev === 'hit') audio.play('hit', at);
      else if (msg.ev === 'stagger') audio.play('hit', at);
      break;
    }
    case 'device_effect': {
      const from = peers.positionOf(msg.player);
      if (from) {
        const origin: Vec3 = [from.x, from.y + 1.4, from.z];
        const end: Vec3 = [
          msg.origin[0] + msg.dir[0] * DEVICES[msg.device].range,
          msg.origin[1] + msg.dir[1] * DEVICES[msg.device].range,
          msg.origin[2] + msg.dir[2] * DEVICES[msg.device].range];
        rig.tracer(origin, end, DEVICES[msg.device].color);
      }
      audio.play(msg.device === 'freeze' ? 'fire-freeze' : 'fire-pulse', { pos: msg.origin });
      break;
    }
    case 'portal_placed': audio.play('portal-place', { pos: msg.placement.pos }); break;
    case 'portal_traverse':
      if (msg.player === playerId) { controller.teleport(msg.to); }
      audio.play('portal-traverse', { pos: msg.to });
      break;
    case 'hp': {
      if (msg.id === playerId) {
        if (msg.hp < selfHp) { hud.damageFlash(); audio.play('hurt'); }
        selfHp = msg.hp;
        hud.setHealth(selfHp, selfDowned);
      }
      break;
    }
    case 'downed': {
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
      hud.banner('THRESHOLD CROSSED', `${levelDef?.name ?? ''} — ${(msg.timeMs / 1000).toFixed(1)}s (${msg.via})${msg.skillPoints ? ` · +${msg.skillPoints} skill point${msg.skillPoints > 1 ? 's' : ''}` : ''}`);
      audio.play('solve');
      if (levelDef) profile.bestTimes[levelDef.id] = Math.min(profile.bestTimes[levelDef.id] ?? Infinity, msg.timeMs);
      break;
    }
    case 'shards': {
      profile.shards = msg.shards;
      hud.setShards(msg.shards.length, TOTAL_SHARDS);
      world?.updatePortalLocks(msg.shards.length);
      audio.play('shard');
      break;
    }
    case 'beacons': hud.setBeacons(msg.beacons ?? [], !inLevel); break;
    case 'toast': hud.toast(msg.text, msg.kind); if (msg.kind === 'warn') audio.play('locked'); break;
    case 'reset_done': hud.toast('Level reset — everything is back where it began.'); break;
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
  addEventListener('hud-closed', () => { controller.frozen = selfDowned; renderer.canvas.requestPointerLock?.(); });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== renderer.canvas && started && !hud.panelOpen) {
      hud.showMenu(inLevel);
      controller.frozen = true;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (hud.panelOpen && e.code !== 'Escape') return;
    switch (e.code) {
      case 'KeyE': onInteractDown(); break;
      case 'KeyF': onGrabToggle(); break;
      case 'KeyQ': if (inLevel) { net.send({ t: 'raise_beacon', v: 1 }); audio.play('beacon'); } break;
      case 'KeyL': hud.showLoadout(profile as Parameters<Hud['showLoadout']>[0]); controller.frozen = true; document.exitPointerLock?.(); break;
      case 'KeyT':
        if (profile.skills.includes('echo-core')) {
          echoPlaced = !echoPlaced;
          net.send({ t: 'echo', v: 1, place: echoPlaced });
          hud.toast(echoPlaced ? 'Echo placed — it holds your weight.' : 'Echo recalled.');
        }
        break;
      case 'KeyV': if (world && profile.skills.includes('phase-sight')) world.phaseSight = true; break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': {
        const i = Number(e.code.slice(-1)) - 1;
        if (rig.owned[i]) { rig.equipped = rig.owned[i]; net.send({ t: 'equip', v: 1, device: rig.owned[i] }); refreshDeviceBar(); }
        break;
      }
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'KeyE' && revivingId) { net.send({ t: 'revive_cancel', v: 1 }); revivingId = null; }
    if (e.code === 'KeyV' && world) world.phaseSight = false;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement !== canvas || selfDowned || hud.panelOpen) return;
    if (e.button === 0) onPrimaryDown();
    else if (e.button === 2) onSecondaryDown();
  });
  canvas.addEventListener('mouseup', (e) => {
    if (e.button === 0) onPrimaryUp();
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('wheel', (e) => {
    if (document.pointerLockElement !== canvas || rig.owned.length < 2) return;
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

function fireDevice(dev: DeviceId, charged: boolean) {
  if (!rig.canFire(dev) && dev !== 'tractor' && dev !== 'portalgun') return;
  const { origin, dir } = aim();
  switch (dev) {
    case 'pulse': case 'freeze': {
      rig.markFired(dev);
      const enemy = pickEnemyOnRay(DEVICES[dev].range);
      const wall = world?.raycastWalls(origin, dir, DEVICES[dev].range);
      const end: Vec3 = enemy?.point ?? (wall
        ? [origin[0] + dir[0] * wall.dist, origin[1] + dir[1] * wall.dist, origin[2] + dir[2] * wall.dist]
        : [origin[0] + dir[0] * DEVICES[dev].range, origin[1] + dir[1] * DEVICES[dev].range, origin[2] + dir[2] * DEVICES[dev].range]);
      rig.tracer([origin[0], origin[1] - 0.18, origin[2]], end, DEVICES[dev].color, dev === 'freeze' ? 0.07 : 0.045);
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
  rig.tracer(origin, pos, slot === 0 ? PALETTE.portalA : PALETTE.portalB, 0.03);
}

// interact / revive / grab targeting
interface Focus { kind: 'interact' | 'pickup' | 'socket' | 'revive'; id: string; label: string }
let focus: Focus | null = null;

function scanFocus(): Focus | null {
  if (!world || selfDowned) return null;
  const p = controller.pos;
  // downed peers first
  for (const [id, a] of peers.entries()) {
    const pos = a.group.position;
    if ((a as unknown as { body: THREE.Mesh }).body.rotation.x > 1 && pos.distanceTo(p) < (profile.skills.includes('field-medic') ? 4 : 2.5)) {
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
    else if (it.type === 'collectible' && !st.collected && (!it.hidden || world.phaseSight)) {
      best = { kind: 'pickup', id: it.id, label: `<b>E</b> — take the ${esc(it.grants)}` }; bestD = d;
    } else if (it.type === 'socket' && !st.filled && profile.inventory.includes(it.accepts)) {
      best = { kind: 'socket', id: it.id, label: `<b>E</b> — slot the ${esc(it.accepts)}` }; bestD = d;
    }
  }
  return best;
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

  controller.frozen = selfDowned || hud.panelOpen || document.pointerLockElement !== renderer.canvas;
  controller.update(dt);

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
    const tp = enemies.positionOf(rig.tractorTarget) ?? world?.interactableAt(rig.tractorTarget)?.position;
    if (tp) rig.tracer(origin, [tp.x, tp.y, tp.z], DEVICES.tractor.color, 0.03, 120);
  }

  // world + entities
  world?.update(dt);
  peers.update(dt);
  enemies.update(dt);
  rig.update();

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
