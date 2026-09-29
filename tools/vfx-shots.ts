// Dev-only: screenshots effects from tools/vfx-preview.html (needs `npx vite --port N`).
// Usage: BASE_URL=http://127.0.0.1:N tsx tools/vfx-shots.ts <outDir> name:t[:world] ...
// SHEET=name.png also writes a contact sheet of all shots (2 columns).
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8104';
const OUT = process.argv[2];
const list = process.argv.slice(3); // name:t[:world]
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  await ctx.addInitScript((q) => localStorage.setItem('t-quality', q), process.env.QUALITY ?? 'high');
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.text().slice(0, 600)); });
  let curWorld = '';
  const files: string[] = [];
  for (const item of list) {
    const [name, t, world = 'atrium'] = item.split(':');
    if (world !== curWorld) {
      await page.goto(`${BASE}/tools/vfx-preview.html?world=${world}`);
      await page.waitForFunction(() => !!(window as any).__vfx, null, { timeout: 180000 });
      curWorld = world;
    }
    await page.evaluate(([n, tt]) => (window as any).__vfx.run(n, Number(tt)), [name, t]);
    const f = `${OUT}/${name}-${t}-${world}.png`;
    await page.screenshot({ path: f });
    files.push(f);
    console.log('saved', name, t, world);
  }
  if (process.env.SHEET) {
    const imgs = files.map((f) => `<figure><img src="data:image/png;base64,${readFileSync(f).toString('base64')}"><figcaption>${f.split('/').pop()}</figcaption></figure>`).join('');
    const sheet = await ctx.newPage();
    await sheet.setViewportSize({ width: 960, height: 300 });
    await sheet.setContent(`<style>body{margin:0;background:#000;display:grid;grid-template-columns:1fr 1fr;gap:2px}figure{margin:0;position:relative}img{width:100%;display:block}figcaption{position:absolute;left:4px;top:2px;color:#fff;font:12px sans-serif;text-shadow:0 0 3px #000}</style>${imgs}`);
    await sheet.screenshot({ path: `${OUT}/${process.env.SHEET}`, fullPage: true });
  }
  await browser.close();
})();
