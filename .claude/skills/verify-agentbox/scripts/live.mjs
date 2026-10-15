#!/usr/bin/env node
// A REAL AGENTBOX, UNDER /tmp, THAT A VERIFYING AGENT CAN DRIVE AND THROW AWAY.
//
//   node .claude/skills/verify-agentbox/scripts/live.mjs up [--real-claude]
//   node .claude/skills/verify-agentbox/scripts/live.mjs doctor
//   node .claude/skills/verify-agentbox/scripts/live.mjs drive <name> [--out <dir>]
//   node .claude/skills/verify-agentbox/scripts/live.mjs down
//   node .claude/skills/verify-agentbox/scripts/live.mjs drives      (list them)
//
// WHAT IT RUNS. `bin/agentbox.mjs`, the browser copy of the app: the same
// store, supervisor, IPC handlers and renderer as the desktop, with no
// Electron. It is the only way to have a second Agentbox on this Mac that
// cannot touch the one somebody is using: its own store, its own port, its
// own account, under one folder that `down` deletes.
//
// WHO ANSWERS. By default the worker is scripts/lib/stub-claude-worker.mjs,
// which is not Claude Code and says so: everything on Agentbox's side of the
// spawn is real and nothing is billed. `--real-claude` leaves `claudeBin`
// unset, so the app finds Claude Code exactly as a new user's copy would, and
// spawns it for real on this person's subscription. It writes a session into
// ~/.claude like any run, so use it for the pre-deploy proof, not for every
// iteration.
//
// One instance per checkout, so two agents verifying two branches on one Mac
// do not drive each other's. Evidence goes to /tmp/agentbox-verify/runs and
// survives `down`.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, '../../../..');
export const ROOT = '/tmp/agentbox-verify';
export const RUNS = path.join(ROOT, 'runs');
const { FRESH_USER_ENV } = await import(path.join(REPO, 'shared', 'fresh-user-home.mjs'));
const KEY = crypto.createHash('sha1').update(REPO).digest('hex').slice(0, 8);
export const INSTANCE = path.join(ROOT, 'instances', KEY);
const STATE = path.join(INSTANCE, 'instance.json');
export const STUB = path.join(REPO, 'scripts', 'lib', 'stub-claude-worker.mjs');
export const PRODUCT = { slug: 'sandbox', name: 'Sandbox' };
const ACCOUNT = 'verify-account';

const say = (s = '') => console.log(s);
const stop = (s, code = 1) => { console.error(`live: ${s}`); process.exit(code); };

export function readState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return null; }
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const commandOf = (pid) => { try { return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim(); } catch { return ''; } };

/** Newest mtime under a folder, for "is the built screen older than its source?". */
function newest(dir) {
  let best = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    best = Math.max(best, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return best;
}
export function screenIsStale() {
  const built = path.join(REPO, 'renderer', 'dist', 'index.html');
  if (!fs.existsSync(built)) return 'not built';
  return newest(path.join(REPO, 'renderer', 'src')) > fs.statSync(built).mtimeMs ? 'older than renderer/src' : null;
}

/**
 * THE ENVIRONMENT THE COPY STARTS WITH. This script is usually run by an agent
 * that is itself an Agentbox worker, so it inherits ZERO_ITEM, STORE_* and the
 * rest of a worker's identity. Passed through, the copy's own workers would
 * write to the founder's real row. Everything that names a store, an item, an
 * account or a billing route is taken out; the app adds back what it means to.
 */
export function cleanEnv(base = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(base)) {
    if (/^(ZERO_|STORE_|AGENTBOX_|ASTRAL_|ANTHROPIC_|CLAUDE_CODE_|OPENAI_|CODEX_)/.test(k)) continue;
    if (['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'MCP_CONNECTION_NONBLOCKING'].includes(k)) continue;
    out[k] = v;
  }
  return out;
}

export const PROJECTS = [PRODUCT, { slug: 'second', name: 'Second' }];

/** The Codex this Mac has, found the way the app finds it, or null. */
async function realCodex() {
  const { findCodexBin } = await import(path.join(REPO, 'main', 'codex-bin.mjs'));
  try { const f = findCodexBin({}); return f.found ? f.path : null; } catch { return null; }
}

/**
 * EVERYTHING THE COPY NEEDS ON DISK, MADE ONCE PER INSTANCE.
 *
 * STAND-IN MODE (the default) gives the copy a HOME of its own, so what it
 * finds there is the same on every Mac and every run: two Claude logins
 * (`.claude` and `.claude-second`, each a `.claude.json` naming an account,
 * which is all main/account-discovery.mjs reads), the Claude stand-in behind a
 * tiny wrapper, and the real `codex` binary pointed at a scripted model on a
 * loopback port. REAL MODE keeps this Mac's own home, so the copy finds and
 * runs the Claude Code and Codex installed here, signed in as they are.
 */
async function prepare(real) {
  const data = path.join(INSTANCE, 'data');
  const storeRoot = path.join(INSTANCE, 'store');
  const accountRoot = path.join(storeRoot, 'accounts', ACCOUNT);
  const receipts = path.join(INSTANCE, 'receipts');
  const home = real ? null : path.join(INSTANCE, 'home');
  for (const d of [data, receipts]) fs.mkdirSync(d, { recursive: true });

  // Two projects with a real git repo behind each, so a worker has somewhere
  // to stand, a thread can be checked to land under the right one, and the
  // first-run walk (which a store with no projects gets) is skipped.
  const repos = {};
  for (const p of PROJECTS) {
    const repo = path.join(INSTANCE, 'repos', p.slug);
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(path.join(accountRoot, p.slug), { recursive: true });
    fs.writeFileSync(path.join(repo, 'README.md'), `# ${p.name}\n\nA throwaway project for verifying Agentbox.\n`);
    const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('-c', 'user.email=verify@agentbox.invalid', '-c', 'user.name=verify', 'commit', '-qm', 'seed');
    fs.writeFileSync(path.join(accountRoot, p.slug, 'project.json'), `${JSON.stringify({
      schemaVersion: 2, id: p.slug, name: p.name, repoPath: repo, oneLiner: 'a throwaway project for verification',
    }, null, 1)}\n`);
    repos[p.slug] = repo;
  }

  const plan = path.join(INSTANCE, 'stub-plan.json');
  fs.writeFileSync(plan, `${JSON.stringify({ say: 'The verify stand-in ran and answered.', receipts }, null, 1)}\n`);

  let claudeBin = null;
  let codexBin = null;
  let codexHome = null;
  if (!real) {
    for (const [dir, n] of [['.claude', 'one'], ['.claude-second', 'two']]) {
      fs.mkdirSync(path.join(home, dir), { recursive: true });
      fs.writeFileSync(path.join(home, dir, '.claude.json'), `${JSON.stringify({ oauthAccount: { emailAddress: `${n}@verify.invalid`, accountUuid: `verify-account-${n}` } })}\n`);
    }
    // A wrapper, so the stand-in starts with an absolute node and does not
    // depend on what PATH the copy's shell recovers from an empty home. It runs
    // a COPY of the stand-in kept here under /tmp, never the one in this
    // checkout: a checkout under ~/Desktop or ~/Documents is a folder macOS
    // guards, and the installed app reading a script there waits on a privacy
    // prompt on the person's screen. Measured 2026-10-12: four workers sat for
    // minutes before running a line. (The stand-in imports nothing but Node's
    // own modules, so the copy is the whole of it.)
    claudeBin = path.join(INSTANCE, 'bin', 'claude');
    fs.mkdirSync(path.dirname(claudeBin), { recursive: true });
    const stub = path.join(INSTANCE, 'bin', 'stub-claude-worker.mjs');
    fs.copyFileSync(STUB, stub);
    fs.writeFileSync(claudeBin, `#!/bin/sh\nexec "${process.execPath}" "${stub}" "$@"\n`, { mode: 0o755 });
    codexBin = await realCodex();
    if (codexBin) {
      codexHome = path.join(INSTANCE, 'codex-home');
      fs.mkdirSync(codexHome, { recursive: true });
    }
  }
  const state = {
    repoRoot: REPO, instance: INSTANCE, data, storeRoot, accountRoot, repo: repos[PRODUCT.slug], repos, receipts, plan, home,
    log: path.join(INSTANCE, 'app.log'), engine: real ? 'real' : 'stub', claudeBin, codexBin, codexHome,
  };
  return state;
}

/*
 * THE INSTALLED APP, AS A STRANGER GETS IT.
 *
 * Eleven of the 36 bugs that reached people lived only in the packaged app:
 * paths inside app.asar, a worker started with its cwd inside the bundle, a
 * Finder launch whose cwd is `/`, a keychain prompt, a bundle id. None of that
 * exists in `bin/agentbox.mjs`. So `up --installed` builds the real .app (this
 * Mac's chip only, no installer image, unsigned, which keeps it to a minute or
 * two) under its own bundle id, `ac.astral.verify`, so macOS never confuses it
 * with the Agentbox somebody uses, and opens it with `open`, the way the Dock
 * does: launchd's bare environment, cwd `/`, a throwaway home. The drives then
 * run against its window through Electron's debugging port.
 */
const PRODUCT_NAME = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).build?.productName ?? 'Agentbox';
export const BUILD = path.join(ROOT, `build-${KEY}`);
export const APP = path.join(BUILD, process.arch === 'arm64' ? 'mac-arm64' : 'mac', `${PRODUCT_NAME}.app`);
const APP_BIN = path.join(APP, 'Contents', 'MacOS', PRODUCT_NAME);

export function appIsStale() {
  const plist = path.join(APP, 'Contents', 'Info.plist');
  if (!fs.existsSync(plist)) return 'not built';
  const built = fs.statSync(plist).mtimeMs;
  const src = Math.max(...['main', 'shared', 'bin', path.join('renderer', 'src'), 'mcp'].map((d) => newest(path.join(REPO, d))),
    fs.statSync(path.join(REPO, 'package.json')).mtimeMs);
  return src > built ? 'older than its source' : null;
}

function buildInstalled() {
  say('building the installed app (npm run build, then electron-builder for this Mac only; a minute or two)');
  const b = spawnSync('npm', ['run', 'build'], { cwd: REPO, stdio: 'inherit' });
  if (b.status !== 0) stop('npm run build failed, so there is no app to install.');
  const arch = process.arch === 'arm64' ? '--arm64' : '--x64';
  const e = spawnSync('npx', ['electron-builder', '--mac', 'dir', arch, '--publish', 'never',
    '-c.appId=ac.astral.verify', `-c.directories.output=${BUILD}`], {
    cwd: REPO, stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  });
  if (e.status !== 0 || !fs.existsSync(APP_BIN)) stop(`electron-builder did not produce ${APP}.`);
}

async function freePort() {
  const net = await import('node:net');
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

/** Open the installed app on the instance's throwaway home and wait for its window. */
async function startInstalled(state) {
  const userData = path.join(state.home, 'Library', 'Application Support', PRODUCT_NAME);
  fs.mkdirSync(userData, { recursive: true });
  const env = { [FRESH_USER_ENV]: '1', HOME: state.home, CFFIXED_USER_HOME: state.home, STUB_CLAUDE_PLAN: state.plan };
  if (state.codexHome) {
    const server = spawn(process.execPath, [path.join(here, 'stub-codex-server.mjs'), INSTANCE], { detached: true, stdio: 'ignore' });
    server.unref();
    const file = path.join(INSTANCE, 'codex-model.json');
    try { fs.rmSync(file); } catch { /* none yet */ }
    const deadline = Date.now() + 10_000;
    while (!fs.existsSync(file) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    const { url } = JSON.parse(fs.readFileSync(file, 'utf8'));
    const { stubCodexHome } = await import(path.join(REPO, 'scripts', 'lib', 'codex-stub-model.mjs'));
    stubCodexHome(state.codexHome, { url });
    env.ASTRAL_STUB_KEY = process.env.ASTRAL_STUB_KEY;
  }
  const file = path.join(userData, 'zero.config.json');
  let had = {};
  try { had = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first start */ }
  fs.writeFileSync(file, `${JSON.stringify({
    ...had, storeRoot: state.storeRoot, accountId: ACCOUNT, claudeBin: state.claudeBin,
    ...(state.codexBin ? { codexBin: state.codexBin, codexHome: state.codexHome } : {}),
    engineChoice: '2026-01-01T00:00:00.000Z', maxConcurrentSessions: 2,
  }, null, 2)}\n`);
  const port = await freePort();
  // `open` hands the app the environment it was itself started with, so run
  // from a terminal (or from inside an agent) it passed on every variable of
  // that session, including another Agentbox's memory gate. Started with an
  // empty one, the app gets what a Dock launch gives it, plus the few set here.
  const open = spawnSync('/usr/bin/open', ['-n', '-a', APP, ...Object.entries(env).flatMap(([k, v]) => ['--env', `${k}=${v}`]),
    '--args', `--remote-debugging-port=${port}`], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } });
  if (open.status !== 0) stop(`open could not start the installed app: ${open.stderr}`);
  const deadline = Date.now() + 60_000;
  let page = null;
  while (!page && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = list.find((t) => t.type === 'page' && /index\.html|^app:|^file:/.test(t.url));
    } catch { /* not up yet */ }
  }
  if (!page) stop(`the installed app never opened a window on port ${port}.`);
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const pid = Number(execFileSync('pgrep', ['-n', '-f', APP_BIN], { encoding: 'utf8' }).trim());
  const next = { ...state, installed: true, pid, cdpPort: port, browserWs: webSocketDebuggerUrl, targetId: page.id, url: null, userData, startedAt: new Date().toISOString() };
  fs.writeFileSync(STATE, `${JSON.stringify(next, null, 1)}\n`);
  return next;
}

/** Start the copy over an instance that is already on disk, and wait for its address. */
async function start(state) {
  if (state.installed) return startInstalled(state);
  const env = { ...cleanEnv(), STUB_CLAUDE_PLAN: state.plan,
    // The fresh-user flag is the app's own word for "this copy is nobody": no
    // team cloud even on a Mac that has a team key (so no sign-in screen and
    // nothing written to the shared project), and any counts go under the one
    // id that names itself as not a person (shared/fresh-user-home.mjs).
    [FRESH_USER_ENV]: '1' };
  if (state.engine === 'stub') {
    // HOME and CFFIXED_USER_HOME together: macOS asks Core Foundation, not the
    // environment, for some paths (scripts/fresh-user.mjs says why).
    Object.assign(env, { HOME: state.home, CFFIXED_USER_HOME: state.home });
    if (state.codexHome) {
      // A new scripted model on each start; the old one died with the copy.
      const server = spawn(process.execPath, [path.join(here, 'stub-codex-server.mjs'), INSTANCE], { detached: true, stdio: 'ignore' });
      server.unref();
      const deadline = Date.now() + 10_000;
      const file = path.join(INSTANCE, 'codex-model.json');
      try { fs.rmSync(file); } catch { /* none yet */ }
      while (!fs.existsSync(file) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      const { url } = JSON.parse(fs.readFileSync(file, 'utf8'));
      const { stubCodexHome } = await import(path.join(REPO, 'scripts', 'lib', 'codex-stub-model.mjs'));
      stubCodexHome(state.codexHome, { url });
      env.ASTRAL_STUB_KEY = process.env.ASTRAL_STUB_KEY;
    }
  }
  const config = {
    storeRoot: state.storeRoot,
    accountId: ACCOUNT,
    ...(state.claudeBin ? { claudeBin: state.claudeBin } : {}),
    ...(state.codexBin ? { codexBin: state.codexBin } : {}),
    ...(state.codexHome ? { codexHome: state.codexHome } : {}),
    // A first launch writes this itself; set here so the copy is the same on
    // every run and Codex may be picked from the composer.
    engineChoice: '2026-01-01T00:00:00.000Z',
    maxConcurrentSessions: 2,
  };
  // The app writes its account id back into this file, so keep what it added.
  const file = path.join(state.data, 'zero.config.json');
  let had = {};
  try { had = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first start */ }
  fs.writeFileSync(file, `${JSON.stringify({ ...had, ...config }, null, 2)}\n`);

  const fd = fs.openSync(state.log, 'a');
  const before = fs.existsSync(state.log) ? fs.statSync(state.log).size : 0;
  const child = spawn(process.execPath, [path.join(REPO, 'bin', 'agentbox.mjs'), '--dir', state.data, '--no-open'], {
    cwd: REPO, detached: true, stdio: ['ignore', fd, fd], env,
  });
  child.unref();
  const deadline = Date.now() + 30_000;
  let url = null;
  while (!url && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    url = fs.readFileSync(state.log, 'utf8').slice(before).match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)?.[0] ?? null;
    if (!alive(child.pid)) break;
  }
  if (!url) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    stop(`the copy never printed its address. Its log:\n${fs.readFileSync(state.log, 'utf8').slice(-3000)}`);
  }
  const next = { ...state, pid: child.pid, url, startedAt: new Date().toISOString() };
  fs.writeFileSync(STATE, `${JSON.stringify(next, null, 1)}\n`);
  return next;
}

async function up(args) {
  const state = readState();
  if (state && alive(state.pid)) { say(`already up: ${state.url}`); return; }
  if (state) fs.rmSync(INSTANCE, { recursive: true, force: true });

  const stale = screenIsStale();
  if (stale) {
    say(`the built screen is ${stale}; building it (npx vite build renderer)`);
    const b = spawnSync('npx', ['vite', 'build', 'renderer', '--logLevel', 'warn'], { cwd: REPO, stdio: 'inherit' });
    if (b.status !== 0) stop('the screen did not build, so there is nothing to drive.');
  }
  const real = args.includes('--real') || args.includes('--real-claude');
  const installed = args.includes('--installed');
  if (installed && real) stop('--installed runs on the stand-ins; use --real with the browser copy.');
  if (installed) {
    const old = appIsStale();
    if (old) buildInstalled(); else say('the installed app is newer than its source; using the one already built');
  }
  const prepared = await prepare(real);
  const next = await start(installed ? { ...prepared, installed: true } : prepared);
  say(installed ? `up: the installed app, pid ${next.pid}, window on debugging port ${next.cdpPort}` : `up: ${next.url}`);
  say(real
    ? 'workers: the Claude Code and Codex this Mac has, on their own subscriptions'
    : `workers: the Claude stand-in on two fake logins${next.codexBin ? ', and real codex on a scripted model' : '; no codex on this Mac, so Codex drives are skipped'}`);
  say(`store: ${next.storeRoot}`);
  say('next: live.mjs doctor');
}

/** Stop the copy and start it again on the same store: what a person's restart does to running agents. */
export async function restart(how = 'quit') {
  const state = readState();
  if (!state) stop('nothing to restart. Run: live.mjs up');
  await stopProcesses(state, { how });
  const next = await start(state);
  say(`restarted: ${next.url}`);
}

/** Is this instance worth driving? Read-only. Returns the list of what is wrong. */
export async function doctor({ quiet = false } = {}) {
  const wrong = [];
  const ok = (s) => { if (!quiet) say(`  ok    ${s}`); };
  const bad = (s) => { wrong.push(s); if (!quiet) say(`  WRONG ${s}`); };
  const state = readState();
  if (!state) { bad('no instance for this checkout. Run: live.mjs up'); return wrong; }
  if (alive(state.pid)) ok(`process ${state.pid} is running`); else bad(`process ${state.pid} is gone. Run: live.mjs down, then up`);
  const cmd = commandOf(state.pid);
  if (state.installed) {
    if (cmd.includes(APP_BIN)) ok('it is our build of the installed app'); else if (alive(state.pid)) bad(`pid ${state.pid} is something else now: ${cmd}`);
    try {
      const list = await (await fetch(`http://127.0.0.1:${state.cdpPort}/json/list`)).json();
      if (list.some((t) => t.id === state.targetId)) ok('its window answers on the debugging port'); else bad('its window is gone from the debugging port');
    } catch (err) { bad(`its debugging port does not answer: ${err.message}`); }
    const old = appIsStale();
    if (old) bad(`the installed app is ${old}, so a drive would test old code. Run: live.mjs down, then up --installed`);
    else ok('the installed app is newer than its source');
    // Opened as the Dock opens it: nothing of the session that started it.
    let envOf = '';
    try { envOf = execFileSync('ps', ['-Eww', '-o', 'command=', '-p', String(state.pid)], { encoding: 'utf8' }); } catch { /* gone */ }
    const leaked = ['TERM_PROGRAM', 'AGENTBOX_GATE_SOCK', 'CLAUDECODE', 'ZERO_ITEM', 'NVM_DIR'].filter((k) => envOf.includes(` ${k}=`));
    if (leaked.length) bad(`the installed app inherited a terminal's environment (${leaked.join(', ')}), so it is not a Dock launch`);
    else ok('it was opened with a Dock launch\'s environment');
    return wrong;
  }
  if (cmd.includes('bin/agentbox.mjs') && cmd.includes(state.data)) ok('it is our copy (bin/agentbox.mjs on our data folder)');
  else if (alive(state.pid)) bad(`pid ${state.pid} is something else now: ${cmd}`);
  try {
    const res = await fetch(state.url);
    const body = await res.text();
    if (res.ok && body.includes('<div id="root"')) ok(`the address answers with the screen (${new URL(state.url).host})`);
    else bad(`the address answered ${res.status} without the screen`);
  } catch (err) { bad(`the address does not answer: ${err.message}`); }
  const stale = screenIsStale();
  if (stale) bad(`the built screen is ${stale}, so a drive would test old code. Run: live.mjs down, then up`);
  else ok('the built screen is newer than its source');
  if (state.engine === 'stub') {
    try { fs.accessSync(state.claudeBin ?? STUB, fs.constants.X_OK); ok('the stand-in worker is executable'); } catch { bad(`the stand-in worker is not executable: ${state.claudeBin ?? STUB}`); }
  } else {
    ok('worker: the Claude Code this Mac has');
  }
  const log = fs.existsSync(state.log) ? fs.readFileSync(state.log, 'utf8') : '';
  const errors = log.split('\n').filter((l) => /\b(Error|TypeError|ReferenceError|Unhandled)\b/.test(l));
  if (errors.length) bad(`the copy's log has ${errors.length} error line(s); first: ${errors[0].slice(0, 200)}`);
  else ok('the copy\'s log has no errors');
  return wrong;
}

/**
 * Stop only what we started: the copy's process group (SIGTERM first, which is
 * a person quitting: the app stops its own workers), then anything still
 * running out of this instance's folder (a worker the group missed, the
 * scripted Codex model). Returns how many strays it had to kill.
 */
async function stopProcesses(state, { how = 'quit' } = {}) {
  if (state?.installed) {
    // The installed app: quit it as a person does, then anything still running
    // out of this checkout's build of it (its helpers).
    if (state.pid && alive(state.pid) && commandOf(state.pid).includes(APP_BIN)) {
      try { process.kill(state.pid, 'SIGTERM'); } catch { /* gone */ }
      const deadline = Date.now() + 8000;
      while (alive(state.pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    }
    const left = execFileSync('ps', ['-Ao', 'pid=,command='], { encoding: 'utf8' }).split('\n')
      .map((l) => l.trim().match(/^(\d+)\s+(.*)$/)).filter((m) => m && m[2].includes(APP));
    for (const m of left) { try { process.kill(Number(m[1]), 'SIGKILL'); } catch { /* gone */ } }
  }
  if (state?.pid && !state.installed && alive(state.pid) && commandOf(state.pid).includes(state.data)) {
    // HOW it is stopped is part of what a restart tests. 'quit' signals the
    // app alone, as ⌘Q or a restart for an update does, and the app stops its
    // own workers. 'ctrl-c' signals the whole process group at once, which is
    // what Control-C in the terminal running `npx agentbox-app` does: the
    // workers get the signal at the same moment as the app.
    if (how === 'ctrl-c') { try { process.kill(-state.pid, 'SIGINT'); } catch { /* gone */ } }
    else { try { process.kill(state.pid, 'SIGTERM'); } catch { /* gone */ } }
    const deadline = Date.now() + 5000;
    while (alive(state.pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    try { process.kill(-state.pid, 'SIGKILL'); } catch { /* gone */ }
  }
  const strays = execFileSync('ps', ['-Ao', 'pid=,command='], { encoding: 'utf8' }).split('\n')
    .map((l) => l.trim().match(/^(\d+)\s+(.*)$/)).filter((m) => m && m[2].includes(INSTANCE) && Number(m[1]) !== process.pid);
  for (const m of strays) { try { process.kill(Number(m[1]), 'SIGKILL'); } catch { /* gone */ } }
  return strays.length;
}

async function down() {
  const state = readState();
  const strays = await stopProcesses(state);
  fs.rmSync(INSTANCE, { recursive: true, force: true });
  say(state
    ? `down: stopped the copy${strays ? ` and ${strays} stray process(es)` : ''}, removed ${INSTANCE}. Evidence in ${RUNS} is kept.`
    : 'nothing to take down for this checkout.');
}

async function drive(args) {
  const { DRIVES } = await import('./drives.mjs');
  const name = args.find((a) => !a.startsWith('--'));
  if (!name || !DRIVES[name]) stop(`which drive? ${Object.keys(DRIVES).join(', ')}`, 2);
  const wrong = await doctor({ quiet: true });
  if (wrong.length) stop(`the instance is not worth driving:\n  ${wrong.join('\n  ')}`);
  if (DRIVES[name].stubOnly && readState().engine !== 'stub') {
    say(`drive ${name}: skipped on real tools (${DRIVES[name].stubOnly}).`);
    process.exit(0);
  }
  const at = args.indexOf('--out');
  const out = at >= 0 ? path.resolve(args[at + 1]) : path.join(RUNS, `${new Date().toISOString().replace(/[:.]/g, '-')}-${name}`);
  fs.mkdirSync(out, { recursive: true });
  const { openTab, connect } = await import('./cdp.mjs');
  const state = readState();
  if (DRIVES[name].notInstalled && state.installed) {
    say(`drive ${name}: skipped on the installed app (${DRIVES[name].notInstalled}).`);
    process.exit(0);
  }
  // The installed app's own window, through its debugging port; otherwise a
  // headless Chrome on the browser copy's address.
  const tab = state.installed
    ? await connect(state.browserWs, { targetId: state.targetId })
    : await openTab(state.url);
  if (state.installed) tab.goto = async () => { await tab.evaluate('location.reload()').catch(() => {}); await tab.wait(1500); };
  const claims = [];
  // `known` names the thread a product gap is filed on. The claim still runs
  // and still prints; a failure reads KNOWN instead of FAIL, so the drive stays
  // usable as a gate while the gap waits on its own fix, and a pass says the
  // marker can come off.
  const claim = (ok, sentence, evidence = '', { known = null } = {}) => {
    claims.push({ ok: !!ok, sentence, evidence, known });
    const mark = ok ? 'PASS' : known ? 'KNOWN' : 'FAIL';
    say(`  ${mark.padEnd(5)} ${sentence}${evidence ? `  (${evidence})` : ''}${!ok && known ? `  [filed: ${known}]` : ''}${ok && known ? `  [holds now: take the known marker for ${known} off]` : ''}`);
    return !!ok;
  };
  let shot = 0;
  const capture = async (label) => tab.capture(path.join(out, `${String(++shot).padStart(2, '0')}-${label}.png`));
  say(`drive ${name}: ${DRIVES[name].what}`);
  try {
    await tab.goto(state.url);
    // `live` is handed in rather than imported: a drive importing this file
    // while it is still running as the command waits on itself forever.
    // And every drive has a deadline, so a hang is a failed claim with a
    // picture, not a run that never ends (real tools get longer).
    const budget = DRIVES[name].budgetMs ?? (state.engine === 'real' ? 15 * 60_000 : 6 * 60_000);
    let timer;
    await Promise.race([
      DRIVES[name].run({ tab, state, claim, capture, out, live: { restart, readState } }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`the drive ran past its ${Math.round(budget / 60_000)} minutes`)), budget); }),
    ]).finally(() => clearTimeout(timer));
  } catch (err) {
    claim(false, `the drive finished without throwing`, String(err?.message ?? err).split('\n')[0]);
    await capture('when-it-failed').catch(() => {});
  } finally {
    claim(tab.errors.length === 0, 'the page threw no errors', tab.errors.slice(0, 3).join(' | '));
    (tab.close ?? tab.detach)();
  }
  fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify({ drive: name, at: new Date().toISOString(), engine: state.engine, claims, errors: tab.errors }, null, 1)}\n`);
  const failed = claims.filter((c) => !c.ok && !c.known).length;
  const known = claims.filter((c) => !c.ok && c.known).length;
  say(`\n${claims.length - failed - known}/${claims.length} claims held${known ? `, ${known} known gap(s)` : ''}. Evidence: ${out}`);
  if (failed) say('After a failed drive: live.mjs doctor before the next one.');
  process.exit(failed ? 1 : 0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [verb, ...args] = process.argv.slice(2);
  if (verb === 'up') await up(args);
  else if (verb === 'doctor') { const w = await doctor(); process.exit(w.length ? 1 : 0); }
  else if (verb === 'drive') await drive(args);
  else if (verb === 'down') await down();
  else if (verb === 'restart') await restart(args.includes('--ctrl-c') ? 'ctrl-c' : 'quit');
  else if (verb === 'drives') { const { DRIVES } = await import('./drives.mjs'); for (const [k, d] of Object.entries(DRIVES)) say(`${k.padEnd(20)} ${d.what}`); }
  else stop('usage: live.mjs up [--real] | doctor | drive <name> [--out dir] | restart | down | drives', 2);
}
