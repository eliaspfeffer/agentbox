// ONE CLOUD RUN, AS SEEN FROM THE MAC: A LOCAL PROCESS THAT COMPUTES ELSEWHERE.
//
// docs/cloud/PLAN.md. For a cloud run the supervisor spawns this in place of
// `claude`, with the same argv, env and cwd. To the supervisor it is a worker:
// what the agent prints arrives on stdout byte for byte, what the supervisor
// writes to stdin (the prompt, live replies, interrupts, the close at the end)
// reaches the agent in order, and it exits with the agent's exit code once the
// agent's work is back in the task folder.
//
// What it does in between:
//   1. Brings home any earlier cloud run in this folder that never came back
//      (an app that quit mid-run), before it does anything else.
//   2. Packs the task folder (its branch, main, and any uncommitted work) and
//      the files the agent will need at the same absolute paths: the settings
//      file without the Mac-only memory hooks, an MCP config whose servers are
//      the sandbox's stubs, the transcript a `--resume` needs, the account's
//      skills, commands and agents, and any file the prompt names.
//   3. Starts the sandbox, then pumps: events out (stdout, stderr, MCP lines),
//      input in (stdin, MCP replies), every input numbered and kept until the
//      sandbox has acknowledged it, so a resend after a lost reply is applied
//      once and nothing is skipped.
//   4. Runs the app's MCP servers HERE, from the original config, with the
//      worker's own environment, exactly as Claude Code would have, and joins
//      each to its stub in the sandbox. `look_at_page` is withheld: it would
//      look at this Mac's localhost, not the sandbox's.
//   5. When the sandbox reports its results uploaded, fetches them from S3 and,
//      only if the folder is exactly as it was when the run left, lays them in:
//      commits fast-forwarded, uncommitted work reapplied, transcripts
//      unpacked. Only then does the marker go.
//   6. On SIGTERM (Stop, archive, preemption, quit) it cancels the remote
//      command and still does 5, so the work and the transcript come home and
//      the app's ordinary resume can take it from there.
//
// Exit codes: the agent's own, when its work came home. 75 (EX_TEMPFAIL) when
// the agent may have finished but its work is not here; the marker stays, so
// shipping and cleanup leave the folder alone, and the app tries again.
//
// Reviewed by Codex in three rounds (2026-10-13); the rules each finding left
// behind are written where they apply.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { spawn, execFileSync } from 'node:child_process';
import { readMarker, writeMarker, clearMarker } from './marker.mjs';
import { Name, nameSlug } from '../../shared/product-name.mjs';
import { codexTranscriptFile } from '../codex-session.mjs';
import { appendCloudUsage } from './usage.mjs';

export const IMPORT_FAILED = 75;
const STUB = '/opt/agentbox/mcp-stub.mjs';
// Where the image's sandbox server listens for stubs (cloud/sandbox/server.mjs).
const BRIDGE_SOCK = '/tmp/agentbox-bridge.sock';
// The image's node, by its full path: Codex starts an MCP server with a bare
// environment, in which a bare `node` may not be found.
const SANDBOX_NODE = '/usr/local/bin/node';
const WITHHELD_TOOLS = new Set(['look_at_page']);
const MAX_ATTACHMENT = 25 * 1024 * 1024;
const RESULTS_WAIT_MS = 3 * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Where Claude Code keeps a folder's transcripts: every character that is not
// a letter or a digit becomes '-'. The supervisor's transcriptFile reads the
// same rule.
export function transcriptFolderName(cwd) { return cwd.replace(/[^a-zA-Z0-9]/g, '-'); }

export function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

function git(cwd, args, opts = {}) {
  return execFileSync('git', args, { cwd, encoding: opts.buffer ? undefined : 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024, ...opts });
}
const gitOk = (cwd, args) => { try { git(cwd, args); return true; } catch { return false; } };

// The tree the folder's files make right now, committed or not, without
// touching the branch, the index or the files.
function treeOfFolder(cwd) {
  const index = path.join(os.tmpdir(), `agentbox-cloud-index-${process.pid}-${crypto.randomUUID()}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    git(cwd, ['read-tree', 'HEAD'], { env });
    git(cwd, ['add', '-A'], { env });
    return git(cwd, ['write-tree'], { env }).trim();
  } finally {
    fs.rmSync(index, { force: true });
  }
}

// What a folder is: its branch, its commit, and its files. A cloud run's work
// is laid into a folder only if all three are still what the run left with.
export function folderState(cwd) {
  return {
    branch: git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(),
    head: git(cwd, ['rev-parse', 'HEAD']).trim(),
    tree: treeOfFolder(cwd),
    // What is staged, apart from what is on disk: a change staged and then
    // undone on disk would otherwise read as no change at all.
    index: git(cwd, ['write-tree']).trim(),
  };
}

// Commit what the folder holds that is not committed, onto its own ref,
// without touching the branch, the index or the files.
function snapshotUncommitted(cwd, ref) {
  if (!git(cwd, ['status', '--porcelain', '--untracked-files=all']).trim()) return false;
  const tree = treeOfFolder(cwd);
  const commit = git(cwd, ['-c', `user.name=${Name}`, '-c', `user.email=${nameSlug}@localhost`, 'commit-tree', tree, '-p', 'HEAD', '-m', 'Uncommitted work kept by a cloud run']).trim();
  git(cwd, ['update-ref', ref, commit]);
  return true;
}

// The remote the sandbox may fetch from: https only, never with credentials
// in it. An ssh address is turned into its https twin; anything else is left
// out, and `git fetch origin` in the sandbox simply fails, as it would offline.
export function remoteForTheCloud(url) {
  const s = String(url || '').trim();
  const ssh = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/.exec(s);
  let u;
  try { u = new URL(ssh ? `https://${ssh[1]}/${ssh[2]}` : s); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  u.username = ''; u.password = '';
  return u.toString();
}

/* ------------------------------ the launch ------------------------------- */

// The settings file the supervisor wrote, minus anything that runs a program
// on THIS Mac: the memory gate's hooks call a local script over a local socket.
export function settingsForTheCloud(text) {
  let s;
  try { s = JSON.parse(text); } catch { return text; }
  delete s.hooks;
  return JSON.stringify(s, null, 2);
}

export function mcpConfigForTheCloud(config, stubPath = STUB) {
  const servers = {};
  for (const name of Object.keys(config?.mcpServers || {})) servers[name] = { command: 'node', args: [stubPath, name], env: {} };
  return { mcpServers: servers };
}

function realOrNull(p) { try { return fs.realpathSync(p); } catch { return null; } }
const inside = (p, root) => p === root || p.startsWith(root + path.sep);

// Absolute paths a prompt names that are real files the sandbox cannot have:
// outside the task folder (which travels in the bundle), under one of the
// roots the agent is allowed to read, and not too big to send. Containment is
// decided on the RESOLVED path, after `..` and symlinks, so `<root>/../secret`
// and a link inside the root pointing out of it are both refused.
export function filesNamedIn(text, { cwd, roots }) {
  const realRoots = roots.map(realOrNull).filter(Boolean);
  const realCwd = realOrNull(cwd) || cwd;
  const found = new Set();
  for (const m of String(text || '').matchAll(/(\/(?:[^\s"'`<>()\[\]{},;\\]|\\ )+)/g)) {
    const named = m[1].replace(/[.:]+$/, '');
    const real = realOrNull(named);
    if (!real) continue;
    if (inside(real, realCwd)) continue;
    if (!realRoots.some((r) => inside(real, r))) continue;
    try {
      const st = fs.statSync(real);
      if (st.isFile() && st.size <= MAX_ATTACHMENT) found.add(named);
    } catch { /* not a file */ }
  }
  return [...found];
}

function tarOf(dir) {
  return execFileSync('tar', ['-czf', '-', '-C', dir, '-h', '.'], { maxBuffer: 512 * 1024 * 1024 });
}

/* -------------------------------- the run -------------------------------- */

export async function cloudRun({
  argv, env = process.env, cwd,
  transport, storage,
  claudeToken,
  stdin = process.stdin, stdout = process.stdout, stderr = process.stderr,
  remoteCommand = 'claude',
  homeDir = os.homedir(),
  pollWaitMs = 20_000,
  resultsWaitMs = RESULTS_WAIT_MS,
  watchParent = true,
  stubPath = STUB,
  signals = process,
  // Only bring an earlier run home, and start nothing: what the supervisor
  // runs for a folder whose cloud work is still outstanding.
  importOnly = false,
  // 'claude' or 'codex'. A Codex run is `codex app-server` in the sandbox,
  // spoken to over stdin/stdout by the supervisor's own Codex client.
  engine = 'claude',
  // The Codex sign-in to send up (main/cloud/config.mjs codexCloudAuth): a
  // copy of auth.json that cannot renew itself.
  codexAuth = null,
}) {
  const say = (msg) => stderr.write(`agentbox cloud: ${msg}\n`);
  const codex = engine === 'codex';
  const configDir = env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude');
  const codexHome = env.CODEX_HOME || path.join(homeDir, '.codex');
  const projectsFor = (dir) => path.join(dir || configDir, 'projects', transcriptFolderName(cwd));
  const projectsDir = projectsFor(configDir);
  // WHAT COMES HOME BESIDES THE FOLDER: the conversation, wherever the
  // harness keeps it. Claude Code: this folder's transcripts under the
  // account. Codex: its sessions folder, which in the sandbox holds only
  // what this run wrote (and the one rollout a resume sent up).
  const bringDirs = codex
    ? [{ name: 'sessions.tgz', dir: path.join(codexHome, 'sessions') }]
    : [{ name: 'projects.tgz', dir: projectsDir }];
  const keyOf = (runId, name) => `runs/${runId}/${name}`;
  // The links a run uploads its results to. The folders are the RUN's, which
  // for a run being brought home are the ones its marker names, not whichever
  // account this process happens to have been started for.
  const resultUrls = async (runId, dirs = bringDirs) => ({
    bundleUrl: await storage.putUrl(keyOf(runId, 'out.bundle')),
    changesUrl: await storage.putUrl(keyOf(runId, 'changes.bundle')),
    eventsUrl: await storage.putUrl(keyOf(runId, 'events.jsonl')),
    doneUrl: await storage.putUrl(keyOf(runId, 'done.json')),
    bring: await Promise.all(dirs.map(async (b) => ({ dir: b.dir, url: await storage.putUrl(keyOf(runId, b.name)) }))),
  });
  // A marker written before Codex runs existed names its account folder only.
  const dirsOf = (rec) => rec.bringDirs || [{ name: 'projects.tgz', dir: projectsFor(rec.configDir) }];

  // 1. An earlier run that never came home comes home first.
  const earlier = readMarker(cwd);
  if (earlier) {
    const back = await bringHome(earlier, { recovering: true });
    if (!back.ok) { say(`an earlier cloud run in this folder could not be brought back yet (${back.why}); not starting another`); return IMPORT_FAILED; }
  }
  if (importOnly) return 0;

  const runId = crypto.randomUUID();
  const sessionId = `agentbox-${(env.ZERO_ITEM || 'run').replace(/[^a-zA-Z0-9-]/g, '')}-${runId}`;
  const key = (name) => keyOf(runId, name);

  // 2. The pack.
  const sent = folderState(cwd);
  const { branch, head: startSha } = sent;
  if (!branch || branch === 'HEAD') { say('the task folder is not on a branch'); return 1; }
  const outgoing = `refs/agentbox/outgoing/${runId}`;
  const hasOutgoing = snapshotUncommitted(cwd, outgoing);
  const refs = [`refs/heads/${branch}`];
  if (hasOutgoing) refs.push(outgoing);
  for (const r of ['refs/heads/main', 'refs/remotes/origin/main']) if (r !== `refs/heads/${branch}` && gitOk(cwd, ['rev-parse', '--verify', '-q', r])) refs.push(r);
  const bundleFile = path.join(os.tmpdir(), `agentbox-cloud-${runId}.bundle`);
  try {
    git(cwd, ['bundle', 'create', '-q', bundleFile, ...refs]);
    await storage.put(key('in.bundle'), fs.readFileSync(bundleFile));
  } finally {
    fs.rmSync(bundleFile, { force: true });
    if (hasOutgoing) gitOk(cwd, ['update-ref', '-d', outgoing]);
  }

  const files = [];
  let fileCount = 0;
  const sendFile = async (localPath, remotePath = localPath, body = null, untar = null) => {
    fileCount += 1;
    const k = key(`files/${fileCount}`);
    await storage.put(k, body ?? fs.readFileSync(localPath));
    return { path: remotePath, url: await storage.getUrl(k), ...(untar ? { untar } : {}) };
  };
  const settingsPath = argValue(argv, '--settings');
  if (settingsPath && fs.existsSync(settingsPath)) files.push(await sendFile(settingsPath, settingsPath, Buffer.from(settingsForTheCloud(fs.readFileSync(settingsPath, 'utf8')))));
  const mcpPath = argValue(argv, '--mcp-config');
  let mcpConfig = { mcpServers: {} };
  if (mcpPath && fs.existsSync(mcpPath)) {
    mcpConfig = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    files.push(await sendFile(mcpPath, mcpPath, Buffer.from(JSON.stringify(mcpConfigForTheCloud(mcpConfig, stubPath)))));
  }
  const resumeId = argValue(argv, '--resume');
  if (resumeId) {
    const t = path.join(projectsDir, `${resumeId}.jsonl`);
    if (fs.existsSync(t)) files.push(await sendFile(t));
    else say(`no transcript for ${resumeId} on this Mac; the cloud run starts without it`);
  }
  // The account's own skills, commands and agents, as real folders.
  if (!codex) {
    const tooling = path.join(homeDir, '.claude');
    for (const sub of ['skills', 'commands', 'agents']) {
      const dir = fs.existsSync(path.join(configDir, sub)) ? path.join(configDir, sub) : path.join(tooling, sub);
      if (fs.existsSync(dir)) files.push(await sendFile(null, path.join(configDir, `.${sub}.tgz`), tarOf(dir), path.join(configDir, sub)));
    }
  }
  // Codex's sign-in, as a copy that cannot renew itself (config.mjs), and the
  // few settings that change how it runs a turn (model, effort, tier), so a
  // run in the cloud behaves as one here would. Nothing else of her config
  // goes: no MCP servers, hooks, providers or sockets.
  if (codex) {
    if (!codexAuth) { say('this Codex login cannot go to the cloud right now'); return 1; }
    files.push(await sendFile(null, path.join(codexHome, 'auth.json'), Buffer.from(codexAuth)));
    let toml = '';
    try { toml = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8'); } catch { /* none */ }
    files.push(await sendFile(null, path.join(codexHome, 'config.toml'), Buffer.from(codexConfigForTheCloud(toml))));
  }
  const roots = [env.AGENTBOX_HOME, env.ZERO_STORE_ROOT, env.STORE_HOME].filter(Boolean).map((r) => path.resolve(r));
  const system = argValue(argv, '--append-system-prompt') || '';
  for (const f of filesNamedIn(system, { cwd, roots })) files.push(await sendFile(f));
  const sentFiles = new Set(files.map((f) => f.path));

  const results = await resultUrls(runId);
  let remote = null;
  try { remote = remoteForTheCloud(git(cwd, ['remote', 'get-url', 'origin']).trim()); } catch { /* no origin */ }

  const remoteEnv = {
    ...(codex ? { CODEX_HOME: codexHome } : { CLAUDE_CONFIG_DIR: configDir }),
    MCP_TOOL_TIMEOUT: String(8 * 60 * 60 * 1000),
    DISABLE_AUTOUPDATER: '1',
    ...(env.ZERO_PRODUCT ? { ZERO_PRODUCT: env.ZERO_PRODUCT } : {}),
    ...(env.ZERO_ITEM ? { ZERO_ITEM: env.ZERO_ITEM } : {}),
    ...gitIdentity(cwd),
    ...(claudeToken ? { CLAUDE_CODE_OAUTH_TOKEN: claudeToken } : {}),
  };

  const marker = { runId, sessionId, branch, startSha, sent, configDir, engine, bringDirs };
  writeMarker(cwd, { ...marker, pid: process.pid, state: 'starting' });

  // 3. Start. Starting the same run twice is answered "already", so a start
  // whose reply was lost is simply asked again. A start that was REFUSED
  // started nothing; one whose answer never came may have, so its marker
  // stays and the next run in this folder finds out which.
  const bundleUrl = await storage.getUrl(key('in.bundle'));
  const started = await retry(() => transport.invoke(sessionId, {
    action: 'start', runId, cwd, branch, bundleUrl,
    argv: [remoteCommand, ...argv], env: remoteEnv, files,
    changesRef: hasOutgoing ? outgoing : undefined,
    ...(remote ? { remote } : {}),
    results,
  }), { what: 'start the cloud run', forever: false });
  if (!started) {
    writeMarker(cwd, { ...marker, pid: null, state: 'start-unknown' });
    say('the cloud did not answer the start; whether it began will be checked before the next run here');
    return IMPORT_FAILED;
  }
  if (!started.ok) {
    say(`the cloud run could not start: ${started.error || 'no answer'} ${started.message || ''}`.trim());
    clearMarker(cwd);
    return 1;
  }
  writeMarker(cwd, { ...marker, pid: process.pid, state: 'running' });

  // 4. The pump.
  let cursor = 0;
  let n = 0;
  let cancelled = false;
  let cancelledAt = 0;
  let finished = null; // 'collected' | 'collect-failed' | 'failed' | 'lost'
  const servers = new Map(); // conn -> { proc, name, listIds }
  const outbox = [];
  let wake = null;
  const enqueue = (msg) => { outbox.push(msg); wake?.(); };
  const overdue = () => cancelled && Date.now() - cancelledAt > resultsWaitMs;

  // ONE INPUT AT A TIME, KEPT UNTIL ACKNOWLEDGED. Each gets its number once,
  // and is sent again with that same number until the sandbox has applied it
  // (or says it was consumed with nothing to apply it to). A gap means the two
  // sides disagree about what was sent, which nothing can repair: the run is
  // stopped rather than left talking past itself.
  const sender = (async () => {
    for (;;) {
      if (!outbox.length) {
        if (finished) return;
        await new Promise((r) => { wake = r; setTimeout(r, 1000); });
        wake = null;
        continue;
      }
      const msg = outbox[0];
      if (msg.action === 'files' && !msg.files) {
        // An attachment that cannot be uploaded is left out and said so; the
        // prompt behind it still goes, rather than everything stopping here.
        const list = [];
        for (const f of msg.paths) {
          if (sentFiles.has(f)) continue;
          const sentOne = await retry(() => sendFile(f), { what: `send ${path.basename(f)}`, forever: false, stop: () => !!finished });
          if (sentOne) { list.push(sentOne); sentFiles.add(f); } else say(`${f} could not be sent to the cloud run; it goes on without it`);
        }
        if (!list.length) { outbox.shift(); continue; }
        msg.files = list;
      }
      if (msg.n === undefined) { n += 1; msg.n = n; }
      const { paths: _p, ...payload } = msg;
      let failures = 0;
      for (;;) {
        const res = await retry(() => transport.invoke(sessionId, { ...payload, runId }), { what: msg.action, forever: true, stop: () => !!finished || overdue() });
        if (!res) return;
        if (res.ok || res.dup || res.consumed) break;
        if (res.error === 'no-run') return;
        if (res.error === 'gap') { say(`the sandbox and this Mac disagree about what was sent (it expected ${res.expect}, this was ${msg.n}); stopping the run`); outbox.length = 0; cancel('input out of step'); return; }
        failures += 1;
        if (failures >= 5) { say(`could not ${msg.action} after 5 tries (${res.error} ${res.message || ''}); stopping the run`); outbox.length = 0; cancel('input refused'); return; }
        await sleep(1000 * failures);
      }
      outbox.shift();
    }
  })().catch((err) => say(`the input to the cloud run stopped: ${err.message}`));

  // Stdin: the supervisor's stream-json lines, in order, each preceded by the
  // files it names. Decoded as one stream, so a character split across two
  // chunks is never broken.
  const inDecoder = new StringDecoder('utf8');
  let stdinBuf = '';
  stdin.on('data', (d) => {
    stdinBuf += typeof d === 'string' ? d : inDecoder.write(d);
    let i;
    while ((i = stdinBuf.indexOf('\n')) >= 0) {
      let line = stdinBuf.slice(0, i + 1);
      stdinBuf = stdinBuf.slice(i + 1);
      const named = filesNamedIn(line, { cwd, roots });
      if (codex) {
        const c = codexLineForTheCloud(line, { stubPath, codexHome, keep: mcpConfig.mcpServers });
        line = c.line;
        named.push(...c.files.filter((f) => !named.includes(f)));
      }
      if (named.length) enqueue({ action: 'files', paths: named });
      enqueue({ action: 'stdin', data: Buffer.from(line).toString('base64') });
    }
  });
  stdin.on('end', () => {
    stdinBuf += inDecoder.end();
    if (stdinBuf) enqueue({ action: 'stdin', data: Buffer.from(stdinBuf).toString('base64') });
    enqueue({ action: 'stdin', end: true });
  });

  function openServer(conn, name) {
    const cfg = mcpConfig.mcpServers?.[name];
    if (!cfg) { enqueue({ action: 'mcp-close', conn }); return; }
    const proc = spawn(cfg.command, cfg.args || [], { cwd, env: toolEnv({ ...env, ...(cfg.env || {}) }), stdio: ['pipe', 'pipe', 'pipe'] });
    const s = { proc, name, listIds: new Set(), buf: '', closed: false };
    servers.set(conn, s);
    const closeOnce = () => { if (s.closed) return; s.closed = true; if (servers.get(conn) === s) servers.delete(conn); enqueue({ action: 'mcp-close', conn }); };
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (d) => {
      s.buf += d;
      let i;
      while ((i = s.buf.indexOf('\n')) >= 0) {
        const line = s.buf.slice(0, i);
        s.buf = s.buf.slice(i + 1);
        enqueue({ action: 'mcp', conn, line: withholdFromList(line, s.listIds) });
      }
    });
    proc.stderr.on('data', (d) => stderr.write(d));
    proc.stdin.on('error', () => {});
    // `close`, after its stdout has ended, so the server's last reply is
    // queued before the stub is told it has gone.
    proc.on('close', closeOnce);
    proc.on('error', (err) => { say(`the ${name} server could not run here: ${err.message}`); closeOnce(); });
  }

  function toServer(conn, line) {
    const s = servers.get(conn);
    if (!s) return;
    let msg = null;
    try { msg = JSON.parse(line); } catch { /* pass through as is */ }
    if (msg?.method === 'tools/list' && msg.id !== undefined) s.listIds.add(msg.id);
    if (msg?.method === 'tools/call' && WITHHELD_TOOLS.has(msg.params?.name)) {
      enqueue({ action: 'mcp', conn, line: JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [{ type: 'text', text: `${msg.params.name} is not available to a cloud run: it would look at the Mac's own pages, not the sandbox's.` }] } }) });
      return;
    }
    s.proc.stdin.write(line + '\n');
  }

  async function write(stream, buf) {
    if (!stream.write(buf)) await new Promise((r) => stream.once('drain', r));
  }

  async function absorb(e) {
    if (e.seq <= cursor) return;
    cursor = e.seq;
    // AGENTBOX_CLOUD_DEBUG=1 traces the tool traffic, names and sizes only.
    if (env.AGENTBOX_CLOUD_DEBUG && e.kind.startsWith('mcp')) say(`${e.kind} ${e.conn}${e.server ? ` ${e.server}` : ''}${e.line ? ` ${String(e.line).slice(0, 80)}` : ''}`);
    if (e.kind === 'stdout') await write(stdout, Buffer.from(e.data, 'base64'));
    else if (e.kind === 'stderr') await write(stderr, Buffer.from(e.data, 'base64'));
    else if (e.kind === 'mcp-open') openServer(e.conn, e.server);
    else if (e.kind === 'mcp') toServer(e.conn, e.line);
    else if (e.kind === 'mcp-close') { const s = servers.get(e.conn); servers.delete(e.conn); if (s) { s.closed = true; s.proc.stdin.end(); setTimeout(() => s.proc.kill(), 2000); } }
    else if (e.kind === 'error') say(e.message);
    else if (e.kind === 'state' && ['collected', 'collect-failed', 'failed'].includes(e.state)) finished = e.state;
  }

  function cancel(why) {
    if (cancelled || finished) return;
    cancelled = true;
    cancelledAt = Date.now();
    say(`stopping the cloud run (${why})`);
    retry(() => transport.invoke(sessionId, { action: 'signal', runId, signal: 'SIGTERM' }), { what: 'stop the cloud run', forever: false }).catch(() => {});
  }
  const onTerm = () => cancel('asked to stop');
  signals.on('SIGTERM', onTerm);
  signals.on('SIGINT', onTerm);
  const parentWatch = watchParent ? setInterval(() => { if (process.ppid === 1) cancel('the app is gone'); }, 5000) : null;

  try {
    while (!finished) {
      if (overdue()) { finished = 'lost'; break; }
      // Abandoned, not retried forever, once a cancel has waited long enough:
      // a Stop must end even when AWS cannot be reached.
      const page = await retry(() => transport.invoke(sessionId, { action: 'events', runId, since: cursor, waitMs: pollWaitMs }), { what: 'read the cloud run', forever: true, stop: overdue });
      if (!page) continue;
      if (!page.ok && page.error === 'no-run') { finished = 'lost'; break; }
      for (const e of page.events || []) await absorb(e);
    }
  } finally {
    signals.off('SIGTERM', onTerm);
    signals.off('SIGINT', onTerm);
    if (parentWatch) clearInterval(parentWatch);
  }

  // A collect that failed in the sandbox is asked once more, with fresh links.
  if (finished === 'collect-failed') {
    const again = await retry(async () => transport.invoke(sessionId, { action: 'collect', runId, ...(await resultUrls(runId)) }), { what: 'collect the results', forever: false });
    if (again?.ok) finished = 'collected';
  }
  wake?.();
  await sender;
  for (const s of servers.values()) { s.closed = true; s.proc.stdin.end(); s.proc.kill(); }

  if (finished === 'failed') { clearMarker(cwd); return 1; }
  const back = await bringHome({ ...marker }, { cursor, replay: (e) => absorb(e) });
  if (!back.ok) {
    say(`the cloud run's work could not be brought back (${back.why}); it is kept in the cloud for 7 days and will be tried again`);
    writeMarker(cwd, { ...marker, pid: null, state: back.state || 'import-failed' });
    return IMPORT_FAILED;
  }
  return exitCodeOf(back.record);

  /* --------------------------- bringing it home -------------------------- */
  // Never throws: every failure is an answer, { ok: false, why }, and the
  // marker stays, because a run whose work is not here is not finished here.
  async function bringHome(rec, { recovering = false, cursor: from = 0, replay = null } = {}) {
    try {
      return await bringHomeOnce(rec, { recovering, from, replay });
    } catch (err) {
      return { ok: false, why: String(err?.message || err).split('\n')[0] };
    }
  }

  async function bringHomeOnce(rec, { recovering, from, replay }) {
    const k = (name) => keyOf(rec.runId, name);
    if (rec.state === 'diverged') return { ok: false, state: 'diverged', why: rec.why || 'it needs a person to look at it' };
    let done = await storage.get(k('done.json'));
    if (!done && recovering) {
      if (rec.pid && rec.pid !== process.pid && alive(rec.pid)) return { ok: false, why: 'its own process is still bringing it back' };
      // Ask the sandbox where the run stands. No answer is not an answer: the
      // run may be alive, so nothing is given up.
      const st = await retry(() => transport.invoke(rec.sessionId, { action: 'status', runId: rec.runId }), { what: 'reach the earlier run', forever: false });
      if (!st) return { ok: false, why: 'the cloud could not be reached' };
      if (st.state === 'none' || st.error === 'no-run') {
        // The session holds no run: it ended, and AgentCore has just made a
        // fresh one for this id by being asked. Let that one go, and look for
        // the results one last time; without them the run is gone for good.
        await transport.stop?.(rec.sessionId).catch(() => {});
        done = await storage.get(k('done.json'));
        if (!done) {
          clearMarker(cwd);
          say('an earlier cloud run in this folder ended without its results; its work is lost');
          return { ok: true, exitCode: null, lost: true };
        }
      } else {
        if (st.state === 'preparing' || st.state === 'running') {
          await retry(() => transport.invoke(rec.sessionId, { action: 'signal', runId: rec.runId, signal: 'SIGTERM' }), { what: 'stop the earlier run', forever: false });
        }
        const until = Date.now() + resultsWaitMs;
        let asked = false;
        while (!done && Date.now() < until) {
          const now = await retry(() => transport.invoke(rec.sessionId, { action: 'status', runId: rec.runId }), { what: 'watch the earlier run', forever: false });
          if (!asked && (now?.state === 'exited' || now?.state === 'collect-failed')) {
            // Finished but never uploaded (or its links ran out): fresh links.
            asked = true;
            await retry(async () => transport.invoke(rec.sessionId, { action: 'collect', runId: rec.runId, ...(await resultUrls(rec.runId, dirsOf(rec))) }), { what: 'collect the earlier run', forever: false });
          }
          done = await storage.get(k('done.json'));
          if (!done) await sleep(3000);
        }
        if (!done) return { ok: false, why: 'its results have not arrived yet' };
      }
    }
    if (!done) return { ok: false, why: 'its results never arrived' };
    const record = JSON.parse(done.toString('utf8'));
    // WHAT THE RUN USED, for setting the plan limits from real work
    // (main/cloud/usage.mjs). Recorded as soon as its results are here,
    // whatever laying them into the folder does next: the machine ran either
    // way. Once per run, however many times this is tried.
    appendCloudUsage({ runId: rec.runId, item: env.ZERO_ITEM, engine: rec.engine || engine, exitCode: record.exitCode, usage: record.usage }, { home: homeDir });

    // Anything the stream never delivered (the session was gone before the
    // Mac could read it) is replayed from the copy in S3.
    if (replay) {
      const log = await storage.get(k('events.jsonl'));
      for (const l of (log ? log.toString('utf8').split('\n') : [])) {
        if (!l) continue;
        const e = JSON.parse(l);
        if (e.seq > from && (e.kind === 'stdout' || e.kind === 'stderr')) await replay(e);
      }
    }

    // EVERYTHING IS FETCHED BEFORE ANYTHING IN THE FOLDER IS TOUCHED. An import
    // that moved the branch and then failed to download the rest would leave a
    // folder that no longer matches what the run left with, and its own retry
    // would read that as somebody else's work (Codex, 2026-10-13). So: the
    // commits into refs, the uncommitted work into a ref, the transcripts into
    // memory, and only then, with nothing left that can be missing, the folder.
    const keep = `refs/agentbox/cloud/${rec.runId}`;
    const keepChanges = `refs/agentbox/cloud-changes/${rec.runId}`;
    const fetchBundle = async (name, specs, why) => {
      const b = await storage.get(k(name));
      if (!b) throw new Error(why);
      const f = path.join(os.tmpdir(), `agentbox-cloud-${name}-${rec.runId}`);
      fs.writeFileSync(f, b);
      try { git(cwd, ['fetch', '-q', f, ...specs]); } finally { fs.rmSync(f, { force: true }); }
    };
    if (record.commits > 0 || record.strayHead) {
      const specs = [];
      if (record.commits > 0) specs.push(`refs/heads/${rec.branch}:${keep}`);
      if (record.strayHead) specs.push(`refs/agentbox/head:${keep}-head`);
      await fetchBundle('out.bundle', specs, 'the commits bundle is missing');
    }
    if (record.uncommitted) await fetchBundle('changes.bundle', [`refs/agentbox/changes:${keepChanges}`], 'the uncommitted work is missing');
    // The conversation's folders, each one the run said it uploaded.
    const conversations = [];
    for (const b of dirsOf(rec)) {
      const tgz = await storage.get(k(b.name));
      if (tgz) conversations.push({ dir: b.dir, tgz });
      else if ((record.brought || []).includes(b.dir)) return { ok: false, why: 'the transcript is missing' };
    }

    // THE FOLDER MUST BE EXACTLY AS THE RUN LEFT IT: same branch, same commit,
    // same files, same staged changes. Anything else means something on this
    // Mac worked in it while the run was away, and laying the run's state over
    // it would undo that.
    if (rec.sent) {
      const now = folderState(cwd);
      if (now.branch !== rec.sent.branch || now.head !== rec.sent.head || now.tree !== rec.sent.tree || (rec.sent.index && now.index !== rec.sent.index)) {
        return { ok: false, state: 'diverged', why: `this folder changed on this Mac while the run was in the cloud; the run's commits are kept on ${keep}` };
      }
    }
    // And the agent must have ended on the branch it was given.
    if (record.strayHead || (record.headRef && record.headRef !== rec.branch)) {
      return { ok: false, state: 'diverged', why: `the agent finished on ${record.headRef || 'a detached commit'} instead of ${rec.branch}; its work is kept on ${keep}-head` };
    }

    // The folder is put back exactly as the run left it. What it held when the
    // run began went up with it and comes back in the run's own state; a copy
    // of the files AND of what was staged is set aside first anyway, under
    // names no later run reuses.
    const stamp = `${rec.runId}-${Date.now()}`;
    snapshotUncommitted(cwd, `refs/agentbox/before-cloud/${stamp}`);
    const stagedTree = git(cwd, ['write-tree']).trim();
    const stagedCommit = git(cwd, ['-c', `user.name=${Name}`, '-c', `user.email=${nameSlug}@localhost`, 'commit-tree', stagedTree, '-p', 'HEAD', '-m', 'What was staged before a cloud run came home']).trim();
    git(cwd, ['update-ref', `refs/agentbox/before-cloud/${stamp}-staged`, stagedCommit]);
    try {
      git(cwd, ['reset', '-q', '--hard', 'HEAD']);
      git(cwd, ['clean', '-q', '-fd']);
      if (record.commits > 0) git(cwd, ['merge', '-q', '--ff-only', keep]);
      if (record.uncommitted) {
        const patch = git(cwd, ['diff', '--binary', 'HEAD', keepChanges], { buffer: true });
        if (patch.length) git(cwd, ['apply', '--whitespace=nowarn'], { input: patch });
      }
      for (const c of conversations) {
        fs.mkdirSync(c.dir, { recursive: true });
        execFileSync('tar', ['-xzf', '-', '-C', c.dir], { input: c.tgz });
      }
    } catch (err) {
      // Every download had already landed, so this is git itself refusing;
      // nothing a retry would change. A person looks, with everything kept.
      return { ok: false, state: 'diverged', why: `laying the run into the folder failed (${String(err.message).split('\n')[0]}); the earlier state is on refs/agentbox/before-cloud/${stamp} and the run's on ${keep}` };
    }
    gitOk(cwd, ['update-ref', '-d', keepChanges]);
    if (record.commits > 0) gitOk(cwd, ['update-ref', '-d', keep]);
    clearMarker(cwd);
    return { ok: true, exitCode: record.exitCode, record };
  }

  // Calls that throw (network, AWS) are retried with backoff; `forever` for
  // the ones a run cannot do without, bounded otherwise; `stop` ends either.
  // Returns null when it gave up, never throws.
  async function retry(fn, { what, forever = false, stop = () => false }) {
    let delay = 500;
    for (let i = 0; ; i += 1) {
      try { return await fn(); } catch (err) {
        if (stop()) return null;
        if (!forever && i >= 5) { say(`could not ${what}: ${err.message}`); return null; }
        if (i === 3) say(`still trying to ${what} (${err.message})`);
        await sleep(delay);
        delay = Math.min(delay * 2, 30_000);
        if (stop()) return null;
      }
    }
  }
}

// ONE LINE FROM THE SUPERVISOR'S CODEX CLIENT, MADE READY FOR THE SANDBOX.
//
// Codex is told its MCP servers inside `thread/start` and `thread/resume`
// (`config.mcp_servers`), not on a command line. Each server that has a
// command (the store; her own come switched off, `{ enabled: false }`, and
// pass untouched) is swapped for the sandbox's stub, and the original is kept
// in `keep` to run here when the stub calls. A `thread/resume` also names the
// one file Codex will need to find that thread: its rollout, sent up first.
// Any other line, or one that is not JSON, passes exactly as it came.
export function codexLineForTheCloud(line, { stubPath = STUB, codexHome, keep, findRollout = codexTranscriptFile }) {
  let msg;
  try { msg = JSON.parse(line); } catch { return { line, files: [] }; }
  // A picture rides in a turn as `localImage` with a path on this Mac; the
  // file goes up first, at that same path (Codex's review, finding 5).
  if (msg?.method === 'turn/start' || msg?.method === 'turn/steer') {
    const files = (Array.isArray(msg.params?.input) ? msg.params.input : [])
      .filter((i) => i && i.type === 'localImage' && typeof i.path === 'string' && path.isAbsolute(i.path))
      .map((i) => i.path);
    return { line, files };
  }
  if (msg?.method !== 'thread/start' && msg?.method !== 'thread/resume') return { line, files: [] };
  const files = [];
  const servers = msg.params?.config?.mcp_servers;
  if (servers && typeof servers === 'object') {
    for (const name of Object.keys(servers)) {
      const s = servers[name];
      if (!s || typeof s !== 'object' || !s.command) continue;
      keep[name] = { command: s.command, args: s.args || [], env: s.env || {} };
      // Codex starts an MCP server with a bare environment, so the stub is
      // told where the sandbox's bridge is in its own entry (measured
      // 2026-10-13: without it the stub never connected).
      servers[name] = { ...s, command: SANDBOX_NODE, args: [stubPath, name], env: { AGENTBOX_BRIDGE_SOCK: BRIDGE_SOCK } };
    }
  }
  // THE CLOUD MACHINE IS CODEX'S SANDBOX (her decision, 2026-10-13: "Yes, let
  // the cloud machine be Codex's sandbox"). Codex's own command sandbox
  // (bubblewrap) cannot nest inside an AgentCore microVM: measured that day,
  // every write and every command was refused ("bwrap: Can't mkdir parents
  // ... Permission denied"). OpenAI's docs say to use full access inside a
  // container or VM, which is then the boundary. This one holds only the
  // task's folder and a Codex sign-in that cannot renew, and is thrown away
  // after the run. A read-only run stays read-only; approvals are untouched.
  if (msg.params && msg.params.sandbox === 'workspace-write') msg.params.sandbox = 'danger-full-access';
  if (msg.method === 'thread/resume' && msg.params?.threadId) {
    const rollout = findRollout(msg.params.threadId, { home: codexHome });
    if (rollout) files.push(rollout);
  }
  return { line: JSON.stringify(msg) + (line.endsWith('\n') ? '\n' : ''), files };
}

// THE PART OF HER CODEX CONFIG A CLOUD RUN TAKES: the top-level model, effort
// and service tier, each a plain quoted string, and nothing else. Read by
// line rather than by a TOML parser because only these three are wanted, and
// anything that is not exactly `key = "value"` before the first [section] is
// left behind rather than guessed at.
const CODEX_SETTINGS = new Set(['model', 'model_reasoning_effort', 'service_tier']);
export function codexConfigForTheCloud(toml) {
  const out = [];
  for (const raw of String(toml || '').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) break;
    const m = /^([A-Za-z_]+)\s*=\s*"([^"\\\n]*)"\s*(#.*)?$/.exec(line);
    if (m && CODEX_SETTINGS.has(m[1])) out.push(`${m[1]} = "${m[2]}"`);
  }
  return out.join('\n') + (out.length ? '\n' : '');
}

// THE ENVIRONMENT THE APP'S OWN TOOLS RUN IN, HERE. The worker's, as Claude
// Code would have given it, minus anything that signs in to AWS: this process
// signs as the cloud runs' own AWS user, and an app started from a shell that
// was signed in to AWS would otherwise hand that sign-in to every tool.
export function toolEnv(env) {
  const out = { ...env };
  for (const k of Object.keys(out)) {
    if (/^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|SECURITY_TOKEN|PROFILE|DEFAULT_PROFILE|CREDENTIAL_EXPIRATION|WEB_IDENTITY_TOKEN_FILE|ROLE_ARN)$/.test(k)) delete out[k];
    if (k === 'CLAUDE_CODE_OAUTH_TOKEN') delete out[k];
  }
  return out;
}

// The remote command's exit, as one number: its own code, or for a command a
// signal ended, 128 plus the signal's number, the way a shell reports it.
export function exitCodeOf(record) {
  if (Number.isInteger(record?.exitCode)) return record.exitCode;
  const num = record?.exitSignal ? os.constants.signals[record.exitSignal] : null;
  return num ? 128 + num : 1;
}

// Drop withheld tools from a server's answer to `tools/list`.
function withholdFromList(line, listIds) {
  let msg;
  try { msg = JSON.parse(line); } catch { return line; }
  if (msg?.id === undefined || !listIds.has(msg.id) || !Array.isArray(msg.result?.tools)) return line;
  listIds.delete(msg.id);
  msg.result.tools = msg.result.tools.filter((t) => !WITHHELD_TOOLS.has(t.name));
  return JSON.stringify(msg);
}

function gitIdentity(cwd) {
  const get = (k) => { try { return execFileSync('git', ['config', k], { cwd, encoding: 'utf8' }).trim(); } catch { return ''; } };
  const name = get('user.name'); const email = get('user.email');
  return {
    ...(name ? { GIT_AUTHOR_NAME: name, GIT_COMMITTER_NAME: name } : {}),
    ...(email ? { GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_EMAIL: email } : {}),
  };
}

function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
