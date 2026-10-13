// THE RELAY'S OWN FRONT (relay/worker.mjs), with Cloudflare's parts stood in
// for. It serves three things of its own: the first page a QR code opens, the
// phone's service worker, and the icon. Everything else is a room's, and goes
// to that room untouched. The first page may run its one script and nothing
// else, so a relay that was tampered with cannot slip a second one in without
// the page refusing it. Built fresh by relay/build.mjs before these run.
import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { buildRelay } from '../relay/build.mjs';
import { relayIds } from '../shared/relay-crypto.mjs';
import { deployedAddress } from '../relay/deploy.mjs';

let worker;
let RelayRoom;
let room;
let mod;

// The worker is bundled here the way wrangler bundles it to deploy, and loaded
// from that bundle. Imported as a file it was once served from the test
// runner's memory of an earlier build: the page still said "Mac" after the
// source said "computer", in a full run and never in a run of this file alone.
beforeAll(async () => {
  await buildRelay();
  const { build } = await import('esbuild');
  const out = await build({ entryPoints: [new URL('../relay/worker.mjs', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'neutral', write: false });
  mod = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
  ({ default: worker, RelayRoom } = mod);
  ({ room } = await relayIds('a-key-of-at-least-24-chars!!'));
});

function envRecording(seen) {
  return { ROOMS: { idFromName: (n) => ({ n }), get: (id) => ({ fetch: async (req) => { seen.push({ room: id.n, method: req.method, path: new URL(req.url).pathname }); return new Response('from the room'); } }) } };
}

describe('the relay\'s own pages', () => {
  it('the first page, which may run its one script and nothing else', async () => {
    const res = await worker.fetch(new Request('https://relay.test/'), envRecording([]));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Connecting to your computer');
    const csp = res.headers.get('content-security-policy');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    expect(csp).toContain(`'sha256-${crypto.createHash('sha256').update(script).digest('base64')}'`);
    expect(csp).not.toContain('unsafe-inline\'; script');
    expect(csp).toMatch(/script-src 'sha256-[^']+';/);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('any other page is the first page, so an old address still starts the phone', async () => {
    const res = await worker.fetch(new Request('https://relay.test/some/where'), envRecording([]));
    expect(await res.text()).toContain('Connecting to your computer');
  });

  it('the first page knows when the Mac turned the phone away', async () => {
    const res = await worker.fetch(new Request('https://relay.test/?boot=stale'), envRecording([]));
    expect(await res.text()).toContain('data-boot="stale"');
  });

  it('the phone\'s worker, with the alerts the Wi-Fi app has', async () => {
    const res = await worker.fetch(new Request('https://relay.test/relay-sw.js'), envRecording([]));
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    expect(res.headers.get('service-worker-allowed')).toBe('/');
    const js = await res.text();
    expect(js).toContain('showNotification');
    expect(js).toContain('notificationclick');
    expect(js).not.toContain('__APP_NAME__');
    expect(js).toContain('/t/');
  });

  it('the icon', async () => {
    const res = await worker.fetch(new Request('https://relay.test/phone-icon.png'), envRecording([]));
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});

describe('everything else is a room\'s', () => {
  it('a phone\'s request and a Mac\'s socket go to their room', async () => {
    const seen = [];
    await worker.fetch(new Request(`https://relay.test/t/${room}`, { method: 'POST', body: 'x' }), envRecording(seen));
    await worker.fetch(new Request(`https://relay.test/mac/${room}?proof=p`), envRecording(seen));
    expect(seen).toEqual([{ room, method: 'POST', path: `/t/${room}` }, { room, method: 'GET', path: `/mac/${room}` }]);
  });

  it('a room name that is not one goes nowhere', async () => {
    const seen = [];
    await worker.fetch(new Request('https://relay.test/t/../../etc', { method: 'POST', body: 'x' }), envRecording(seen));
    await worker.fetch(new Request('https://relay.test/t/short', { method: 'POST', body: 'x' }), envRecording(seen));
    expect(seen).toEqual([]);
  });
});

describe('a room', () => {
  const ctx = () => ({ getWebSockets: () => [], acceptWebSocket() {} });
  it('takes no Mac without the room\'s proof', async () => {
    const r = new RelayRoom(ctx());
    const res = await r.fetch(new Request(`https://relay.test/mac/${room}?proof=wrong`, { headers: { upgrade: 'websocket' } }));
    expect(res.status).toBe(403);
  });
  it('takes a Mac only as a socket', async () => {
    const r = new RelayRoom(ctx());
    expect((await r.fetch(new Request(`https://relay.test/mac/${room}`))).status).toBe(426);
  });
  it('says plainly when its Mac is not there', async () => {
    const r = new RelayRoom(ctx());
    const res = await r.fetch(new Request(`https://relay.test/t/${room}`, { method: 'POST', body: new Uint8Array(40) }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/computer is not connected/);
  });
  it('refuses a request too large to pass on', async () => {
    const r = new RelayRoom(ctx());
    const res = await r.fetch(new Request(`https://relay.test/t/${room}`, { method: 'POST', body: 'x', headers: { 'content-length': String(64 * 1024 * 1024) } }));
    expect(res.status).toBe(413);
  });
});

describe('the worker Cloudflare starts', () => {
  it('exports its handler and its room and nothing else, or it will not start', () => {
    expect(Object.keys(mod).sort()).toEqual(['RelayRoom', 'default']);
  });
});

describe('the deploy', () => {
  it('finds the address wrangler printed', () => {
    expect(deployedAddress('Uploaded agentbox-relay\nDeployed agentbox-relay triggers\n  https://agentbox-relay.someone.workers.dev\nCurrent Version ID: x')).toBe('https://agentbox-relay.someone.workers.dev');
    expect(deployedAddress('nothing here')).toBe(null);
  });
});
