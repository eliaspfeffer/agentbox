// A PRIORITY ON A MESSAGE TO A TEAMMATE (w-7ba439c883), three options drawn in
// the built app so they can be compared as pictures rather than as sentences.
//
//   arch -arm64 node scripts/scratch/shot-message-priority.mjs <outDir> <dist>
//
// The card is opened the way a person opens it: N, then To, then the teammate's
// name, then the message typed a character at a time. The priority control
// itself is INJECTED into the real bar, with the app's own classes and the app's
// own four words, because the point of the round is to choose a shape before any
// of it is built. Nothing else on the screen is drawn by this script.
import fs from 'node:fs';
import path from 'node:path';
import { openInbox } from '../lib/inbox-harness.mjs';

const outDir = process.argv[2] ?? '/tmp/w-7ba439c883';
const dist = process.argv[3] ?? '/tmp/w-7ba439c883-dist';
fs.mkdirSync(outDir, { recursive: true });

const now = Date.UTC(2026, 9, 5, 19, 40);
const ME = 'u-you';
const MAYA = 'u-maya';

const me = { id: ME, email: 'you@northsound.co', name: 'You', avatarUrl: null, role: 'owner' };
const maya = { id: MAYA, email: 'maya@northsound.co', name: 'Maya Oyelaran', avatarUrl: null, role: 'member' };
const jun = { id: 'u-jun', email: 'jun@northsound.co', name: 'Jun Park', avatarUrl: null, role: 'member' };

const products = [
  { slug: 'north-sound', name: 'North Sound', repoPath: '/Users/you/code/north-sound' },
  { slug: 'harbour', name: 'Harbour', repoPath: '/Users/you/code/harbour' },
  // The conversation with Maya, for the inbox shot only. The card shot picks
  // Jun, who has no conversation yet, so that picking him keeps the card open
  // instead of opening a chat (ThreadComposer onOpenConversation).
  { slug: 'direct-maya', name: 'Maya Oyelaran', team: { direct: true, projectId: 'p-direct-maya', people: [MAYA], sharedBy: ME } },
];

const row = (id, product, productName, title, priority, extra = {}) => ({
  id, product, productName, title, priority, status: 'open', kind: 'directive',
  createdAt: now - 6e6, updatedAt: now - 9e5, wrote: { priority: { ts: now - 6e6, source: 'founder', by: ME } }, ...extra,
});

const items = [
  row('w-a1', 'north-sound', 'North Sound', 'The sign-in page refuses a saved password', 9),
  row('w-a2', 'north-sound', 'North Sound', 'Rewrite the welcome email so it sounds like a person', 5),
  row('w-a3', 'north-sound', 'North Sound', 'Charts on the tide page load twice', 5),
  row('w-a4', 'harbour', 'Harbour', 'The checkout test is flaky on the fixture', 7),
  row('w-a5', 'harbour', 'Harbour', 'Move the docs to the new domain', 2),
];

// The message from Maya, as the receiving Mac folds it: a row in the direct
// project, her words in the body, carrying the level she picked.
const message = (priority) => ({
  id: 'w-msg', product: 'direct-maya', productName: 'Maya Oyelaran',
  title: 'Can you look at the pricing page before the call at four?',
  body: 'Can you look at the pricing page before the call at four?',
  kind: 'directive', status: 'open', people: [MAYA, ME], createdBy: MAYA, priority,
  createdAt: now - 1.2e6, updatedAt: now - 1.2e6,
  wrote: { body: { ts: now - 1.2e6, source: 'founder', by: MAYA }, priority: { ts: now - 1.2e6, source: 'founder', by: MAYA } },
});

const snapshot = (msgPriority) => ({
  products,
  items: [...items, ...(msgPriority ? [message(msgPriority)] : [])],
  agents: [], approvals: [],
  team: {
    configured: true, started: true, signedIn: true, since: now - 9e8,
    me, team: { id: 't-1', name: 'North Sound' }, people: [me, maya, jun],
    cards: [], lastSyncAt: now - 6e4, error: null,
  },
  supervisor: {
    paused: false, pausedProducts: [], running: [], stalled: [], queued: [], scheduled: [],
    productOrder: ['north-sound', 'harbour'], hiddenProducts: [], personalProducts: [], capacity: 4,
  },
  restartNeeded: null, config: {},
});

const open = async (snap) => {
  const app = await openInbox({ dist, width: 1440, height: 944, snapshot: snap });
  await app.goto(app.origin);
  await app.evaluate(`localStorage.setItem('zero.firstRun.done', '1')`);
  await app.wear({ theme: 'dark' });
  return app;
};

/* --------------------------- the card, three ways -------------------------- */

const app = await open(snapshot(null));
const { call, evaluate, wait, capture } = app;

const press = async (key, code, vk, modifiers = 0) => {
  await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
};
const typeText = async (s) => { for (const ch of s) await call('Input.dispatchKeyEvent', { type: 'char', text: ch }); };
const click = (sel) => evaluate(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (b) b.click(); return !!b; })()`);
const text = (sel) => evaluate(`(() => document.querySelector(${JSON.stringify(sel)})?.innerText ?? null)()`);

await press('n', 'KeyN', 78);
await wait(800);
console.log('card     :', await text('.tc-head'));
await click('.tc-head button[data-trigger].tc-word');
await wait(500);
// Jun, the teammate with no conversation yet.
await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.tc-to-menu .tc-row')];
  const jun = rows.find((r) => r.innerText.includes('Jun'));
  if (jun) jun.click();
  return !!jun;
})()`);
await wait(600);
await click('.tc-text');
await wait(200);
await typeText('Can you look at the pricing page before the call at four? The second tier reads as more expensive than the third.');
await wait(500);
console.log('bar now  :', await text('.tc-bar'));
await capture(path.join(outDir, '0-today.png'));

// The bar as it stands, kept so the options can be read against it.
const BAR = await evaluate(`document.querySelector('.tc-bar').innerHTML`);

const BARS = (prio) => `<span class="tc-prio"><span class="prio-bars ${prio.bars}">${'<i></i>'.repeat(prio.bars === 'p4' ? 4 : 3)}</span></span>`;
const LEVELS = {
  low: { label: 'Low', bars: 'p1' },
  medium: { label: 'Medium', bars: 'p2' },
  high: { label: 'High', bars: 'p3' },
  urgent: { label: 'Urgent', bars: 'p4' },
};

// The four-level drawer, exactly the card's own priority menu.
const MENU = (on) => `<div class="tc-menu tc-rise tc-narrow" role="listbox" aria-label="Priority">
  <span class="tc-menu-head">Priority</span>
  ${Object.entries(LEVELS).map(([id, p]) => `<button type="button" class="tc-row ${id === on ? 'on' : ''}">${BARS(p)}<span class="tc-row-label">${p.label}</span></button>`).join('')}
</div>`;

const CHIP = (id, { open = false } = {}) => {
  const p = LEVELS[id];
  return `<span class="tc-anchor">${open ? MENU(id) : ''}<button type="button" class="tc-chip ${open ? 'open' : ''}" title="Priority">${BARS(p)}${p.label}</button></span>`;
};

const draw = async (html) => {
  await evaluate(`(() => { document.querySelector('.tc-bar').innerHTML = ${JSON.stringify(html)}; })()`);
  await wait(400);
};

const SEND = BAR.slice(BAR.indexOf('<span class="tc-send'));
const SENTENCE = (s) => `<span class="tc-only">${s}</span>`;

// OPTION 1: the chip the task card already has, in the bar.
await draw(CHIP('medium') + SENTENCE('Goes to Jun’s inbox.') + SEND);
await capture(path.join(outDir, '1-chip.png'));
await draw(CHIP('medium', { open: true }) + SENTENCE('Goes to Jun’s inbox.') + SEND);
await capture(path.join(outDir, '2-chip-open.png'));
await draw(CHIP('urgent') + SENTENCE('Goes to Jun’s inbox.') + SEND);
await capture(path.join(outDir, '3-chip-urgent.png'));

// OPTION 2: the level is a word inside the sentence that is already there.
const WORD = (id, { open = false } = {}) =>
  `<span class="compose-word-wrap">${open ? MENU(id) : ''}<button type="button" class="compose-word ${open ? 'open' : ''}">${LEVELS[id].label}</button></span>`;
await draw(SENTENCE(`Goes to Jun’s inbox at ${WORD('medium')}.`) + SEND);
await capture(path.join(outDir, '4-word.png'));
await draw(SENTENCE(`Goes to Jun’s inbox at ${WORD('medium', { open: true })}.`) + SEND);
await capture(path.join(outDir, '5-word-open.png'));

// OPTION 3: the chip, and the sentence says what the level does on their side.
await draw(CHIP('medium') + SENTENCE('Goes to Jun’s inbox, with his other threads.') + SEND);
await capture(path.join(outDir, '6-says-what-it-does.png'));
// "Near the top", not "at the top": measured below, an Urgent message lands
// among the urgent rows they already have, by age, not above them.
await draw(CHIP('urgent') + SENTENCE('Goes to Jun’s inbox, near the top of it.') + SEND);
await capture(path.join(outDir, '7-says-what-it-does-urgent.png'));

console.log('errors   :', await evaluate('window.__ERR__ ?? null'));
app.close();

/* ------------------- where it lands, in the other inbox ------------------- */

for (const [name, prio] of [['8-inbox-medium', 5], ['9-inbox-urgent', 9]]) {
  const b = await open(snapshot(prio));
  await b.wait(1200);
  console.log(name, ':', (await b.evaluate(`[...document.querySelectorAll('.row-title')].map(e => e.innerText).join(' | ')`)) ?? '');
  await b.capture(path.join(outDir, `${name}.png`));
  console.log('errors   :', await b.evaluate('window.__ERR__ ?? null'));
  b.close();
}

console.log('wrote', outDir);
