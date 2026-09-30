// THRESHOLD server entry: static client + WebSocket endpoint + health/telemetry.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { loadContent, watchContent } from './content';
import { openStore } from './persistence';
import { GameServer, type ClientLink } from './instances';
import type { ServerMsg } from '../shared/messages';
import { validateClientMsg } from '../shared/validate';

const PORT = Number(process.env.PORT ?? 80);
const CLIENT_DIR = join(import.meta.dirname, '..', 'dist', 'client');
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
};

loadContent();
const store = openStore(process.env.THRESHOLD_DATA_DIR || undefined);
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

// 16 KiB is ~10x the largest legitimate client message (an 84-point echo path)
const MAX_PAYLOAD = 16 * 1024;
// per-socket token bucket: the client streams ~15 moves/s + ~10 tractor/s plus
// bursts of input; anything far beyond that is dropped, sustained abuse closes
const MSG_RATE = 60;          // tokens per second
const MSG_BURST = 120;
const MAX_DROPS = 600;        // dropped messages before the socket is closed

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_PAYLOAD });

wss.on('connection', (ws: WebSocket) => {
  let session: ReturnType<GameServer['connect']> | null = null;
  let helloSeen = false;
  let tokens = MSG_BURST;
  let lastRefill = Date.now();
  let drops = 0;
  const link: ClientLink = {
    send(msg: ServerMsg) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
    close(code = 4000, reason = 'replaced') {
      try { ws.close(code, reason); } catch { /* already closing */ }
    },
  };
  ws.on('message', (raw) => {
    const now = Date.now();
    tokens = Math.min(MSG_BURST, tokens + ((now - lastRefill) / 1000) * MSG_RATE);
    lastRefill = now;
    if (tokens < 1) {
      if (++drops === MAX_DROPS + 1) { console.warn('[ws] closing flooding socket'); ws.close(1008, 'rate limit'); }
      return;
    }
    tokens -= 1;
    let msg: unknown;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (!msg || typeof msg !== 'object' || (msg as { v?: unknown }).v !== 1) {
      link.send({ t: 'error', v: 1, code: 'bad_version', message: 'protocol mismatch — refresh the page' });
      return;
    }
    if (!validateClientMsg(msg)) return;          // malformed / unknown message: drop silently
    try {
      if (msg.t === 'hello') {
        if (helloSeen) return;                    // one session per socket — a second hello would leak a ghost
        helloSeen = true;
        session = game.connect(link, msg.token, msg.name);
        game.welcome(session);
        game.place(session, msg.target);
        return;
      }
      // a socket whose token was taken over by a newer connection no longer drives the session
      if (session && session.link === link) game.handle(session, msg);
    } catch (e) {
      console.error('[dispatch]', (e as Error).stack);
    }
  });
  ws.on('close', () => { if (session) game.disconnectLink(session, link); });
  ws.on('error', () => { /* handled by close */ });
});

http.listen(PORT, () => {
  console.log(`THRESHOLD server on http://localhost:${PORT} (ws: /ws)`);
});

process.on('SIGTERM', () => { game.stop(); http.close(); process.exit(0); });
process.on('SIGINT', () => { game.stop(); http.close(); process.exit(0); });
