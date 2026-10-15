// THE COMPUTER NOTICES A DEAD RELAY LINK AND RECONNECTS (2026-10-13).
//
// Reported from a phone: "quite often when I click a notification it brings me
// to a page that says [the computer] isn't connected … but if I then open the
// app from my phone, it works fine", and, sending a reply with pictures, "it
// says your computer did not answer in time so I'm just stuck here".
//
// Measured in the code: the computer's socket to the relay (main/relay-client.mjs)
// sent nothing while nobody was asking, and had no way to learn that the link
// had died under it. A laptop that slept, or changed networks, kept a socket it
// believed open while the relay had dropped it ("not connected"), or the relay
// kept one the laptop had lost and sent requests into it until the 30 s timer
// ("did not answer in time"). Nothing reconnected until the operating system
// gave up on the dead connection, which can take many minutes.
//
// Now the computer says "ping" on a timer and the relay answers "pong" without
// waking the room (Cloudflare's auto-response). A link that stops answering is
// replaced at once, and so is one whose timer fired far too late, which is what
// a laptop waking from sleep looks like. A relay too old to answer is never
// taken for a dead one. And a room woken with two sockets from one computer
// keeps the newest, not whichever the platform lists last.
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { createRelayClient, PING_MS, PONG_GRACE_MS } from '../main/relay-client.mjs';
import { buildRelay } from '../relay/build.mjs';
import { relayIds, FROM_MAC, ID_BYTES } from '../shared/relay-crypto.mjs';

const KEY = 'a-key-of-at-least-24-chars!!';

/** Sockets the client opens, which open at once and answer pings if told to. */
function sockets({ answers = true } = {}) {
  const made = [];
  class Sock {
    constructor(url) {
      this.url = url;
      this.sent = [];
      this.closed = false;
      this.answers = answers;
      made.push(this);
      queueMicrotask(() => this.onopen?.());
    }
    send(data) {
      this.sent.push(data);
      if (data === 'ping' && this.answers && !this.closed) queueMicrotask(() => this.onmessage?.({ data: 'pong' }));
    }
    close() { if (this.closed) return; this.closed = true; this.onclose?.({ code: 1000 }); }
  }
  return { Sock, made };
}

// The keys are made with WebCrypto, which settles on the real event loop, so
// the fake clock leaves setImmediate alone and this waits on it.
const flush = async () => { for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r)); };

describe('the computer keeps its link to the relay alive', () => {
  let client;
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] }); vi.setSystemTime(new Date('2026-10-13T12:00:00Z')); });
  afterEach(() => { client?.stop(); vi.useRealTimers(); });

  async function start(opts) {
    const { Sock, made } = sockets(opts);
    client = createRelayClient({ relayUrl: 'https://relay.test', key: () => KEY, port: () => 1, WebSocketImpl: Sock, log: { warn() {}, info() {} } });
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(client.state().connected).toBe(true);
    return made;
  }

  it('says ping on a timer while connected', async () => {
    const made = await start();
    expect(made[0].sent.filter((m) => m === 'ping')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(PING_MS);
    expect(made[0].sent.filter((m) => m === 'ping')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(PING_MS * 3);
    expect(made[0].sent.filter((m) => m === 'ping')).toHaveLength(4);
  });

  it('a relay that answers keeps the same link for as long as it answers', async () => {
    const made = await start();
    await vi.advanceTimersByTimeAsync(PING_MS * 20);
    expect(made).toHaveLength(1);
    expect(made[0].closed).toBe(false);
  });

  it('a relay that stops answering is replaced, within two pings of going quiet', async () => {
    const made = await start();
    await vi.advanceTimersByTimeAsync(PING_MS * 2);
    made[0].answers = false;
    await vi.advanceTimersByTimeAsync(PING_MS * 2 + PONG_GRACE_MS);
    await flush();
    expect(made[0].closed).toBe(true);
    expect(made.length).toBeGreaterThanOrEqual(2);
    expect(client.state().connected).toBe(true);
  });

  it('one late pong is not a dead link', async () => {
    const made = await start();
    await vi.advanceTimersByTimeAsync(PING_MS * 2);
    made[0].answers = false;
    await vi.advanceTimersByTimeAsync(PING_MS);
    made[0].answers = true;
    made[0].onmessage?.({ data: 'pong' });
    await vi.advanceTimersByTimeAsync(PING_MS * 5);
    expect(made).toHaveLength(1);
  });

  it('a relay too old to answer pings is never taken for a dead one', async () => {
    const made = await start({ answers: false });
    await vi.advanceTimersByTimeAsync(PING_MS * 20);
    expect(made).toHaveLength(1);
    expect(made[0].closed).toBe(false);
  });

  it('a timer that fires far too late, as after sleep, reconnects at once', async () => {
    const made = await start({ answers: false });
    // The laptop slept for ten minutes: the clock moved and no timer ran.
    vi.setSystemTime(Date.now() + 10 * 60_000);
    await vi.advanceTimersByTimeAsync(PING_MS);
    await flush();
    expect(made[0].closed).toBe(true);
    expect(made).toHaveLength(2);
    expect(client.state().connected).toBe(true);
  });

  it('a timer only a little late is not sleep', async () => {
    const made = await start({ answers: false });
    vi.setSystemTime(Date.now() + PING_MS / 2);
    await vi.advanceTimersByTimeAsync(PING_MS);
    expect(made).toHaveLength(1);
  });

  it('stops pinging once stopped', async () => {
    const made = await start();
    client.stop();
    const before = made[0].sent.length;
    await vi.advanceTimersByTimeAsync(PING_MS * 3);
    expect(made[0].sent.length).toBe(before);
  });
});

describe('the relay\'s room', () => {
  let RelayRoom;
  let room;
  beforeAll(async () => {
    await buildRelay();
    const { build } = await import('esbuild');
    const out = await build({ entryPoints: [new URL('../relay/worker.mjs', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'neutral', write: false });
    ({ RelayRoom } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`));
    ({ room } = await relayIds(KEY));
  });

  class Pair { constructor(request, response) { this.request = request; this.response = response; } }
  beforeEach(() => { globalThis.WebSocketRequestResponsePair = Pair; });
  afterEach(() => { delete globalThis.WebSocketRequestResponsePair; });

  const sock = (at) => ({ at, closed: null, send() {}, close(code) { this.closed = code; }, deserializeAttachment: () => ({ at }) });

  it('answers ping with pong without waking', () => {
    let auto = null;
    new RelayRoom({ getWebSockets: () => [], acceptWebSocket() {}, setWebSocketAutoResponse: (p) => { auto = p; } });
    expect(auto).toEqual(new Pair('ping', 'pong'));
  });

  it('woken with two sockets from one computer, keeps the newest and lets the older go', () => {
    const older = sock(1000);
    const newer = sock(2000);
    const r = new RelayRoom({ getWebSockets: () => [newer, older], acceptWebSocket() {}, setWebSocketAutoResponse() {} });
    expect(r.room.mac).toBe(newer);
    expect(older.closed).toBe(4000);
    expect(newer.closed).toBe(null);
  });

  it('woken with one socket keeps it', () => {
    const only = sock(1000);
    const r = new RelayRoom({ getWebSockets: () => [only], acceptWebSocket() {}, setWebSocketAutoResponse() {} });
    expect(r.room.mac).toBe(only);
  });

  it('an answer that comes back on another of the computer\'s sockets still reaches the phone', async () => {
    const asked = sock(1000);
    const other = sock(2000);
    const sockets = [asked];
    const r = new RelayRoom({ getWebSockets: () => sockets, acceptWebSocket() {}, setWebSocketAutoResponse() {} });
    let id = null;
    asked.send = (bytes) => { id = new Uint8Array(bytes).slice(1, 1 + ID_BYTES); };
    const answer = r.fetch(new Request(`https://relay.test/t/${room}`, { method: 'POST', body: new Uint8Array(40) }));
    await new Promise((r) => setTimeout(r, 20));
    expect(id).not.toBe(null);
    sockets.push(other);
    const frame = new Uint8Array(1 + ID_BYTES + 4);
    frame[0] = FROM_MAC.FRAME;
    frame.set(id, 1);
    r.webSocketMessage(other, frame);
    const res = await answer;
    expect(res.status).toBe(200);
  });

  it('when the socket in use closes, the room takes another the computer still has open', () => {
    const older = sock(1000);
    const newer = sock(2000);
    const open = [newer];
    const r = new RelayRoom({ getWebSockets: () => open, acceptWebSocket() {}, setWebSocketAutoResponse() {} });
    expect(r.room.mac).toBe(newer);
    // The platform lists one the room had let go of as well; it closes first.
    open.push(older);
    open.splice(open.indexOf(newer), 1);
    r.webSocketClose(newer);
    expect(r.room.mac).toBe(older);
  });

  it('a phone asking while the room holds no socket finds one the computer still has open', async () => {
    const live = sock(1000);
    const open = [];
    const r = new RelayRoom({ getWebSockets: () => open, acceptWebSocket() {}, setWebSocketAutoResponse() {} });
    expect(r.room.mac).toBe(null);
    open.push(live);
    let asked = false;
    live.send = () => { asked = true; };
    void r.fetch(new Request(`https://relay.test/t/${room}`, { method: 'POST', body: new Uint8Array(40) }));
    await new Promise((r) => setTimeout(r, 20));
    expect(asked).toBe(true);
  });

  it('stamps the time on a computer\'s socket as it takes it', async () => {
    const stamped = [];
    const r = new RelayRoom({ getWebSockets: () => [], acceptWebSocket() {}, setWebSocketAutoResponse() {} });
    const { proof } = await relayIds(KEY);
    globalThis.WebSocketPair = class { constructor() { this[0] = {}; this[1] = { serializeAttachment: (a) => stamped.push(a), close() {}, send() {} }; } };
    try {
      await r.fetch(new Request(`https://relay.test/mac/${room}?proof=${encodeURIComponent(proof)}`, { headers: { upgrade: 'websocket' } })).catch(() => {});
    } finally { delete globalThis.WebSocketPair; }
    expect(stamped).toHaveLength(1);
    expect(typeof stamped[0].at).toBe('number');
  });
});
