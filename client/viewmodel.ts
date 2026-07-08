// First-person viewmodel: the held device, with idle sway, movement bob,
// fire kick, and per-device accent glow. Pure client cosmetics.
import * as THREE from 'three';
import { DEVICES, type DeviceId } from '../shared/devices';

export class Viewmodel {
  group = new THREE.Group();
  private body: THREE.Mesh;
  private emitterTip: THREE.Mesh;
  private ring: THREE.Mesh;
  private glow: THREE.PointLight;
  private kickT = 0;
  private swapT = 0;
  private time = 0;
  private device: DeviceId = 'pulse';

  constructor(camera: THREE.Camera) {
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.1, 0.16),
      new THREE.MeshStandardMaterial({ color: '#2c2840', roughness: 0.6, metalness: 0.4 }));
    grip.position.set(0, -0.05, 0.05);
    this.body = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.07, 0.3),
      new THREE.MeshStandardMaterial({ color: '#8c87a8', roughness: 0.35, metalness: 0.8 }));
    this.emitterTip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.04, 0.09, 10),
      new THREE.MeshStandardMaterial({ color: '#ffd98a', emissive: '#ffd98a', emissiveIntensity: 0.9 }));
    this.emitterTip.rotation.x = Math.PI / 2;
    this.emitterTip.position.z = -0.18;
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.052, 0.012, 8, 20),
      new THREE.MeshStandardMaterial({ color: '#ffd98a', emissive: '#ffd98a', emissiveIntensity: 1.5 }));
    this.ring.position.z = -0.1;
    this.glow = new THREE.PointLight('#ffd98a', 0.5, 1.2);
    this.glow.position.z = -0.2;
    this.group.add(grip, this.body, this.emitterTip, this.ring, this.glow);
    this.group.position.set(0.32, -0.28, -0.62);
    this.group.rotation.y = 0.08;
    camera.add(this.group);
  }

  setDevice(d: DeviceId) {
    if (d === this.device) return;
    this.device = d;
    this.swapT = 1;
    const color = new THREE.Color(DEVICES[d].color);
    for (const m of [this.emitterTip, this.ring]) {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.color.copy(color);
      mat.emissive.copy(color);
    }
    this.glow.color.copy(color);
  }

  kick() { this.kickT = 1; }

  /** world-space muzzle position for tracer starts */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    this.emitterTip.getWorldPosition(out);
    return out;
  }

  update(dt: number, moving: boolean, grounded: boolean) {
    this.time += dt;
    this.kickT = Math.max(0, this.kickT - dt * 6);
    this.swapT = Math.max(0, this.swapT - dt * 4);
    const bob = moving && grounded ? Math.sin(this.time * 9) * 0.012 : Math.sin(this.time * 1.8) * 0.004;
    const kick = this.kickT * this.kickT;
    this.group.position.set(
      0.32 + Math.cos(this.time * 4.5) * 0.002,
      -0.28 + bob - this.swapT * 0.25,
      -0.62 + kick * 0.09);
    this.group.rotation.x = kick * 0.22 - this.swapT * 0.6;
    (this.ring.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.8 + Math.sin(this.time * 3) * 0.25 + kick * 2;
    this.glow.intensity = 0.35 + kick * 1.4;
  }
}
