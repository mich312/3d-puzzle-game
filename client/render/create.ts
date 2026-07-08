// Renderer factory: picks the backend at boot from the saved preference, with
// automatic fallback to the tested WebGL2 path if WebGPU is unavailable or fails.
// The WebGPU module is dynamically imported so WebGL2 users don't bundle it.
import { Renderer } from './renderer';
import { autoQuality } from './quality';
import { detectWebGPU } from './gpu';
import type { IRenderer } from './api';

export type RendererPref = 'webgl2' | 'webgpu';

export interface RendererResult {
  renderer: IRenderer;
  fallback?: string;   // set when WebGPU was requested but we fell back to WebGL2
}

export async function createRenderer(container: HTMLElement, pref: RendererPref): Promise<RendererResult> {
  if (pref === 'webgpu') {
    const info = await detectWebGPU();
    if (!info.webgpu) {
      return { renderer: new Renderer(container), fallback: `WebGPU unavailable (${info.reason}) — using WebGL2` };
    }
    try {
      const { WebGPURendererImpl } = await import('./webgpu');
      // pick a quality tier the same way the WebGL renderer does, from a throwaway GL probe
      const probe = document.createElement('canvas').getContext('webgl2');
      const tier = probe ? autoQuality(probe) : 'medium';
      const renderer = await WebGPURendererImpl.create(container, tier);
      return { renderer };
    } catch (e) {
      // any WebGPU init/render-graph failure must never brick the game
      console.error('[gpu] WebGPU renderer failed, falling back to WebGL2:', e);
      // the failed attempt may have appended a canvas; clear the container
      container.querySelectorAll('canvas').forEach((c) => c.remove());
      return { renderer: new Renderer(container), fallback: `WebGPU init failed — using WebGL2` };
    }
  }
  return { renderer: new Renderer(container) };
}
