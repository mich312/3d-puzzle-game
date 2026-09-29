// Standalone model gallery (dev only): renders the avatar, every enemy archetype and
// each first-person device without a server, under the game's lighting look
// (PMREM RoomEnvironment IBL + key light + ACES + threshold bloom). Views:
//   ?view=avatar            idle / walk / run / jump / downed / carry + echo hologram (&close=1 zooms)
//   ?view=enemy&type=drifter idle / telegraph / frozen / dying (any archetype)
//   ?view=devices           the four viewmodel devices in a 2x2 grid
// Optional: &q=low|medium|high (model tier), &t=<seconds simulated> (default 2.2)
// Sets window.__galleryReady once the frame is rendered (tools/gallery-shots.ts).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildAvatar, AvatarAnimator, type LocoInput } from '../client/models/avatar';
import { setModelQuality, holoMat, type ModelTier } from '../client/models/common';
import type { EnemyAnim } from '../client/models/enemies';
import type { DeviceId } from '../shared/devices';

const qs = new URLSearchParams(location.search);
const view = qs.get('view') ?? 'avatar';
const SIM_T = Number(qs.get('t') ?? 2.2);
setModelQuality((qs.get('q') as ModelTier) ?? 'high');

const W = innerWidth, H = innerHeight;
const gl = new THREE.WebGLRenderer({ antialias: true });
gl.setSize(W, H);
gl.setPixelRatio(1);
gl.shadowMap.enabled = true;
gl.shadowMap.type = THREE.PCFSoftShadowMap;
gl.toneMapping = THREE.ACESFilmicToneMapping;
gl.toneMappingExposure = 1.0;
document.body.appendChild(gl.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1b1934');
const pmrem = new THREE.PMREMGenerator(gl);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
scene.add(new THREE.HemisphereLight('#7a6aa8', '#2a2540', 0.5));
const key = new THREE.DirectionalLight('#e6dcff', 1.5);
key.position.set(6, 10, 5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 40 });
key.shadow.bias = -0.0004;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight('#8fb8ff', 0.9);
rim.position.set(-6, 4, -8);
scene.add(rim);

const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 64),
  new THREE.MeshStandardMaterial({ color: '#4a4660', roughness: 0.8, metalness: 0.05 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;

const camera = new THREE.PerspectiveCamera(35, W / H, 0.05, 200);
const label = document.getElementById('label')!;
const tick: ((dt: number, t: number) => void)[] = [];
let customRender: (() => void) | null = null;

// ---------------- avatar ----------------
function avatarView() {
  scene.add(ground);
  const accents = ['#6ec6ff', '#ff9ecb', '#a8f0c6', '#ffd98a', '#c9a8ff', '#ff8a7a'];
  const poses: [string, Partial<LocoInput> & { vz?: number; vy?: number; air?: boolean; rot?: number }][] = [
    ['idle', {}],
    ['walk', { vz: -1.8 }],
    ['run', { vz: -6 }],
    ['jump', { vz: -3, air: true, vy: 3 }],
    ['downed', { downed: true }],
    ['carry', { carrying: true, vz: -1.2 }],
  ];
  const spacing = 1.2;
  poses.forEach(([name, p], i) => {
    const rig = buildAvatar(accents[i]);
    rig.setDevice(i === 2 || i === 0 ? 'pulse' : i === 3 ? 'freeze' : undefined);
    const g = new THREE.Group();
    g.position.set((i - (poses.length - 1) / 2) * spacing, 0, 0);
    g.rotation.y = p.rot ?? Math.PI - 0.6;
    g.add(rig.root);
    scene.add(g);
    const anim = new AvatarAnimator(rig);
    const vel = new THREE.Vector3(0, p.vy ?? 0, p.vz ?? 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, g.rotation.y);
    tick.push((dt) => {
      anim.update(dt, g.rotation.y, {
        vel, grounded: !p.air, pitch: name === 'idle' ? 0.25 : 0, downed: !!p.downed,
        carrying: !!p.carrying, holding: i === 0 || i === 2 || i === 3,
      });
    });
  });
  // echo hologram
  const time = { value: 0 };
  const holo = buildAvatar('#6ec6ff', { override: holoMat('#6ec6ff', time) });
  const hg = new THREE.Group();
  hg.position.set(((poses.length) - (poses.length - 1) / 2) * spacing, 0, 0);
  hg.rotation.y = Math.PI - 0.6;
  hg.add(holo.root);
  scene.add(hg);
  const ha = new AvatarAnimator(holo);
  tick.push((dt, t) => { time.value = t; ha.update(dt, hg.rotation.y, { vel: new THREE.Vector3(), grounded: true, pitch: 0, downed: false }); });
  camera.position.set(0.6, 1.5, 8.4);
  camera.lookAt(0.6, 0.85, 0);
  if (qs.has('close')) { camera.position.set(-2.4, 1.35, 2.5); camera.lookAt(-2.4, 1.0, 0); }
  label.textContent = 'idle · walk · run · jump · downed · carry · echo';
}

// ---------------- enemies ----------------
async function enemyView() {
  const { EnemyModel } = await import('../client/models/enemies');
  scene.add(ground);
  const type = qs.get('type') ?? 'drifter';
  const cols: [string, EnemyAnim][] = [
    ['idle', { state: 'idle', speed: 0 }],
    ['chase', { state: 'chase', speed: 2 }],
    ['telegraph', { state: 'telegraph', speed: 0, telegraph: 0.6 }],
    ['frozen', { state: 'frozen', speed: 0 }],
    ['dying', { state: 'down', speed: 0 }],
  ];
  if (type === 'mimic') cols[0] = ['disguised', { state: 'idle', speed: 0, disguised: true }];
  if (type === 'colossus') cols[3] = ['exposed', { state: 'chase', speed: 0, exposed: true }];
  const big = type === 'colossus';
  const spacing = big ? 3.4 : type === 'warden' ? 2.3 : 1.9;
  cols.forEach(([name, st], i) => {
    const m = new EnemyModel(type);
    m.group.position.set((i - (cols.length - 1) / 2) * spacing, 0, 0);
    m.group.rotation.y = 0.45;   // server yaw convention: yaw 0 faces +Z (toward camera)
    scene.add(m.group);
    let tt = 0;
    tick.push((dt) => {
      tt += dt;
      const s = { ...st };
      // dying: be mid-dissolve at capture time
      if (name === 'dying' && tt < SIM_T - 0.75) s.state = 'chase';
      if (name === 'telegraph' && tt < SIM_T - 0.6) s.state = 'chase';
      if (name === 'telegraph') s.telegraph = tt >= SIM_T - 0.6 ? 1 : 0;
      m.update(dt, tt, s);
    });
  });
  const h = big ? 3.6 : 2;
  camera.position.set(0, h * 0.7, spacing * cols.length * 1.12);
  camera.lookAt(0, h * 0.45, 0);
  label.textContent = `${type}: ${cols.map((c) => c[0]).join(' · ')}`;
}

// ---------------- devices ----------------
async function devicesView() {
  const { Viewmodel } = await import('../client/viewmodel');
  const devices: DeviceId[] = ['pulse', 'freeze', 'tractor', 'portalgun'];
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshStandardMaterial({ color: '#35324c', roughness: 0.9 }));
  wall.position.set(0, 0, -3);
  scene.add(wall);
  scene.add(ground); ground.position.y = -1.6;
  const cams: THREE.PerspectiveCamera[] = [];
  const vms: InstanceType<typeof Viewmodel>[] = [];
  devices.forEach((d, i) => {
    const cam = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
    cam.position.set(i * 50, 0, 0);    // far apart so only its own viewmodel shows
    scene.add(cam);
    const vm = new Viewmodel(cam);
    vm.setDevice(d);
    vm.setAccent('#6ec6ff');
    cams.push(cam); vms.push(vm);
    const wl = wall.clone(); wl.position.x = i * 50; scene.add(wl);
    const k2 = key.clone(); k2.position.set(i * 50 + 3, 5, 4); k2.target.position.set(i * 50, 0, -2); k2.castShadow = false;
    scene.add(k2, k2.target);
  });
  tick.push((dt, t) => {
    vms.forEach((vm, i) => {
      const charge = i === 0 ? Math.min(1, Math.max(0, (t - 1.2) / 0.8)) : 0;
      vm.update(dt, false, true, { charge, tractor: i === 2 && t > 1, portalSlot: i === 3 ? 1 : undefined });
    });
  });
  customRender = () => {
    gl.setScissorTest(true);
    const hw = W / 2, hh = H / 2;
    cams.forEach((cam, i) => {
      const x = (i % 2) * hw, y = (1 - Math.floor(i / 2)) * hh;
      cam.aspect = hw / hh; cam.updateProjectionMatrix();
      gl.setViewport(x, y, hw, hh); gl.setScissor(x, y, hw, hh);
      if (qs.has('side')) {
        // observer looking at the held device from the left side (layout debugging)
        const obs = new THREE.PerspectiveCamera(30, hw / hh, 0.01, 50);
        cam.updateMatrixWorld(true);
        const at = new THREE.Vector3(0.2, -0.2, -0.55).applyMatrix4(cam.matrixWorld);
        obs.position.copy(at).add(new THREE.Vector3(-1.1, 0.25, 0.1));
        obs.lookAt(at);
        gl.render(scene, obs);
      } else gl.render(scene, cam);
    });
    gl.setScissorTest(false);
  };
  label.textContent = 'Kinetic Pulse (charging) · Freeze Ray\nTractor Beam (active) · Portal Device';
}

if (view === 'enemy') await enemyView();
else if (view === 'devices') await devicesView();
else avatarView();

const composer = new EffectComposer(gl);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.55, 0.45, 1.0));
composer.addPass(new OutputPass());

// deterministic simulation to SIM_T, then render (and keep animating for live viewing)
const STEP = 1 / 60;
let simT = 0;
for (; simT < SIM_T; simT += STEP) for (const f of tick) f(STEP, simT);
function frame() {
  if (customRender) customRender(); else composer.render();
}
frame();
requestAnimationFrame(() => { frame(); (window as unknown as { __galleryReady: boolean }).__galleryReady = true; });
if (!qs.has('still')) {
  let last = performance.now();
  const loop = () => {
    requestAnimationFrame(loop);
    if (!(window as unknown as { __galleryReady: boolean }).__galleryReady) return;
    const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
    simT += dt;
    for (const f of tick) f(dt, simT);
    frame();
  };
  requestAnimationFrame(loop);
}
