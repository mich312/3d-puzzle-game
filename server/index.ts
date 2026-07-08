// THRESHOLD server entry: static client + WebSocket endpoint + health/telemetry.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { loadContent, watchContent } from './content';
import { openStore } from './persistence';
import { GameServer, type ClientLink } from './instances';
import type { ClientMsg, ServerMsg } from '../shared/messages';

const PORT = Number(process.env.PORT ?? 80);
const CLIENT_DIR = join(import.meta.dirname, '..', 'dist', 'client');
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
};

loadContent();
const store = openStore();
const game = new GameServer(store);
watchContent(() => console.log('[content] reloaded'));

const http = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  if (url === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      players: game.sessions.size,
      lobbies: game.lobbies.length,
      levelInstances: game.levels.size,
    }));
    return;
  }
  if (url === '/api/telemetry') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(store.telemetrySummary()));
    return;
  }
  // static client (production build)
  let path = normalize(join(CLIENT_DIR, url === '/' ? 'index.html' : url));
  if (!path.startsWith(CLIENT_DIR)) { res.writeHead(403); res.end(); return; }
  if (!existsSync(path) || statSync(path).isDirectory()) path = join(CLIENT_DIR, 'index.html');
  if (!existsSync(path)) {
    res.writeHead(503, { 'content-type': 'text/plain' });
    res.end('Client not built. Run `npm run build`, or use `npm run dev` for development.');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
  res.end(readFileSync(path));
});

const wss = new WebSocketServer({ server: http, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  let session: ReturnType<GameServer['connect']> | null = null;
  const link: ClientLink = {
    send(msg: ServerMsg) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  };
  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (!msg || msg.v !== 1) { link.send({ t: 'error', v: 1, code: 'bad_version', message: 'protocol mismatch — refresh the page' }); return; }
    try {
      if (msg.t === 'hello') {
        session = game.connect(link, msg.token, msg.name);
        game.welcome(session);
        game.place(session, msg.target);
        return;
      }
      if (session) game.handle(session, msg);
    } catch (e) {
      console.error('[dispatch]', (e as Error).stack);
    }
  });
  ws.on('close', () => { if (session) game.disconnect(session); });
  ws.on('error', () => { /* handled by close */ });
});

http.listen(PORT, () => {
  console.log(`THRESHOLD server on http://localhost:${PORT} (ws: /ws)`);
});

process.on('SIGTERM', () => { game.stop(); http.close(); process.exit(0); });
process.on('SIGINT', () => { game.stop(); http.close(); process.exit(0); });
