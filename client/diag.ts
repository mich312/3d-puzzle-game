// On-screen diagnostics. WebGPU can't be tested in the build sandbox, so when it's
// active we surface captured errors + backend info directly in the page — the player
// can screenshot it instead of digging in the console.
export const BUILD = 'wgpu-lightfix-2';

const buffer: string[] = [];
let overlay: HTMLElement | null = null;
let header = '';

function render() {
  if (!overlay) return;
  overlay.textContent = `THRESHOLD build ${BUILD}\n${header}\n${buffer.length ? buffer.join('\n') : '(no errors captured)'}`;
}

export function diagLog(msg: string) {
  buffer.push(msg);
  while (buffer.length > 14) buffer.shift();
  render();
}

export function installDiag() {
  const orig = console.error.bind(console);
  console.error = (...a: unknown[]) => { diagLog('ERR ' + a.map((x) => String(x)).join(' ').slice(0, 300)); orig(...a); };
  const warn = console.warn.bind(console);
  console.warn = (...a: unknown[]) => { const s = a.map((x) => String(x)).join(' '); if (/webgpu|gpu|shader|pipeline|bind|light|node/i.test(s)) diagLog('WARN ' + s.slice(0, 300)); warn(...a); };
  addEventListener('error', (e) => diagLog('WINDOW ' + (e.message || String(e.error)).slice(0, 300)));
  addEventListener('unhandledrejection', (e) => diagLog('REJECT ' + String(e.reason).slice(0, 300)));
}

/** show the panel with a header line (call when the WebGPU backend is active) */
export function showDiag(headerLine: string) {
  header = headerLine;
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;left:8px;bottom:8px;max-width:560px;max-height:44vh;overflow:auto;'
      + 'background:rgba(10,8,20,0.88);color:#d8d0f0;font:11px/1.4 monospace;padding:9px 11px;'
      + 'border:1px solid #6ec6ff;border-radius:6px;z-index:99999;white-space:pre-wrap;pointer-events:none';
    document.body.appendChild(overlay);
  }
  render();
}
