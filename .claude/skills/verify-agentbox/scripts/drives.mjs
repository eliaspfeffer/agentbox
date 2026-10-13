// THE DRIVES: one per feature in ../features/, each a user's path through the
// real browser copy that live.mjs started. A drive presses what a person
// presses, then checks what a person would see AND what the app wrote to disk,
// because a screen that says "sent" over a store that holds nothing is the
// failure verification exists to catch.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const { foldWorkItems } = await import(path.join(REPO, 'shared/work-items.mjs'));

/**
 * The project's own folder of machinery: `<store>/projects/<the project's
 * folder, every non-alphanumeric character as "-">` (main/store/home.mjs). The
 * ledger lives there, not beside project.json.
 */
export function machinery(state, slug = 'sandbox') {
  return path.join(state.storeRoot, 'projects', path.join(state.accountRoot, slug).replace(/[^A-Za-z0-9]/g, '-'));
}
export function readLedger(state, slug = 'sandbox') {
  const file = path.join(machinery(state, slug), 'work-items.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
/** Every project the copy has a ledger for, by slug (the installed app adds "My workspace" of its own). */
export function projects(state) {
  // The account folder and the separator after it, as machinery() spells them.
  const prefix = `${state.accountRoot}/`.replace(/[^A-Za-z0-9]/g, '-');
  try {
    return fs.readdirSync(path.join(state.storeRoot, 'projects')).filter((d) => d.startsWith(prefix)).map((d) => d.slice(prefix.length));
  } catch { return []; }
}

/**
 * Rows folded the way the app folds them: one project's, or with no slug every
 * project's, since where a new thread is filed by default differs between the
 * browser copy (the first project) and the installed app (its own workspace).
 */
export function rows(state, slug = null) {
  // The project is which ledger the row is in; the fold does not repeat it.
  const one = (s) => [...foldWorkItems(readLedger(state, s)).values()].map((r) => ({ ...r, product: s }));
  return slug ? one(slug) : projects(state).flatMap(one);
}
/** A thread's session logs, in whichever project it is filed. */
export function sessionLogs(state, id) {
  for (const slug of projects(state)) {
    try { return fs.readdirSync(path.join(machinery(state, slug), 'sessions', id)); } catch { /* not this one */ }
  }
  return [];
}
/** Every start of the Claude stand-in on one thread: which login, which attempt, when. */
export function spawnsOf(state, id) {
  try {
    return fs.readFileSync(path.join(state.receipts, `${id}.spawns.jsonl`), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}
export function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
/** Poll a fact on disk; the fact, or null when it never came. */
export async function until(fn, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    const got = fn();
    if (got) return got;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
}

const WORD = 'PINEAPPLE';

/**
 * A CLAUDE AND A CODEX TASK, CAUGHT MID-RUN BY THE APP STOPPING, THEN THE APP
 * STARTED AGAIN. `how` is 'quit' (the app alone is signalled and stops its own
 * workers) or 'ctrl-c' (the whole process group at once, as a terminal does).
 * Either way the person expects both tasks to finish once it is back.
 */
async function interruptMidRun({ tab, state, claim, capture, live }, how) {
  const stamp = Date.now().toString(36);
  const tasks = [{ engine: 'claude', tok: `R1${stamp}` }, ...(state.codexBin ? [{ engine: 'codex', tok: `R2${stamp}` }] : [])];
  for (const t of tasks) {
    t.title = `Mid-run ${t.tok} [[stub:slow:12000]] [[tok:${t.tok}]]`;
    t.row = (await compose(tab, state, t.title, { engine: t.engine })).row;
  }
  const codexAsked = (tok) => fs.existsSync(path.join(state.instance, 'codex-model.log'))
    && fs.readFileSync(path.join(state.instance, 'codex-model.log'), 'utf8').includes(tok);
  const running = await until(() => spawnsOf(state, tasks[0].row.id).length && (!tasks[1] || codexAsked(tasks[1].tok)), 30_000);
  claim(running, `both workers are running when the app is stopped (${how === 'quit' ? 'a quit' : 'Control-C'})`);
  await live.restart(how);
  const after = live.readState();
  await tab.goto(after.url);
  // The old page lost its server for a moment, which is the restart, not a bug.
  tab.errors.length = 0;
  const resultOf = (t) => String(rows(after).find((x) => x.id === t.row.id)?.result ?? '');
  const done = await until(() => tasks.every((t) => resultOf(t).includes(t.tok)), 120_000);
  claim(done, 'once it is back, every interrupted task is answered', tasks.map((t) => resultOf(t).slice(0, 70) || 'none').join(' | '));
  claim(tasks.every((t) => rows(after).filter((r) => r.title === t.title).length === 1), 'no task was duplicated');
  const listed = [];
  for (const t of tasks) listed.push(await inNeedsYou(tab, t.title, rows(after).find((x) => x.id === t.row.id)));
  claim(listed.every(Boolean), 'both are under Needs you');
  await capture('after-restart');
}

/**
 * OPEN A THREAD THE WAY A PERSON FINDS IT: the All tab, so it is there whichever
 * list it has moved to (a real worker sets its own status and the row leaves
 * In progress), then its row by the name the list shows, which is the label an
 * agent gave it when it gave one, else the title. Matched on the start of the
 * name, because a long one is cut short on screen.
 */
/** Click one of the list's tabs by its words (its count is ignored). True when one was there. */
export async function clickTab(tab, words) {
  const hit = await tab.evaluate(`(() => {
    const re = new RegExp(${JSON.stringify(words.source)}, ${JSON.stringify(words.flags)});
    const el = [...document.querySelectorAll('button, [role="tab"], a')].find((e) => re.test(e.textContent.trim()));
    if (el) el.click();
    return !!el;
  })()`);
  await tab.wait(500);
  return hit;
}

async function openThread(tab, row) {
  await clickTab(tab, /^all\b/i);
  const names = [row.label, row.title].filter(Boolean).map((n) => String(n).slice(0, 24));
  const clicked = await tab.until(`(() => {
    const names = ${JSON.stringify(names)};
    const hit = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && names.some((n) => e.textContent.trim().startsWith(n)));
    if (hit) hit.click();
    return !!hit;
  })()`, { ms: 8000, why: 'the thread to be in the All list' }).catch(() => false);
  await tab.wait(800);
  return clicked;
}

/**
 * IN THE OPEN COMPOSER, CHOOSE THE ENGINE THE WAY A PERSON DOES: the model
 * word under the box, then All models, then the first row in that engine's
 * column. Returns the label now on the chip, or null when there was no such
 * column (an engine this copy does not have).
 */
export async function pickEngine(tab, engine) {
  const head = engine === 'codex' ? 'codex' : 'claude';
  // The field labelled Model, not the To field above it, which is the same kind
  // of button. Pressed again if the first press landed while the composer was
  // still settling (seen once on the fourth task of a quick run).
  for (let i = 0; i < 3; i += 1) {
    await tab.evaluate(`[...document.querySelectorAll('.tc-field')].find((f) => f.querySelector('.tc-label')?.textContent.trim() === 'Model')?.querySelector('.tc-word')?.click()`);
    if (await tab.until(`!!document.querySelector('.tc-model-menu')`, { ms: 1500 }).catch(() => false)) break;
  }
  await tab.until(`!!document.querySelector('.tc-model-menu')`, { why: 'the model menu to open', ms: 2000 });
  await tab.evaluate(`[...document.querySelectorAll('.tc-model-menu .tc-row')].find((b) => /All models/.test(b.textContent))?.click()`);
  await tab.wait(300);
  const label = await tab.evaluate(`(() => {
    const col = [...document.querySelectorAll('.tc-model-menu .tc-col')].find((c) => new RegExp(${JSON.stringify(head)}, 'i').test(c.querySelector('.tc-menu-head')?.textContent ?? ''));
    const row = col?.querySelector('.tc-row');
    if (!row) return null;
    const text = row.textContent.trim();
    row.click();
    return text;
  })()`);
  await tab.wait(300);
  return label;
}

/** In the open composer, choose the project by name from its chip. True when it took. */
export async function pickProject(tab, name) {
  await tab.evaluate(`[...document.querySelectorAll('.tc-chip')].find((b) => b.querySelector('.tc-chip-name'))?.click()`);
  await tab.until(`!!document.querySelector('[role="listbox"][aria-label="Project"]')`, { why: 'the project menu to open', ms: 5000 });
  await tab.evaluate(`[...document.querySelectorAll('[aria-label="Project"] .tc-row')].find((b) => b.textContent.trim() === ${JSON.stringify(name)})?.click()`);
  await tab.wait(300);
  return tab.evaluate(`document.querySelector('.tc-chip-name')?.textContent.trim() === ${JSON.stringify(name)}`);
}

/**
 * IS THIS THREAD WHERE THE PERSON WILL LOOK? The Needs you tab of the list,
 * read off the screen. A finished answer that is not there is the "it never
 * came back" bug, whatever the store says.
 */
export async function inNeedsYou(tab, title, row = null) {
  await tab.press('Escape');
  await tab.press('Escape');
  // The tab, not a leaf: its count sits in a child of the same button.
  await clickTab(tab, /^needs you/i);
  // The list shows the short name an agent gave the thread when it gave one
  // (real Claude Code often does), so look for what the person sees.
  const shown = String(row?.label || title);
  return tab.evaluate(`document.body.innerText.includes(${JSON.stringify(shown.slice(0, 24))})`);
}

/** Compose one thread from the keyboard, optionally on a chosen engine and project. Returns its stored row. */
export async function compose(tab, state, title, { engine = null, project = null } = {}) {
  await tab.until(`document.body.innerText.includes('Threads')`, { why: 'the inbox to draw' });
  // The last composer has to be gone first: while it closes it still holds the
  // cursor, and an N pressed then lands in it (seen on a run of six tasks).
  await tab.until(`!document.querySelector('textarea.tc-text')`, { why: 'the last composer to close', ms: 8000 }).catch(() => tab.press('Escape'));
  await tab.press('n');
  await tab.until(`document.activeElement?.matches('textarea.tc-text') && document.activeElement.value === ''`, { why: 'N to open an empty composer', ms: 8000 });
  await tab.type(title);
  let picked = null;
  if (engine) picked = await pickEngine(tab, engine);
  if (project) await pickProject(tab, project);
  if (engine || project) await tab.evaluate(`document.querySelector('textarea.tc-text')?.focus()`);
  await tab.press('Enter', ['meta']);
  await tab.until(`!document.querySelector('textarea.tc-text')`, { why: '⌘↵ to send and close the composer', ms: 8000 });
  // Composing writes two lines, the app's stamp and then the person's own
  // (with the engine and model); wait for the second, or the row reads early.
  const theirs = (r) => r.title === title && r.wrote?.title?.source === 'founder';
  const row = await until(() => rows(state).find(theirs), 10_000);
  return { row, picked };
}

export const DRIVES = {
  'inbox-opens': {
    what: 'the inbox draws on an empty store: no sign-in wall, no first-run walk, the empty state and its way forward',
    async run({ tab, claim, capture }) {
      await tab.until(`document.body.innerText.includes('Threads')`, { why: 'the inbox to draw' });
      await tab.wait(800);
      await capture('inbox');
      const text = await tab.text();
      claim(!/Wrong or missing token/.test(text), 'the tab got past the token check');
      claim(!/Sign in to/.test(text), 'no sign-in wall (the copy runs as the single-person app)');
      claim(/Nothing needs you/.test(text) && /New thread/.test(text), 'the empty inbox says so and offers a new thread', text.replace(/\s+/g, ' ').slice(0, 120));
    },
  },
  'new-thread': {
    what: 'N, type a task, ⌘↵: the thread is filed, a worker is started on it, and its answer shows in the thread',
    async run({ tab, state, claim, capture }) {
      // With real Claude Code the task is one a model answers in a single turn
      // and the reply drive can check it remembers; with the stand-in, any title.
      const title = state.engine === 'stub'
        ? `Verify ${Date.now().toString(36)}: say hello`
        : `Verify ${Date.now().toString(36)}: reply with exactly the word ${WORD} and nothing else. Do not use any tools.`;
      await tab.until(`document.body.innerText.includes('Threads')`, { why: 'the inbox to draw' });
      await tab.press('n');
      const focused = await tab.until(`document.activeElement?.matches('textarea') && document.activeElement.placeholder`, { why: 'N to open the composer with the cursor in it' });
      claim(true, 'N opens the composer with the cursor in it', focused);
      await tab.type(title);
      await capture('composer');
      await tab.press('Enter', ['meta']);
      await tab.until(`document.body.innerText.includes(${JSON.stringify(title)})`, { why: 'the new thread to appear in the list' });
      await capture('sent');

      const row = await until(() => rows(state).find((r) => r.title === title), 10_000);
      claim(row, 'the store holds the thread', row?.id);
      if (!row) return;
      // The stand-in leaves a receipt; real Claude Code leaves only the session log.
      const receipt = state.engine === 'stub' ? await until(() => readJson(path.join(state.receipts, `${row.id}.json`)), 30_000) : null;
      const logs = await until(() => sessionLogs(state, row.id).length, 30_000);
      claim(state.engine === 'stub' ? receipt : logs, 'a worker was started on it', receipt ? `cwd ${path.basename(receipt.cwd)}` : `${logs ?? 0} session log(s)`);
      if (receipt) {
        const leaked = Object.keys(receipt.env).filter((k) => /^(ANTHROPIC_|OPENAI_)/.test(k) || k === 'CLAUDE_CODE_USE_BEDROCK');
        claim(!leaked.length, 'the worker was handed no API key (it bills the subscription)', leaked.join(', '));
        // A project with code gets a folder per task. The installed app files a
        // new thread in its own "My workspace", which has no repository, and the
        // worker works in that project's folder, which is not anybody's checkout.
        const repo = state.repos?.[row.product];
        if (repo) claim(receipt.cwd !== repo && receipt.cwd.includes(row.id), 'the worker runs in a folder of its own, not the project checkout', receipt.cwd.replace(state.instance, '…'));
        else claim(!Object.values(state.repos ?? {}).includes(receipt.cwd) && receipt.cwd.endsWith(row.product), 'a project without code: the worker runs in that project\'s own folder, not a checkout', receipt.cwd.replace(state.instance, '…'));
        claim(receipt.env.ZERO_ITEM === row.id, 'the worker is told which thread it is on', receipt.env.ZERO_ITEM);
      }
      const answered = await until(() => rows(state).find((r) => r.id === row.id && String(r.result ?? '').trim()), state.engine === 'stub' ? 30_000 : 300_000);
      claim(answered, 'the worker\'s answer is written onto the thread', String(answered?.result ?? '').slice(0, 80));

      // Open it the way a person does: the list row, then read what they read.
      claim(await openThread(tab, rows(state).find((r) => r.id === row.id) ?? row), 'the thread opens from the list');
      if (answered) {
        const shown = await tab.until(`document.body.innerText.includes(${JSON.stringify(String(answered.result).trim().split('\n')[0].slice(0, 40))})`, { why: 'the answer to show in the open thread', ms: 15_000 }).catch(() => false);
        claim(shown, 'the open thread shows the answer');
      }
      // The page draws the person's birth as "Opened this" beside their mark,
      // and an agent's as "An agent opened this".
      const opened = await tab.evaluate(`(() => { const t = document.body.innerText; return /An agent opened this/.test(t) ? 'An agent opened this' : /\\bOpened this|You opened this/.test(t) ? 'Opened this' : null; })()`);
      claim(opened === 'Opened this', 'the thread says you opened it, not an agent', opened ?? 'neither line on screen');
      await tab.wait(600);
      await capture('thread');
    },
  },
  'codex-thread': {
    what: 'a thread sent to Codex from the composer runs on the real codex binary, its answer lands on that thread, and it shows under Needs you',
    async run({ tab, state, claim, capture }) {
      if (state.engine === 'stub' && !state.codexBin) return claim(false, 'this Mac has Codex installed (the drive runs the real codex binary)', 'none found', { known: 'no codex on this Mac' });
      const tok = `cx${Date.now().toString(36)}`;
      const title = state.engine === 'stub'
        ? `Verify Codex [[tok:${tok}]]`
        : `Verify ${tok}: reply with exactly the word MANGO and nothing else. Do not run any commands.`;
      const { row, picked } = await compose(tab, state, title, { engine: 'codex' });
      claim(picked, 'the composer offers Codex and it can be picked', picked ?? 'no Codex column in the model menu');
      await capture('sent');
      if (!claim(row, 'the store holds the thread', row?.id)) return;
      claim(row.engine === 'codex', 'the thread is stored as a Codex thread', `engine ${row.engine ?? 'unset'}`);
      if (state.engine === 'stub') {
        const asked = await until(() => fs.existsSync(path.join(state.instance, 'codex-model.log'))
          && fs.readFileSync(path.join(state.instance, 'codex-model.log'), 'utf8').includes(tok), 60_000);
        claim(asked, 'real codex started and asked its model about this thread');
      } else {
        claim(await until(() => sessionLogs(state, row.id).length, 60_000), 'a Codex worker was started on it');
      }
      const word = state.engine === 'stub' ? tok : 'MANGO';
      const answered = await until(() => rows(state).find((r) => r.id === row.id && String(r.result ?? '').includes(word)), state.engine === 'stub' ? 90_000 : 300_000);
      claim(answered, 'Codex\'s answer is written onto this thread', String(rows(state).find((r) => r.id === row.id)?.result ?? '(none)').slice(0, 80));
      claim(await inNeedsYou(tab, title, rows(state).find((r) => r.id === row.id)), 'the answered thread is under Needs you');
      await capture('needs-you');
      claim(await openThread(tab, rows(state).find((r) => r.id === row.id) ?? row), 'the thread opens from the list');
      await capture('thread');
    },
  },
  'many-at-once': {
    what: 'six tasks sent back to back across two projects and both engines: each is answered, each answer lands on its own thread in its own project, all show under Needs you, and no worker is left running',
    async run({ tab, state, claim, capture }) {
      const stamp = Date.now().toString(36);
      const plan = [0, 1, 2, 3, 4, 5].map((i) => ({
        // Picked every time: the composer keeps the last model chosen.
        engine: (state.codexBin || state.engine === 'real') && i % 2 ? 'codex' : 'claude',
        project: i % 3 === 2 ? 'Second' : 'Sandbox',
        tok: `M${i}${stamp}`,
      }));
      const real = state.engine === 'real';
      const made = [];
      for (const p of plan) {
        const title = real
          ? `Verify ${p.tok}: reply with exactly ${p.tok} and nothing else. Do not run any commands.`
          : `At once ${p.tok} [[stub:slow:4000]] [[tok:${p.tok}]]`;
        const { row } = await compose(tab, state, title, { engine: p.engine, project: p.project });
        made.push({ ...p, title, row });
      }
      await capture('sent');
      claim(made.every((m) => m.row), 'all six are stored', made.map((m) => m.row?.id ?? 'missing').join(' '));
      const slugOf = { Sandbox: 'sandbox', Second: 'second' };
      claim(made.every((m) => m.row?.product === slugOf[m.project]), 'each is filed under the project it was sent to',
        made.map((m) => `${m.project}→${m.row?.product}`).join(' '));
      claim(made.every((m) => (m.row?.engine ?? 'claude') === (m.engine ?? 'claude')), 'each runs on the engine it was sent to',
        made.map((m) => `${m.engine ?? 'claude'}→${m.row?.engine ?? 'claude'}`).join(' '));
      const resultOf = (m) => String(rows(state).find((x) => x.id === m.row?.id)?.result ?? '');
      const done = await until(() => made.every((m) => resultOf(m).includes(m.tok)), real ? 600_000 : 150_000);
      claim(done, 'every task is answered, and each answer carries its own task\'s token (none crossed)',
        made.map((m) => `${m.tok}:${resultOf(m).includes(m.tok) ? 'ok' : resultOf(m).slice(0, 30) || 'none'}`).join(' '));
      const all = rows(state);
      claim(made.every((m) => all.filter((r) => r.title === m.title).length === 1), 'no task was duplicated');
      const listed = [];
      for (const m of made) listed.push(await inNeedsYou(tab, m.title, rows(state).find((x) => x.id === m.row?.id)));
      claim(listed.every(Boolean), 'all six are under Needs you', listed.map((x) => (x ? 'y' : 'n')).join(''));
      await capture('needs-you');
      // Workers end once answered. The Codex app-server is one long-lived
      // process by design, so it is not counted.
      const left = await until(() => {
        const out = execFileSync('ps', ['-Ao', 'command='], { encoding: 'utf8' }).split('\n')
          .filter((l) => l.includes(state.instance) && /stub-claude-worker|codex exec/.test(l));
        return out.length === 0 ? 'none' : null;
      }, 40_000);
      claim(left, 'no worker is left running after its answer');
    },
  },
  'restart-mid-run': {
    what: 'quit and reopen the app (⌘Q, an update) while a Claude and a Codex task are mid-run: both still get exactly one answer, under Needs you',
    stubOnly: 'needs workers slow enough to be caught mid-run',
    notInstalled: 'a restart of the installed app is a relaunch through open; this drive runs on the browser copy',
    run: (ctx) => interruptMidRun(ctx, 'quit'),
  },
  'ctrl-c-mid-run': {
    what: 'Control-C the terminal running the browser copy while a Claude and a Codex task are mid-run, then start it again: both still get exactly one answer',
    stubOnly: 'needs workers slow enough to be caught mid-run',
    notInstalled: 'Control-C is how the browser copy is stopped, not the installed app',
    run: (ctx) => interruptMidRun(ctx, 'ctrl-c'),
  },
  'reply-lands-where-shown': {
    what: 'two replies sent quickly, the second after the app has moved on: each lands on the thread that was on screen when it was sent',
    stubOnly: 'tells threads apart by the token in each stand-in answer',
    async run({ tab, state, claim, capture }) {
      const stamp = Date.now().toString(36);
      // Three, because with more than one other thread waiting the app moves on
      // to the next after a reply instead of back to the list.
      const made = {};
      for (const k of ['A', 'B', 'C']) made[k] = (await compose(tab, state, `Reply ${k} [[tok:Q${k}${stamp}]]`, { engine: 'claude' })).row;
      const answered = await until(() => Object.entries(made).every(([k, r]) => String(rows(state).find((x) => x.id === r.id)?.result ?? '').includes(`Q${k}${stamp}`)), 40_000);
      if (!claim(answered, 'all three threads are answered first')) return;
      // Which thread is open, read off its pane: each answer carries its own token.
      const shown = () => tab.evaluate(`(() => { const t = document.querySelector('.focus-pane')?.innerText ?? '';
        return ['A', 'B', 'C'].find((k) => t.includes('Q' + k + '${stamp}')) ?? null; })()`);
      // Opened the way a person works through Needs you: the tab, then the keys.
      await tab.press('Escape');
      await clickTab(tab, /^needs you/i);
      await tab.press('Enter');
      await tab.wait(800);
      const before = await shown();
      claim(before, 'a thread opens from Needs you with ↵', before ?? 'none');
      if (!before) return;
      const ledgerHas = (row, words) => readLedger(state, row.product).some((l) => l.id === row.id && JSON.stringify(l).includes(words));
      await tab.press('r');
      await tab.until(`document.activeElement?.matches('textarea, [contenteditable="true"]')`, { ms: 8000 });
      await tab.type(`reply one ${stamp}`);
      await tab.press('Enter', ['meta']);
      claim(await until(() => ledgerHas(made[before], `reply one ${stamp}`), 10_000), `the first reply is on thread ${before}, the one on screen`);
      await tab.wait(1200);
      const next = await shown();
      await capture('after-first-reply');
      await tab.press('r');
      const box = await tab.until(`document.activeElement?.matches('textarea, [contenteditable="true"]')`, { ms: 8000 }).catch(() => false);
      if (!next || !box) {
        claim(true, 'after the first reply the app left the thread, so there is no second thread to reply on', `on screen: ${next ?? 'the list'}`);
        return;
      }
      await tab.type(`reply two ${stamp}`);
      await tab.press('Enter', ['meta']);
      const target = made[next];
      claim(await until(() => ledgerHas(target, `reply two ${stamp}`), 10_000), `the second reply is on thread ${next}, the one on screen when it was sent`);
      claim(Object.entries(made).every(([k, r]) => k === next || !ledgerHas(r, `reply two ${stamp}`)), 'and on no other thread');
      await capture('after-second-reply');
    },
  },
  'one-login-runs-out': {
    what: 'two Claude logins, the second out of usage: every task still gets answered, the one that hit the limit moves to the free login within a minute',
    stubOnly: 'needs a login that runs out on demand',
    async run({ tab, state, claim, capture }) {
      // Two tasks, so round-robin puts one of them on each login.
      const made = [];
      for (const n of [1, 2]) made.push((await compose(tab, state, `Login out ${n} [[stub:limit-on:.claude-second]] [[tok:LO${n}${Date.now().toString(36)}]]`, { engine: 'claude' })).row);
      claim(made.every(Boolean), 'both tasks are stored');
      const spawned = (id) => spawnsOf(state, id);
      const hit = await until(() => made.find((r) => spawned(r.id).some((s) => s.login.endsWith('.claude-second'))), 30_000);
      claim(hit, 'one task landed on the login that is out', hit ? spawned(hit.id).map((s) => path.basename(s.login)).join(' → ') : 'neither did; round-robin put both on the free login');
      const answered = await until(() => made.every((r) => /\[LO/.test(String(rows(state).find((x) => x.id === r.id)?.result ?? ''))), 60_000);
      claim(answered, 'every task is answered within a minute, the limited one included',
        made.map((r) => String(rows(state).find((x) => x.id === r.id)?.result ?? '').slice(0, 60)).join(' | '));
      if (hit) {
        const trail = spawned(hit.id).map((s) => path.basename(s.login));
        claim(trail.length >= 2 && trail.at(-1) === 'default', 'the limited task was moved to the free login', trail.join(' → '));
      }
      await capture('answered');
    },
  },
  'every-login-runs-out': {
    what: 'every Claude login and the Codex login out of usage: each task says so in plain words with when it resumes, sits where the person looks, and is not retried in a loop',
    stubOnly: 'needs logins that run out on demand',
    async run({ tab, state, claim, capture }) {
      const claude = (await compose(tab, state, `Out everywhere [[stub:limit]] [[tok:OE${Date.now().toString(36)}]]`, { engine: 'claude' })).row;
      const codex = state.codexBin ? (await compose(tab, state, `Codex out [[stub:limit]] [[tok:CO${Date.now().toString(36)}]]`, { engine: 'codex' })).row : null;
      const said = (r) => String(rows(state).find((x) => x.id === r.id)?.result ?? '');
      claim(await until(() => /usage limit/i.test(said(claude)), 45_000), 'the Claude task says it is at its usage limit', said(claude).slice(0, 120));
      claim(/11:59pm/.test(said(claude)), 'and says when it starts again (the reset time the CLI printed)');
      if (codex) claim(await until(() => /Codex is at its usage limit/i.test(said(codex)), 90_000), 'the Codex task says Codex is at its usage limit', said(codex).slice(0, 120));
      // A minute of watching: no retry storm. At most one attempt per login.
      await tab.wait(45_000);
      const tries = spawnsOf(state, claude.id).length;
      claim(tries >= 1 && tries <= 2, 'the Claude task was tried at most once per login, not in a loop', `${tries} attempt(s) on 2 logins`);
      claim(await inNeedsYou(tab, claude.title, rows(state).find((r) => r.id === claude.id)), 'the stopped task is under Needs you, where the person looks');
      await capture('needs-you');
      await openThread(tab, rows(state).find((r) => r.id === claude.id) ?? claude);
      claim(!/It handed this back/.test(await tab.text()), 'the thread does not claim the agent handed it back (the app wrote its own note)');
      await capture('thread');
      if (!codex) return;
      // A NEW Codex task while Codex is out: nothing can start it until the
      // reset, so it must say that, not "Queued … as soon as one is free" (the
      // breaker's finding, 2026-10-12).
      await tab.press('Escape');
      const next = (await compose(tab, state, `After Codex ran out [[tok:AC${Date.now().toString(36)}]]`, { engine: 'codex' })).row;
      if (!claim(next, 'a new Codex task can still be sent')) return;
      await tab.wait(3000);
      await openThread(tab, rows(state).find((r) => r.id === next.id) ?? next);
      const text = await tab.text();
      claim(/Codex is at its usage limit, so this starts on its own when it resets/.test(text) && !/as soon as one is free/.test(text),
        'a new Codex task says Codex is at its usage limit, not that it is queued', (text.match(/Codex is at[^\n]*|Queued[^\n]*/) ?? ['neither'])[0].slice(0, 120));
      await capture('new-codex-task-at-limit');
    },
  },
  'reply': {
    what: 'open an answered thread, R, type a reply, ⌘↵: the reply is stored, a worker takes it and its answer lands (with --real-claude, it also remembers the first turn)',
    async run({ tab, state, claim, capture }) {
      const done = rows(state).filter((r) => String(r.result ?? '').trim()).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (!claim(done, 'there is an answered thread to reply to (run the new-thread drive first)')) return;
      const before = sessionLogs(state, done.id).length;
      await tab.until(`document.body.innerText.includes('Threads')`);
      claim(await openThread(tab, done), 'the thread opens from the list');
      await tab.press('r');
      const focused = await tab.until(`document.activeElement?.matches('textarea, [contenteditable="true"]')`, { why: 'R to put the cursor in the reply box', ms: 8000 }).catch(() => false);
      claim(focused, 'R puts the cursor in the reply box');
      const stamp = Date.now().toString(36);
      const reply = state.engine === 'stub'
        ? `And once more, ${stamp}`
        : `Which word did you just reply with? Answer with only that word. Do not use any tools. (${stamp})`;
      await tab.type(reply);
      await capture('reply-typed');
      const sentAt = Date.now();
      await tab.press('Enter', ['meta']);
      const heard = await until(() => readLedger(state, done.product).some((l) => l.id === done.id && JSON.stringify(l).includes(stamp)), 10_000);
      claim(heard, 'the reply is written to the thread in the store');
      const started = await until(() => sessionLogs(state, done.id).length > before, 30_000);
      claim(started, 'a worker session is started for the reply', `${before} → ${sessionLogs(state, done.id).length} session logs`);
      const answered = await until(() => {
        const r = rows(state).find((x) => x.id === done.id);
        return (r?.wrote?.result?.ts ?? 0) > sentAt && String(r.result ?? '').trim() ? r : null;
      }, state.engine === 'stub' ? 30_000 : 300_000);
      claim(answered, 'the answer to the reply is written onto the thread', String(answered?.result ?? '').slice(0, 80));
      // MEMORY, PROVED BY BEHAVIOUR. The stand-in leaves no Claude Code
      // transcript, so the app (rightly) cannot resume it and re-briefs instead;
      // only a real session can show the thread's context carried over.
      if (state.engine !== 'stub' && answered) claim(String(answered.result).includes(WORD), `the answer remembers the first turn (${WORD})`, String(answered.result).slice(0, 60));
      await tab.wait(800);
      await capture('after-reply');
    },
  },
};
