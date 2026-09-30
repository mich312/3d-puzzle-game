// WebSocket client: hello/reconnect handshake, typed send, message fan-out.
import type { ClientMsg, ServerMsg } from '../shared/messages';

type Handler = (msg: ServerMsg) => void;
/** connecting: first attempt · online · reconnecting: lost, retrying with backoff ·
    replaced: this profile was taken over by another tab/device — no auto-retry */
export type NetStatus = 'connecting' | 'online' | 'reconnecting' | 'replaced';
/** server close code when a newer connection takes over this profile's session */
const CLOSE_REPLACED = 4001;

// Only profile-level messages survive a disconnect. In-world actions (fire, interact,
// grab, tractor, reset...) are positional and instance-scoped — replaying them on
// reconnect would act on stale positions, possibly in a different instance.
const QUEUEABLE = new Set<ClientMsg['t']>(['set_name', 'set_opts', 'equip', 'unlock_skill', 'respec', 'chat']);
const MAX_QUEUE = 32;

export class Net {
  private ws?: WebSocket;
  private handlers: Handler[] = [];
  private queue: ClientMsg[] = [];
  private reconnectDelay = 1000;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private statusHandlers: ((s: NetStatus) => void)[] = [];
  status: NetStatus = 'connecting';
  connected = false;

  onMessage(h: Handler) { this.handlers.push(h); }
  onStatus(h: (s: NetStatus) => void) { this.statusHandlers.push(h); h(this.status); }
  private setStatus(s: NetStatus) {
    if (s === this.status) return;
    this.status = s;
    for (const h of this.statusHandlers) h(s);
  }

  /** reconnect after being replaced (the user chose to play in this tab) or retry now */
  takeOver() {
    clearTimeout(this.retryTimer);
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.reconnectDelay = 1000;
    this.setStatus('connecting');
    this.connect();
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectDelay = 1000;
      this.setStatus('online');
      const target = new URLSearchParams(location.search).get('join') ?? undefined;
      this.sendNow({
        t: 'hello', v: 1,
        token: localStorage.getItem('threshold-token') ?? undefined,
        name: localStorage.getItem('threshold-name') ?? undefined,
        target,
      });
      for (const m of this.queue.splice(0)) this.sendNow(m);
    };
    this.ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'welcome') localStorage.setItem('threshold-token', msg.token);
      for (const h of this.handlers) h(msg);
    };
    this.ws.onclose = (ev) => {
      this.connected = false;
      // replaced by another tab: reconnecting would kick THAT tab, which would then
      // kick this one again — two tabs evicting each other every second
      if (ev.code === CLOSE_REPLACED) { this.queue.length = 0; this.setStatus('replaced'); return; }
      this.setStatus('reconnecting');
      this.retryTimer = setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(10_000, this.reconnectDelay * 1.6);
    };
    this.ws.onerror = () => this.ws?.close();
  }

  send(msg: ClientMsg) {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) this.sendNow(msg);
    else if (QUEUEABLE.has(msg.t) && this.queue.length < MAX_QUEUE) this.queue.push(msg);
  }
  private sendNow(msg: ClientMsg) { this.ws!.send(JSON.stringify(msg)); }
}
