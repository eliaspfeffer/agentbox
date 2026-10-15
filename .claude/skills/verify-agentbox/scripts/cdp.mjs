// A HEADLESS CHROME, DRIVEN THE WAY A PERSON DRIVES THE TAB.
//
// The screenshot scripts in scripts/ open the built screen with a fake
// `window.zero` that refuses every write (scripts/lib/inbox-harness.mjs). That
// is right for pictures and useless for verification: a press of ⌘↵ there
// reaches nothing. This one opens the real browser copy's url, so every key
// goes through the same bridge, the same IPC handlers and the same store the
// desktop uses.
//
// Keys, not coordinates. The app's own shortcuts (N for a new thread, ⌘↵ to
// send, esc to go back) are the most stable handles it has: they are in the
// help, people learn them, and they survive a redesign that moves every button.
//
// The Chrome and its profile go through scripts/lib/chrome-guard.mjs, so a
// drive that throws or is killed leaves no orphan behind.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { guard, sweep } from '../../../../scripts/lib/chrome-guard.mjs';

export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const KEYS = {
  Enter: { code: 'Enter', keyCode: 13 },
  Escape: { code: 'Escape', keyCode: 27 },
  Tab: { code: 'Tab', keyCode: 9 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
};
const MODIFIERS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

/**
 * Start a headless Chrome on a throwaway profile and wait for its devtools
 * address. `detached` leaves it running after this process ends (the breaker's
 * browser, which lives across many short commands); then its profile should sit
 * inside the instance folder, so `live.mjs down` finds and stops it.
 */
export async function launchChrome({ width = 1440, height = 900, profile, detached = false } = {}) {
  if (!fs.existsSync(CHROME)) throw new Error(`No Google Chrome at ${CHROME}. The live drive needs it.`);
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--force-device-scale-factor=2', '--hide-scrollbars', '--no-first-run',
    `--window-size=${width},${height}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], detached });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('chrome never printed a devtools url')), 20_000);
    chrome.stderr.on('data', (d) => { buf += d; const m = buf.match(/ws:\/\/\S+/); if (m) { clearTimeout(timer); resolve(m[0]); } });
  });
  if (detached) { chrome.stderr.destroy(); chrome.unref(); }
  return { chrome, wsUrl };
}

/** Open `url` in a fresh headless Chrome. Returns the handful of verbs a drive needs. */
export async function openTab(url, { width = 1440, height = 900 } = {}) {
  sweep();
  const profile = fs.mkdtempSync('/tmp/shot-profile-');
  const { chrome, wsUrl } = await launchChrome({ width, height, profile });
  const cleanup = guard(chrome, profile);
  const tab = await connect(wsUrl, { width, height });
  return { ...tab, close: () => { tab.detach(); cleanup(); } };
}

/**
 * Drive a page of a Chrome that is already running. With `targetId` it takes
 * over that page (the breaker's next command); without, it opens a new one.
 */
export async function connect(wsUrl, { width = 1440, height = 900, targetId: existing = null } = {}) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let nextId = 1;
  const pending = new Map();
  const events = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') events.push(`exception: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') events.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  };
  // A Chrome that goes away answers nothing; every call waiting on it fails
  // with that fact instead of hanging the drive forever.
  let gone = null;
  ws.onclose = () => {
    gone = new Error('headless Chrome closed the connection');
    for (const settle of pending.values()) settle({ error: { message: gone.message } });
    pending.clear();
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (gone) return reject(gone);
    const id = nextId++;
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const targetId = existing ?? (await send('Target.createTarget', { url: 'about:blank' })).targetId;
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (m, p) => send(m, p, sessionId);
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
  // Dark, because that is how the people who use this read it.
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const evaluate = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const goto = async (to) => {
    await call('Page.navigate', { url: to });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try { if (await evaluate('document.readyState') === 'complete') break; } catch { /* navigating */ }
      await wait(100);
    }
    await evaluate('document.fonts.ready.then(() => true)');
  };
  /** One key, as a person presses it: `press('n')`, `press('Enter', ['meta'])`. */
  const press = async (key, mods = []) => {
    const modifiers = mods.reduce((n, m) => n | MODIFIERS[m], 0);
    const named = KEYS[key];
    const base = named
      ? { key, code: named.code, windowsVirtualKeyCode: named.keyCode }
      : { key, code: `Key${key.toUpperCase()}`, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) };
    const text = !named && !mods.length ? key : key === 'Enter' && !mods.length ? '\r' : undefined;
    await call('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', modifiers, ...base, ...(text ? { text } : {}) });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...base });
  };
  /** Text into whatever has focus, the way a paste or an IME lands it. */
  const type = (text) => call('Input.insertText', { text });
  const capture = async (file) => {
    const { data } = await call('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  };
  /** Wait for an expression in the page to be truthy, and say which one when it never is. */
  const until = async (expression, { ms = 30_000, why = expression } = {}) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const got = await evaluate(expression).catch(() => null);
      if (got) return got;
      if (Date.now() > deadline) throw new Error(`waited ${Math.round(ms / 1000)}s for ${why} and it never happened`);
      await wait(200);
    }
  };
  const text = () => evaluate('document.body.innerText');

  return {
    call, evaluate, goto, press, type, capture, until, wait, text, errors: events, targetId,
    // Lets go of the page and leaves Chrome running.
    detach: () => { try { ws.close(); } catch { /* gone */ } },
  };
}
