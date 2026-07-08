// WebGPU capability detection. Runtime feature-detect — the game never needs to
// know the host hardware in advance. Reported in the settings menu so a player can
// see whether their machine exposes WebGPU. (The renderer itself is WebGL2 today;
// a WebGPURenderer path is a separate port — see SPEC-CHANGES / renderer.ts.)
export interface GpuInfo {
  webgpu: boolean;
  adapter?: string;
  reason?: string;
}

export async function detectWebGPU(): Promise<GpuInfo> {
  const nav = navigator as Navigator & { gpu?: { requestAdapter(opts?: unknown): Promise<unknown> } };
  if (!nav.gpu) return { webgpu: false, reason: 'navigator.gpu not present (browser/OS lacks WebGPU)' };
  try {
    const adapter = await nav.gpu.requestAdapter() as null | {
      info?: { vendor?: string; architecture?: string; description?: string };
      requestAdapterInfo?: () => Promise<{ vendor?: string; architecture?: string; description?: string }>;
    };
    if (!adapter) return { webgpu: false, reason: 'no GPU adapter (disabled or blocklisted)' };
    let desc = 'available';
    try {
      const info = adapter.info ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : undefined);
      if (info) {
        const parts = [info.vendor, info.architecture, info.description].filter(Boolean);
        if (parts.length) desc = parts.join(' ');
      }
    } catch { /* adapter info is best-effort */ }
    return { webgpu: true, adapter: desc };
  } catch (e) {
    return { webgpu: false, reason: String(e) };
  }
}
