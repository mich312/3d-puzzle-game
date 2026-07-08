// Shared renderer contract so the WebGL2 and WebGPU backends are interchangeable.
// main.ts holds an IRenderer; a factory (create.ts) picks the backend at boot.
import * as THREE from 'three';
import type { DynamicLights } from './lights';
import type { QualitySpec, QualityTier } from './quality';

export interface HeroFloor { y: number; size: number; tint: string; shape: 'circle' | 'plane' }

export interface IRenderer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  readonly lights: DynamicLights;
  q: QualitySpec;
  readonly quality: QualityTier;
  reduceMotion: boolean;
  /** 'webgl2' | 'webgpu' — which backend is actually rendering */
  readonly backend: 'webgl2' | 'webgpu';
  setQuality(tier: QualityTier): void;
  setWorld(world: string, hero?: HeroFloor): void;
  setFog(color?: string, density?: number): void;
  followShadow(target: THREE.Vector3): void;
  tick(dt: number, cameraPos: THREE.Vector3): void;
  render(): void;
  rendererInfo(): { api: string; gpu: string };
}
