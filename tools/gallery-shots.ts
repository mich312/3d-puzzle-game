// Screenshots of the model gallery (tools/gallery.html) in headless chromium.
// Usage: npx vite --port 8103 --strictPort &   then
//        GALLERY_URL=http://127.0.0.1:8103 npx tsx tools/gallery-shots.ts <outDir> [view ...]
// views: avatar, avatar-close, devices, enemy:<type> (drifter warden sower mimic colossus); default all.
// Env: QUALITY=low|medium|high (model tier), SIM_T=<seconds simulated before capture>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.GALLERY_URL ?? 'http://127.0.0.1:8103';
const OUT = process.argv[2] ?? 'gallery-shots';
const ALL = ['avatar', 'devices', 'enemy:drifter', 'enemy:warden', 'enemy:sower', 'enemy:mimic', 'enemy:colossus'];
const views = process.argv.slice(3).length ? process.argv.slice(3) : ALL;
const Q = process.env.QUALITY ?? 'high';
const T = process.env.SIM_T;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.text().slice(0, 400)); });
  for (const v of views) {
    const [view, type] = v.split(':');
    const url = `${BASE}/tools/gallery.html?still=1&view=${view === 'avatar-close' ? 'avatar&close=1' : view === 'devices-side' ? 'devices&side=1' : view}&q=${Q}${type ? `&type=${type}` : ''}${T ? `&t=${T}` : ''}`;
    await page.goto(url);
    await page.waitForFunction(() => (window as unknown as { __galleryReady?: boolean }).__galleryReady, null, { timeout: 180000, polling: 250 });
    const file = join(OUT, `${v.replace(':', '-')}${Q !== 'high' ? '-' + Q : ''}.png`);
    await page.screenshot({ path: file });
    console.log('saved', file);
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
