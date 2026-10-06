// A PRIORITY ON A MESSAGE TO A TEAMMATE (w-7ba439c883), photographed in the
// built renderer.
//
//   npx vite build renderer --outDir dist-w7ba
//   arch -arm64 node scripts/shot-message-priority.mjs <outDir> renderer/dist-w7ba
//
// NOTHING IS INJECTED ANY MORE. The round that chose this shape drew three
// options by writing markup into the real bar; the chosen one is built, so the
// script now opens the card the way a person does (N, To, the name, the words
// typed) and presses the chip itself. It also draws the receiving inbox with
// the same message at Medium and at Urgent, which is where the level is for.
import fs from 'node:fs';
import path from 'node:path';
import { openInbox } from './lib/inbox-harness.mjs';

const outDir = process.argv[2] ?? '/tmp/w-7ba439c883';
const dist = process.argv[3] ?? 'renderer/dist-w7ba';
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
  // The conversation with Maya, for the inbox shots only. The card shot picks
  // Jun, who has no conversation yet, so that picking him keeps the card open
  // instead of opening a chat (ThreadComposer onOpenConversation).
  { slug: 'direct-maya', name: 'Maya Oyelaran', team: { direct: true, projectId: 'p-direct-maya', people: [MAYA], sharedBy: ME } },
];

const row = (id, product, productName, title, priority) => ({
  id, product, productName, title, priority, status: 'open', kind: 'directive',
  createdAt: now - 6e6, updatedAt: now - 9e5, wrote: { priority: { ts: now - 6e6, source: 'founder', by: ME } },
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
  wrote: { body: { ts: now - 1.2e6, source: 'founder', by: MAYA }, priority: { ts: now - 1.2e6, source: 'system', by: MAYA } },
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
  // The card remembers the last level picked, so a run of this script must not
  // leave one behind for the next: the shots open on an untouched card.
  await app.evaluate(`localStorage.removeItem('zero.lastPriority')`);
  await app.wear({ theme: 'dark' });
  return app;
};

/* ------------------------------ the card ------------------------------- */

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
await click('.tc-head button[data-trigger].tc-word');
await wait(500);
// Jun, the teammate with no conversation yet.
await evaluate(`(() => {
  const jun = [...document.querySelectorAll('.tc-to-menu .tc-row')].find((r) => r.innerText.includes('Jun'));
  if (jun) jun.click();
  return !!jun;
})()`);
await wait(600);
await click('.tc-text');
await wait(200);
await typeText('Can you look at the pricing page before the call at four? The second tier reads as more expensive than the third.');
await wait(500);
console.log('the bar  :', await text('.tc-bar'));
await capture(path.join(outDir, '1-the-chip.png'));

await click('.tc-bar [data-trigger].tc-chip');
await wait(500);
console.log('the drawer:', await text('.tc-bar .tc-menu'));
await capture(path.join(outDir, '2-the-four-levels.png'));

await evaluate(`(() => {
  const urgent = [...document.querySelectorAll('.tc-bar .tc-menu .tc-row')].find((r) => r.innerText.trim() === 'Urgent');
  if (urgent) urgent.click();
  return !!urgent;
})()`);
await wait(500);
console.log('picked   :', await text('.tc-bar'));
await capture(path.join(outDir, '3-urgent.png'));

console.log('errors   :', await evaluate('window.__ERR__ ?? null'));
app.close();

/* ------------------- where it lands, in the other inbox ------------------- */

for (const [name, prio] of [['4-where-a-medium-message-lands', 5], ['5-where-an-urgent-message-lands', 9]]) {
  const b = await open(snapshot(prio));
  await b.wait(1200);
  await b.capture(path.join(outDir, `${name}.png`));
  console.log(name, 'errors:', await b.evaluate('window.__ERR__ ?? null'));
  b.close();
}

console.log('wrote', outDir);
