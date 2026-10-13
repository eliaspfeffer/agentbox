// THE PHONE DOOR WAS OPEN ON EVERY NETWORK THE MAC JOINED (pull request #34,
// reviewed 2026-10-11). Whoever holds the phone key can run agents and approve
// their permission cards, so the key is the whole computer. With Tailscale
// picked, the phone reaches the app through `tailscale serve`, which forwards
// to 127.0.0.1, yet the plain-http door still listened on 0.0.0.0: on a café's
// Wi-Fi anyone could talk to it, and a phone that ever used the plain address
// sent the key across that network unencrypted. Measured by asking the door
// on this Mac's own LAN address with Tailscale picked: it answered.
//
// Now: picking Tailscale listens on this computer only. Wi-Fi still listens
// on every address (a phone on the same Wi-Fi has to reach it), but answers
// only a private network address, never a public one.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Readable } from 'node:stream';
import { createPhoneLink, fromThisNetwork } from '../main/phone-link.mjs';

const open = [];
afterEach(() => { while (open.length) open.pop().close(); });

const fakeTailscale = () => ({
  async name() { return 'box.tail1.ts.net'; },
  async serve() {},
  async unserve() {},
});

function make(port, tailscale = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-net-'));
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(dist, 'index.html'), '<p>inbox</p>');
  const link = createPhoneLink({
    file: path.join(dir, 'phone-link.json'),
    channels: new Map([['zero:snapshot', () => ({ items: ['one'] })]]),
    listeners: new Set(), dist, port,
    interfaces: () => ({ en0: [{ family: 'IPv4', internal: false, address: '192.168.1.20' }], utun4: [{ family: 'IPv4', internal: false, address: '100.70.1.2' }] }),
    log: {}, tailscale, warm: () => {},
  });
  open.push(link);
  link.file = path.join(dir, 'phone-link.json');
  return link;
}

const listening = (link, host) => new Promise((resolve) => {
  const wait = async () => {
    const s = await link.status();
    return s.listening && (!host || s.host === host) ? resolve(s) : setTimeout(wait, 10);
  };
  wait();
});

function ask(host, port, link) {
  return new Promise((resolve) => {
    const req = http.request({ host, port, path: '/api/zero:snapshot', method: 'POST', headers: { 'x-agentbox-token': link.key } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', (err) => resolve(err.code === 'ECONNREFUSED' ? 'no answer' : err.code));
    // A Mac with its firewall in stealth mode drops the knock rather than
    // refusing it, so silence is the same answer as a refusal.
    req.setTimeout(1500, () => { req.destroy(); resolve('no answer'); });
    req.end();
  });
}

// This computer's own address on its network, if it has one: the address a
// stranger on the same Wi-Fi would knock on.
const lan = Object.values(os.networkInterfaces()).flat()
  .find((a) => a && a.family === 'IPv4' && !a.internal)?.address;

/** A request as the door sees it, from `remote`. */
function fakeRequest(remote, key) {
  return Object.assign(Readable.from([]), {
    url: '/api/zero:snapshot', method: 'POST',
    headers: { 'x-agentbox-token': key },
    socket: { remoteAddress: remote },
  });
}
function fakeResponse() {
  const res = { status: null, body: '' };
  res.writeHead = (status) => { res.status = status; return res; };
  res.end = (body = '') => { res.body += body; return res; };
  res.write = () => true;
  return res;
}

describe('with Tailscale picked', () => {
  it('listens on this computer only, where tailscale serve hands requests on', async () => {
    const link = make(41951, fakeTailscale());
    await link.act({ action: 'on' });
    await link.act({ action: 'via', via: 'tailscale' });
    const s = await listening(link, '127.0.0.1');
    expect(s.host).toBe('127.0.0.1');
    expect(await ask('127.0.0.1', 41951, link)).toBe(200);
  });

  it.skipIf(!lan)('does not answer on this computer\'s network address', async () => {
    const link = make(41952, fakeTailscale());
    await link.act({ action: 'on' });
    await link.act({ action: 'via', via: 'tailscale' });
    await listening(link, '127.0.0.1');
    expect(await ask(lan, 41952, link)).toBe('no answer');
  });

  it('turned back to Wi-Fi, listens on the network again', async () => {
    const link = make(41953, fakeTailscale());
    await link.act({ action: 'on' });
    await link.act({ action: 'via', via: 'tailscale' });
    await listening(link, '127.0.0.1');
    await link.act({ action: 'via', via: 'wifi' });
    const s = await listening(link, '0.0.0.0');
    expect(s.host).toBe('0.0.0.0');
    if (lan && fromThisNetwork(lan)) expect(await ask(lan, 41953, link)).toBe(200);
  });

  it('starts on this computer only when the app opens with Tailscale already picked', async () => {
    const first = make(41954, fakeTailscale());
    await first.act({ action: 'on' });
    await first.act({ action: 'via', via: 'tailscale' });
    const { file } = first;
    first.close();
    open.length = 0;
    const again = createPhoneLink({ file, channels: new Map(), listeners: new Set(), port: 41954, interfaces: () => ({}), log: {}, tailscale: fakeTailscale(), warm: () => {} });
    open.push(again);
    expect((await listening(again)).host).toBe('127.0.0.1');
  });
});

describe('over Wi-Fi', () => {
  it('answers a phone on a private network', async () => {
    const link = make(41955);
    for (const from of ['192.168.1.30', '10.0.0.7', '172.20.1.4', '127.0.0.1', '::ffff:192.168.1.30', '100.70.9.9']) {
      const res = fakeResponse();
      await link.handle(fakeRequest(from, link.key), res);
      expect([from, res.status]).toEqual([from, 200]);
    }
  });

  it('refuses a public address, even one holding the key', async () => {
    const link = make(41956);
    for (const from of ['8.8.8.8', '172.32.0.1', '192.169.0.1', '11.0.0.1', '::ffff:8.8.8.8', '', undefined]) {
      const res = fakeResponse();
      await link.handle(fakeRequest(from, link.key), res);
      expect([from, res.status]).toEqual([from, 403]);
    }
  });
});

describe('the key', () => {
  it('a wrong key of the same length is refused, and so is one a character short', async () => {
    const link = make(41957);
    const wrong = link.key.slice(0, -1) + (link.key.endsWith('A') ? 'B' : 'A');
    for (const key of [wrong, link.key.slice(0, -1), `${link.key}x`, '']) {
      const res = fakeResponse();
      await link.handle(fakeRequest('192.168.1.30', key), res);
      expect(res.status).toBe(403);
    }
  });
});
