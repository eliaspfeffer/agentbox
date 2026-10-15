#!/usr/bin/env node
// THE BREAKER'S HANDS: ONE SHORT COMMAND PER THING A PERSON DOES IN THE TAB.
//
//   node browse.mjs open                 a headless Chrome on the live copy (once)
//   node browse.mjs look                 what is on screen: text, and numbered things to press
//   node browse.mjs click <n>            press thing number n from the last look
//   node browse.mjs click "<words>"      press the first thing whose words start so
//   node browse.mjs type "<text>"        type into whatever has the cursor
//   node browse.mjs press <key> [meta] [shift] [ctrl] [alt]   one key: n, Enter, Escape, ArrowDown…
//   node browse.mjs shot <name>          a picture, saved beside the findings
//   node browse.mjs reload | close
//
// A session of Claude Code is given this command and nothing else that can
// act, and told to break the app the way a person would. Every command
// connects to the same Chrome (its address is kept in the instance folder),
// does one thing, prints what changed, and lets go. The Chrome is a throwaway
// with its profile inside the instance folder: it is never the browser anybody
// is signed into, and `live.mjs down` stops it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, connect } from './cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { readState, INSTANCE } = await import(path.join(here, 'live.mjs'));
const FILE = path.join(INSTANCE, 'browser.json');
const out = process.env.BREAKER_OUT || path.join(INSTANCE, 'breaker');
fs.mkdirSync(out, { recursive: true });

const [verb, ...args] = process.argv.slice(2);
const state = readState();
if (!state) { console.log('No live copy is running. (The run that started you should have started one.)'); process.exit(1); }
const saved = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; } };

/** Number every thing a person could press or type into, and describe the screen. */
const LOOK = `(() => {
  const seen = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight; };
  document.querySelectorAll('[data-breaker-ref]').forEach((e) => e.removeAttribute('data-breaker-ref'));
  const things = [...document.querySelectorAll('button, a[href], input, textarea, select, [role="button"], [role="tab"], [role="option"], [role="menuitem"], [data-item], [tabindex]:not([tabindex="-1"])')]
    .filter(seen).slice(0, 120);
  const list = things.map((el, i) => {
    el.setAttribute('data-breaker-ref', String(i + 1));
    const words = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 70);
    const kind = el.tagName.toLowerCase() + (el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : '');
    return (i + 1) + '. ' + kind + ' "' + words + '"' + (document.activeElement === el ? '  <- cursor here' : '');
  });
  const text = document.body.innerText.replace(/\\n{3,}/g, '\\n\\n').slice(0, 2500);
  return 'SCREEN TEXT:\\n' + text + '\\n\\nTHINGS TO PRESS (' + list.length + '):\\n' + list.join('\\n');
})()`;

async function tab() {
  const b = saved();
  if (!b) { console.log('No browser yet. Run: browse.mjs open'); process.exit(1); }
  const t = await connect(b.wsUrl, { targetId: b.targetId });
  return t;
}
const errorsSince = async (t) => t.evaluate('(window.__breakerErrors || []).splice(0)').catch(() => []);
const catchErrors = `window.__breakerErrors = window.__breakerErrors || [];
  if (!window.__breakerHooked) { window.__breakerHooked = true;
    addEventListener('error', (e) => __breakerErrors.push('error: ' + e.message));
    addEventListener('unhandledrejection', (e) => __breakerErrors.push('rejection: ' + (e.reason && e.reason.message || e.reason))); }`;

async function report(t, what) {
  await t.wait(600);
  await t.evaluate(catchErrors).catch(() => {});
  const errs = await errorsSince(t);
  console.log(`${what}${errs.length ? `\nPAGE ERRORS: ${errs.join(' | ')}` : ''}`);
}

if (verb === 'open') {
  if (saved()) { console.log('Already open. Use: look'); process.exit(0); }
  const profile = path.join(INSTANCE, 'chrome-profile');
  fs.mkdirSync(profile, { recursive: true });
  const { chrome, wsUrl } = await launchChrome({ profile, detached: true });
  const t = await connect(wsUrl);
  fs.writeFileSync(FILE, JSON.stringify({ wsUrl, targetId: t.targetId, pid: chrome.pid }));
  await t.goto(state.url);
  await t.evaluate(catchErrors);
  console.log(await t.evaluate(LOOK));
  t.detach();
} else if (verb === 'look') {
  const t = await tab();
  await t.evaluate(catchErrors).catch(() => {});
  console.log(await t.evaluate(LOOK));
  const errs = await errorsSince(t);
  if (errs.length) console.log(`\nPAGE ERRORS: ${errs.join(' | ')}`);
  t.detach();
} else if (verb === 'click') {
  const t = await tab();
  const which = args.join(' ');
  const hit = await t.evaluate(`(() => {
    const w = ${JSON.stringify(which)};
    const el = /^\\d+$/.test(w) ? document.querySelector('[data-breaker-ref="' + w + '"]')
      : [...document.querySelectorAll('[data-breaker-ref]')].find((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().toLowerCase().startsWith(w.toLowerCase()));
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
  })()`);
  await report(t, hit === null ? `Nothing numbered or named "${which}" on screen. Run look again.` : `Pressed "${hit}".`);
  t.detach();
} else if (verb === 'type') {
  const t = await tab();
  await t.type(args.join(' '));
  await report(t, `Typed ${args.join(' ').length} characters into ${await t.evaluate('document.activeElement ? document.activeElement.tagName.toLowerCase() : "nothing"')}.`);
  t.detach();
} else if (verb === 'press') {
  const t = await tab();
  const [key, ...mods] = args;
  await t.press(key, mods.filter((m) => ['meta', 'shift', 'ctrl', 'alt'].includes(m)));
  await report(t, `Pressed ${[...mods, key].join('+')}.`);
  t.detach();
} else if (verb === 'shot') {
  const t = await tab();
  const name = String(args[0] ?? `shot-${Date.now()}`).replace(/[^\w.-]+/g, '-');
  const file = path.join(out, name.endsWith('.png') ? name : `${name}.png`);
  await t.capture(file);
  console.log(`Saved ${file}`);
  t.detach();
} else if (verb === 'reload') {
  const t = await tab();
  await t.goto(state.url);
  await report(t, 'Reloaded.');
  t.detach();
} else if (verb === 'close') {
  const b = saved();
  if (b?.pid) { try { process.kill(b.pid, 'SIGTERM'); } catch { /* gone */ } }
  try { fs.rmSync(FILE); } catch { /* none */ }
  console.log('Closed.');
} else {
  console.log('usage: browse.mjs open | look | click <n|words> | type "<text>" | press <key> [meta shift ctrl alt] | shot <name> | reload | close');
  process.exit(2);
}
process.exit(0);
