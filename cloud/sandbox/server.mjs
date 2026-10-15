// THE SANDBOX'S ONE SERVER: A PLAIN REMOTE COMPUTER FOR ONE RUN.
//
// Cloud runs (docs/cloud/PLAN.md) put a thread's agent in an AWS AgentCore
// microVM. This is the only program of ours inside it. It knows nothing about
// Claude Code, the store or approvals: it is handed a git bundle, a folder
// path, a command and an environment, and it runs the command there.
// Everything the command prints is numbered and written to disk, so the Mac
// can read it over a connection that drops (the lid closes, the app restarts)
// and pick up from the last number it saw. The app's tools travel through it
// as raw lines (see "THE BRIDGE"), so a new tool costs this file nothing.
//
// AgentCore's contract: HTTP on :8080, POST /invocations and GET /ping, an
// arm64 image. A session that answers "Healthy" for 15 minutes is reaped, so
// /ping says "HealthyBusy" from the moment a run starts until its results are
// safely uploaded, however long ago the command itself exited.
//
// The rules this file keeps, each one a way a cloud run was found to go wrong
// in review (Codex, two rounds, 2026-10-13):
//   - Results leave by themselves when the command exits, to presigned URLs
//     the Mac gave at the start, so a Mac that is asleep loses nothing, and
//     `done.json` goes last, so its presence means everything else is there.
//   - Input is numbered. A stdin write or a tool reply the Mac sends twice,
//     because the first answer was lost, is applied once.
//   - Cancelling is latched: a cancel that arrives while the run is still
//     being prepared stops it from ever starting, and a cancel kills the
//     command's whole process group, with SIGKILL after a grace period.
//   - The event log lives on disk, and a poll returns a page bounded by bytes,
//     well under AgentCore's 100 MB response limit.
//   - A run near AgentCore's 8-hour ceiling is stopped and its work uploaded
//     before the ceiling stops it with nothing saved.
//
// One run per microVM, which is what AgentCore gives a session anyway.

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { usageMeter } from './usage.mjs';

// One stdout event at most this many bytes of output.
const CHUNK = 48 * 1024;
// One poll returns at most this many bytes of events.
const PAGE_BYTES = 8 * 1024 * 1024;
// A single MCP line from the harness larger than this is refused.
const MAX_MCP_LINE = 32 * 1024 * 1024;
// How long a cancelled command gets before its group is killed outright.
const KILL_GRACE_MS = 15_000;
// AgentCore ends a session at 8 hours; stop the command a quarter hour before.
const DEFAULT_DEADLINE_MS = (8 * 60 - 15) * 60_000;

const DONE_STATES = new Set(['collected', 'failed']);

export function createSandbox({
  workRoot = '/tmp',
  bridgeSocket = path.join(process.env.TMPDIR || '/tmp', `agentbox-bridge-${process.pid}.sock`),
  baseEnv = pickBaseEnv(process.env),
  fetchImpl = globalThis.fetch,
  uploadRetryMs = 5_000,
  killGraceMs = KILL_GRACE_MS,
  // FOR TESTS ONLY: a test runs the "sandbox" on the same machine as the
  // "Mac", so the paths a run names would land on top of the Mac's own
  // folders. A root puts them under a scratch directory instead. In the
  // image this is never set and every path is used exactly as sent.
  pathRoot = null,
  // WHO THE COMMAND RUNS AS. In the image the server is root, because the
  // paths it must recreate are anyone's (/Users/<name>/..., and the Mac's own
  // temp folder for the per-run settings), and the command runs as the
  // unprivileged `agent` user, owning only its folder and its account folder.
  // { uid, gid, home, user }, or null to run as whoever the server is.
  runAs = null,
  // Where the usage meter reads the machine (cloud/sandbox/usage.mjs); a
  // test points it at a fake /sys/fs/cgroup and /proc.
  usage = {},
} = {}) {
  const at = (p) => (pathRoot ? path.join(pathRoot, p) : p);
  let run = null;
  let bridge = null;
  let statusChangedAt = Math.floor(Date.now() / 1000);
  let lastPing = null;

  /* ------------------------------ THE LOG --------------------------------- */
  function openLog(r) {
    fs.mkdirSync(r.dir, { recursive: true });
    const file = path.join(r.dir, 'events.jsonl');
    r.log = { file, fd: fs.openSync(file, 'w+'), size: 0, index: [], closed: false };
  }

  function closeLog(r) {
    if (!r?.log || r.log.closed) return;
    r.log.closed = true;
    try { fs.closeSync(r.log.fd); } catch { /* closed */ }
  }

  function emit(event, r = run) {
    // A run already replaced or shut down keeps nothing: its descriptor may
    // by now belong to some other file.
    if (r.log.closed) return null;
    const e = { seq: r.log.index.length + 1, at: Date.now(), ...event };
    const line = Buffer.from(JSON.stringify(e) + '\n');
    fs.writeSync(r.log.fd, line, 0, line.length, r.log.size);
    r.log.index.push({ off: r.log.size, len: line.length });
    r.log.size += line.length;
    for (const w of [...r.waiters]) w();
    return e;
  }

  function readEvents(r, since, maxBytes = PAGE_BYTES) {
    const idx = r.log.index;
    if (since >= idx.length) return { events: [], more: false };
    let end = since;
    let bytes = 0;
    while (end < idx.length && (end === since || bytes + idx[end].len <= maxBytes)) { bytes += idx[end].len; end += 1; }
    const buf = Buffer.allocUnsafe(bytes);
    fs.readSync(r.log.fd, buf, 0, bytes, idx[since].off);
    const events = buf.toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    return { events, more: end < idx.length };
  }

  function setState(state, extra = {}, r = run) {
    r.state = state;
    statusChangedAt = Math.floor(Date.now() / 1000);
    emit({ kind: 'state', state, ...extra }, r);
  }

  function emitChunks(kind, buf, r) {
    for (let i = 0; i < buf.length; i += CHUNK) emit({ kind, data: buf.subarray(i, i + CHUNK).toString('base64') }, r);
  }

  /* ------------------------------ THE BRIDGE ------------------------------ */
  // Each MCP server the harness is configured with is replaced, in here, by
  // cloud/sandbox/mcp-stub.mjs. A stub connects to this socket and names its
  // server; from then on every line the harness writes to it becomes an `mcp`
  // event for the Mac, and every `mcp` action the Mac sends becomes a line the
  // stub writes back. The Mac runs the REAL server and feeds it these lines.
  function openBridge() {
    if (bridge) return;
    try { fs.unlinkSync(bridgeSocket); } catch { /* not there */ }
    let next = 0;
    bridge = { conns: new Map(), server: null };
    bridge.server = net.createServer((sock) => {
      const r = run;
      let conn = null;
      let buf = '';
      sock.setEncoding('utf8');
      sock.on('data', (d) => {
        buf += d;
        if (buf.length > MAX_MCP_LINE && buf.indexOf('\n') < 0) {
          if (conn) emit({ kind: 'error', message: `a line from ${conn} was over ${MAX_MCP_LINE} bytes and was refused` }, r);
          sock.destroy();
          return;
        }
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (conn === null) {
            let hello = null;
            try { hello = JSON.parse(line); } catch { /* not a hello */ }
            if (!hello?.server || !r || r !== run) { sock.destroy(); return; }
            next += 1;
            conn = `c${next}`;
            bridge.conns.set(conn, { sock, run: r });
            emit({ kind: 'mcp-open', conn, server: String(hello.server) }, r);
            continue;
          }
          emit({ kind: 'mcp', conn, line }, r);
        }
      });
      sock.on('close', () => {
        if (conn && bridge?.conns.get(conn)?.sock === sock) {
          bridge.conns.delete(conn);
          emit({ kind: 'mcp-close', conn }, r);
        }
      });
      sock.on('error', () => {});
    });
    // The stubs run as the command's user, so they must be able to connect.
    bridge.server.listen(bridgeSocket, () => { try { fs.chmodSync(bridgeSocket, 0o777); } catch { /* gone */ } });
  }

  /* ------------------------------- THE RUN -------------------------------- */
  async function prepareAndSpawn(r) {
    const { cwd, branch, bundleUrl, argv, env = {}, files = [], remote, changesRef } = r.spec;
    try {
      const bundle = path.join(r.dir, 'in.bundle');
      await download(fetchImpl, bundleUrl, bundle);
      fs.mkdirSync(cwd, { recursive: true });
      await sh('git', ['init', '-q'], cwd);
      // Every ref the Mac packed lands where it was. `--update-head-ok`: a
      // fresh repository's HEAD already names a branch, and git otherwise
      // refuses to fetch into the checked-out one.
      await sh('git', ['fetch', '-q', '--update-head-ok', bundle, '+refs/*:refs/*'], cwd);
      await sh('git', ['checkout', '-q', branch], cwd);
      if (remote) await sh('git', ['remote', 'add', 'origin', remote], cwd).catch(() => {});
      r.startSha = (await sh('git', ['rev-parse', 'HEAD'], cwd)).trim();
      r.lastCheckpoint = r.startSha;
      // Work the task folder held uncommitted on the Mac, carried as one
      // commit on its own ref and laid back down as uncommitted work here.
      if (changesRef) {
        const patch = await sh('git', ['diff', '--binary', 'HEAD', changesRef], cwd, {}, true);
        if (patch.length) await sh('git', ['apply', '--whitespace=nowarn'], cwd, {}, false, patch);
        await sh('git', ['update-ref', '-d', changesRef], cwd).catch(() => {});
      }
      for (const f of files) await placeFile(f);
      fs.rmSync(bundle, { force: true });
      // What the command writes to becomes its own: the task folder, and the
      // account folder its transcripts and tooling live in.
      if (runAs) {
        const own = [cwd];
        // The harness's own home: Claude Code's account folder, or Codex's,
        // where it keeps its state database and writes its sessions.
        for (const k of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME']) {
          if (env[k]) { const d = at(env[k]); fs.mkdirSync(d, { recursive: true }); own.push(d); }
        }
        for (const p of own) await sh('chown', ['-R', `${runAs.uid}:${runAs.gid}`, p], '/');
      }
    } catch (err) {
      emit({ kind: 'error', message: `could not prepare the run: ${err.message}` }, r);
      setState('failed', {}, r);
      return;
    }
    if (r.cancelled) {
      // Cancelled before it ever started: nothing ran, so the results are the
      // folder exactly as it was packed, uploaded so the Mac's import is the
      // same one path every time.
      r.exitCode = null;
      emit({ kind: 'exit', code: null, signal: r.cancelled, cancelled: true }, r);
      r.state = 'exited';
      if (r.spec.results) autoCollect(r, r.spec.results);
      return;
    }
    openBridge();
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd,
        env: {
          ...baseEnv,
          ...(runAs ? { HOME: runAs.home, USER: runAs.user, LOGNAME: runAs.user, TMPDIR: '/tmp' } : {}),
          ...env,
          AGENTBOX_BRIDGE_SOCK: bridgeSocket,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        // Its own process group, so a cancel reaches everything it started.
        detached: true,
        ...(runAs ? { uid: runAs.uid, gid: runAs.gid } : {}),
      });
    } catch (err) {
      emit({ kind: 'error', message: `could not start the command: ${err.message}` }, r);
      setState('failed', {}, r);
      return;
    }
    r.child = child;
    r.meter = usageMeter(usage);
    child.stdout.on('data', (d) => emitChunks('stdout', d, r));
    child.stderr.on('data', (d) => emitChunks('stderr', d, r));
    child.stdin.on('error', () => {});
    for (const p of r.pendingStdin.splice(0)) writeStdin(r, p);
    let exited = false;
    // A command that could not be started at all (not found, not allowed)
    // reports an error and may never report an exit; it is over all the same,
    // and its folder is still collected.
    child.on('error', (err) => {
      emit({ kind: 'error', message: `the command failed: ${err.message}` }, r);
      if (!child.pid) setImmediate(() => finish(127, null));
    });
    const finish = (code, signal) => {
      if (exited) return;
      exited = true;
      clearTimeout(r.killTimer);
      clearTimeout(r.deadlineTimer);
      r.exitCode = code;
      r.exitSignal = signal || null;
      r.usage = r.meter?.stop() ?? null;
      r.meter = null;
      r.child = null;
      // Anything the command left running in its group goes now: a dev
      // server holding stdout open would otherwise keep the run "running".
      killGroup(child.pid, 'SIGKILL');
      emit({ kind: 'exit', code, signal, ...(r.cancelled ? { cancelled: true } : {}) }, r);
      r.state = 'exited';
      statusChangedAt = Math.floor(Date.now() / 1000);
      if (r.spec.results) autoCollect(r, r.spec.results);
    };
    // `exit` rather than `close`: a descendant that inherited stdout can hold
    // the pipe open long after the command itself is gone. The output that was
    // already written is flushed first.
    child.on('exit', (code, signal) => setImmediate(() => finish(code, signal)));
    if (r.cancelled) cancel(r, r.cancelled);
    setState('running', {}, r);
    const deadline = Number(r.spec.deadlineMs) || DEFAULT_DEADLINE_MS;
    r.deadlineTimer = setTimeout(() => {
      emit({ kind: 'error', message: 'stopped near the cloud session\'s 8-hour limit so its work could be saved' }, r);
      cancel(r, 'SIGTERM');
    }, deadline);
  }

  function cancel(r, signal = 'SIGTERM') {
    r.cancelled = r.cancelled || signal;
    const child = r.child;
    if (!child) return; // still preparing: the latch stops it from starting
    killGroup(child.pid, signal);
    clearTimeout(r.killTimer);
    r.killTimer = setTimeout(() => killGroup(child.pid, 'SIGKILL'), killGraceMs);
  }

  async function placeFile(f) {
    fs.mkdirSync(path.dirname(f.path), { recursive: true });
    await download(fetchImpl, f.url, f.path);
    if (f.untar) {
      fs.mkdirSync(f.untar, { recursive: true });
      await sh('tar', ['-xzf', f.path, '-C', f.untar], f.untar);
      fs.rmSync(f.path, { force: true });
    }
  }

  function writeStdin(r, { data, end }) {
    const child = r.child;
    if (!child) { r.pendingStdin.push({ data, end }); return; }
    if (data) child.stdin.write(Buffer.from(data, 'base64'));
    if (end) child.stdin.end();
  }

  /* ------------------------------ COLLECTING ------------------------------ */
  // Three tries on its own, a little apart. A `collect` from the Mac (with
  // fresh URLs, say) takes over from these rather than racing them.
  async function autoCollect(r, urls) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (r.manualCollect || r.state === 'collected') return;
      const out = await collectAndFinish(r, urls);
      if (out.ok || r.manualCollect) return;
      if (attempt < 3) await new Promise((res) => setTimeout(res, uploadRetryMs * attempt));
      else setState('collect-failed', { message: out.message }, r);
    }
  }

  async function manualCollect(r, urls) {
    r.manualCollect = true;
    while (r.collecting) await r.collecting.catch(() => {});
    if (r.state === 'collected') return { ...r.manifest, already: true };
    const out = await collectAndFinish(r, urls);
    if (!out.ok) setState('collect-failed', { message: out.message }, r);
    return out;
  }

  // The commits, the uncommitted work, the folders asked for, then the event
  // log, then `done.json` LAST. One at a time per run.
  function collectAndFinish(r, urls) {
    if (r.collecting) return r.collecting;
    r.collecting = (async () => {
      try {
        const manifest = await collect(r, urls);
        if (urls.eventsUrl) await upload(fetchImpl, urls.eventsUrl, fs.readFileSync(r.log.file));
        const done = { ...manifest, runId: r.id, exitCode: r.exitCode, exitSignal: r.exitSignal || null, cancelled: r.cancelled || null, lastSeq: r.log.index.length, usage: r.usage || null };
        if (urls.doneUrl) await upload(fetchImpl, urls.doneUrl, Buffer.from(JSON.stringify(done)));
        r.manifest = done;
        setState('collected', {}, r);
        return done;
      } catch (err) {
        return { ok: false, error: 'collect-failed', message: err.message };
      } finally {
        r.collecting = null;
      }
    })();
    return r.collecting;
  }

  async function collect(r, { bundleUrl, changesUrl, bring = [] }) {
    r.attempt = (r.attempt || 0) + 1;
    const tmp = (name) => path.join(r.dir, `${r.attempt}-${name}`);
    const brought = [];
    // A run cancelled before checkout has nothing in the folder to bring.
    if (!r.startSha) return { ok: true, startSha: null, tip: null, commits: 0, uncommitted: false, changesRef: null, brought };
    const cwd = r.spec.cwd;
    const branch = r.spec.branch;
    const tip = (await sh('git', ['rev-parse', `refs/heads/${branch}`], cwd)).trim();
    const commits = Number((await sh('git', ['rev-list', '--count', `${r.startSha}..${tip}`], cwd)).trim()) || 0;
    // WHERE THE AGENT ENDED UP, not only where it started. An agent that
    // switched branches and committed there leaves the task branch untouched
    // and the folder clean, and collecting the task branch alone would bring
    // back nothing while the work sat on the other one.
    const head = (await sh('git', ['rev-parse', 'HEAD'], cwd)).trim();
    const headRef = (await sh('git', ['symbolic-ref', '-q', '--short', 'HEAD'], cwd).catch(() => '')).trim() || null;
    const strayHead = head !== tip && head !== r.startSha;
    if (strayHead) await sh('git', ['update-ref', 'refs/agentbox/head', head], cwd);
    if (commits > 0 || strayHead) {
      const out = tmp('out.bundle');
      const refs = [];
      if (commits > 0) refs.push(`refs/heads/${branch}`);
      if (strayHead) refs.push('refs/agentbox/head');
      await sh('git', ['bundle', 'create', '-q', out, ...refs, `^${r.startSha}`], cwd);
      await upload(fetchImpl, bundleUrl, fs.readFileSync(out));
      fs.rmSync(out, { force: true });
    }
    const dirty = (await sh('git', ['status', '--porcelain', '--untracked-files=all'], cwd)).trim().length > 0;
    let changesRef = null;
    if (dirty) {
      changesRef = 'refs/agentbox/changes';
      const index = tmp('changes.index');
      const env = { GIT_INDEX_FILE: index };
      fs.rmSync(index, { force: true });
      await sh('git', ['read-tree', 'HEAD'], cwd, env);
      await sh('git', ['add', '-A'], cwd, env);
      const tree = (await sh('git', ['write-tree'], cwd, env)).trim();
      const commit = (await sh('git', ['-c', 'user.name=Agentbox', '-c', 'user.email=agentbox@localhost', 'commit-tree', tree, '-p', 'HEAD', '-m', 'Uncommitted work from a cloud run'], cwd, env)).trim();
      fs.rmSync(index, { force: true });
      await sh('git', ['update-ref', changesRef, commit], cwd);
      const out = tmp('changes.bundle');
      await sh('git', ['bundle', 'create', '-q', out, changesRef, '^HEAD'], cwd);
      await upload(fetchImpl, changesUrl, fs.readFileSync(out));
      fs.rmSync(out, { force: true });
    }
    for (const b of bring) {
      if (!fs.existsSync(b.dir)) continue;
      const tarball = tmp('bring.tgz');
      await sh('tar', ['-czf', tarball, '-C', b.dir, '.'], cwd);
      await upload(fetchImpl, b.url, fs.readFileSync(tarball));
      fs.rmSync(tarball, { force: true });
      brought.push(b.dir);
    }
    return { ok: true, startSha: r.startSha, tip, head, headRef, strayHead, commits, uncommitted: dirty, changesRef, brought };
  }

  async function checkpoint(r, { bundleUrl }) {
    const cwd = r.spec.cwd;
    const tip = (await sh('git', ['rev-parse', `refs/heads/${r.spec.branch}`], cwd)).trim();
    if (tip === r.lastCheckpoint) return { ok: true, changed: false, tip };
    const out = path.join(r.dir, 'checkpoint.bundle');
    await sh('git', ['bundle', 'create', '-q', out, `refs/heads/${r.spec.branch}`, `^${r.startSha}`], cwd);
    await upload(fetchImpl, bundleUrl, fs.readFileSync(out));
    fs.rmSync(out, { force: true });
    r.lastCheckpoint = tip;
    return { ok: true, changed: true, tip };
  }

  /* ------------------------------- ACTIONS -------------------------------- */
  // Numbered input: `n` is the Mac's count of everything it has sent this run.
  // A repeat is acknowledged and not applied; a gap is refused, naming the
  // number expected, so the Mac resends from there.
  //
  // ONE AT A TIME. Inputs are applied in a single chain per run, so a resend
  // that arrives while the first copy is still downloading a file waits for it
  // and is then answered as the duplicate it is; it can never land second and
  // rewind the count. The count moves only when an input was applied, or was
  // consumed with nothing left to apply it to (stdin after the command exited,
  // a reply for a stub that has gone); a failed file download leaves it, so the
  // same number can be sent again.
  function sequenced(r, req, apply) {
    const step = async () => {
      if (req.n === undefined) return apply();
      const n = Number(req.n);
      if (n <= r.inSeq) return { ok: true, dup: true };
      if (n !== r.inSeq + 1) return { ok: false, error: 'gap', expect: r.inSeq + 1 };
      const out = await apply();
      if (out?.ok || out?.consumed) r.inSeq = n;
      return out;
    };
    const p = (r.inputs || Promise.resolve()).then(step, step);
    r.inputs = p.catch(() => {});
    return p;
  }

  async function handle(req = {}) {
    const action = req.action;
    if (action === 'status') {
      if (!run) return { ok: true, state: 'none' };
      return { ok: true, runId: run.id, state: run.state, seq: run.log.index.length, inSeq: run.inSeq, exitCode: run.exitCode ?? null, manifest: run.manifest || null };
    }
    if (action === 'start') {
      if (run && run.id === req.runId) return { ok: true, already: true, state: run.state, seq: run.log.index.length };
      if (run && !DONE_STATES.has(run.state)) return { ok: false, error: 'busy', runId: run.id };
      const problem = invalidStart(req);
      if (problem) return { ok: false, error: 'bad-start', message: problem };
      if (bridge) for (const c of bridge.conns.values()) c.sock.destroy();
      closeLog(run);
      const spec = !pathRoot ? req : {
        ...req,
        cwd: at(req.cwd),
        files: (req.files || []).map((f) => ({ ...f, path: at(f.path), ...(f.untar ? { untar: at(f.untar) } : {}) })),
        env: { ...(req.env || {}), AGENTBOX_PATH_ROOT: pathRoot },
        results: req.results && { ...req.results, bring: (req.results.bring || []).map((b) => ({ ...b, dir: at(b.dir) })) },
      };
      const r = {
        id: req.runId, spec, state: 'preparing', waiters: new Set(), pendingStdin: [], child: null,
        exitCode: null, startSha: null, inSeq: 0, cancelled: null, manifest: null,
        dir: path.join(workRoot, '.agentbox', safe(req.runId)),
      };
      openLog(r);
      run = r;
      setState('preparing', {}, r);
      prepareAndSpawn(r);
      return { ok: true, seq: r.log.index.length };
    }
    if (!run) return { ok: false, error: 'no-run' };
    if (req.runId && req.runId !== run.id) return { ok: false, error: 'no-run', runId: run.id };
    const r = run;
    switch (action) {
      case 'events': {
        const since = Math.max(0, Number(req.since) || 0);
        const waitMs = Math.min(Math.max(0, Number(req.waitMs) || 0), 25_000);
        if (r.log.index.length <= since && waitMs > 0) {
          await new Promise((resolve) => {
            const done = () => { clearTimeout(t); r.waiters.delete(done); resolve(); };
            const t = setTimeout(done, waitMs);
            r.waiters.add(done);
          });
        }
        const page = readEvents(r, since, Math.min(Number(req.maxBytes) || PAGE_BYTES, PAGE_BYTES));
        return { ok: true, state: r.state, ...page };
      }
      case 'stdin':
        return sequenced(r, req, () => {
          if (['exited', 'collected', 'collect-failed', 'failed'].includes(r.state)) return { ok: false, error: 'exited', consumed: true };
          writeStdin(r, req);
          return { ok: true };
        });
      case 'files':
        // Files the Mac learns it must send once the run is going (an
        // attachment named in the prompt, which arrives over stdin).
        return sequenced(r, req, async () => {
          try {
            for (const f of req.files || []) {
              if (!f?.url || !path.isAbsolute(f?.path || '')) return { ok: false, error: 'bad-file', consumed: true };
              await placeFile({ ...f, path: at(f.path), ...(f.untar ? { untar: at(f.untar) } : {}) });
              if (runAs) await sh('chown', [`${runAs.uid}:${runAs.gid}`, at(f.path)], '/').catch(() => {});
            }
          } catch (err) {
            return { ok: false, error: 'file-failed', message: err.message };
          }
          return { ok: true };
        });
      case 'mcp':
        return sequenced(r, req, () => {
          const c = bridge?.conns.get(req.conn);
          if (!c || c.run !== r) return { ok: false, error: 'no-conn', consumed: true };
          c.sock.write(String(req.line) + '\n');
          return { ok: true };
        });
      case 'mcp-close':
        return sequenced(r, req, () => {
          bridge?.conns.get(req.conn)?.sock.end();
          return { ok: true };
        });
      case 'signal': {
        const sig = req.signal || 'SIGTERM';
        if (['exited', 'collected', 'collect-failed', 'failed'].includes(r.state)) return { ok: true, running: false };
        cancel(r, sig);
        return { ok: true, running: !!r.child, preparing: r.state === 'preparing' };
      }
      case 'checkpoint':
        if (r.state !== 'running' && r.state !== 'exited') return { ok: false, error: 'not-ready' };
        try { return await checkpoint(r, req); } catch (err) { return { ok: false, error: 'checkpoint-failed', message: err.message }; }
      case 'collect':
        if (r.state === 'collected') return { ...r.manifest, already: true };
        if (r.state !== 'exited' && r.state !== 'collect-failed') return { ok: false, error: 'not-exited', state: r.state };
        return manualCollect(r, pathRoot ? { ...req, bring: (req.bring || []).map((b) => ({ ...b, dir: at(b.dir) })) } : req);
      default:
        return { ok: false, error: 'unknown-action' };
    }
  }

  function ping() {
    const busy = !!run && !DONE_STATES.has(run.state);
    const status = busy ? 'HealthyBusy' : 'Healthy';
    // AgentCore wants the time the status CHANGED, never the time of the ping:
    // a timestamp that moves on every ping keeps a session alive forever.
    if (status !== lastPing) { lastPing = status; }
    return { status, time_of_last_update: statusChangedAt };
  }

  let httpServer = null;
  function listen(port = 8080, host = '0.0.0.0') {
    httpServer = http.createServer(async (req, res) => {
      try {
        if (req.method === 'GET' && req.url.startsWith('/ping')) return json(res, 200, ping());
        if (req.method === 'POST' && req.url.startsWith('/invocations')) {
          const body = await readBody(req, 100 * 1024 * 1024);
          let parsed;
          try { parsed = JSON.parse(body || '{}'); } catch { return json(res, 400, { ok: false, error: 'bad-json' }); }
          return json(res, 200, await handle(parsed));
        }
        json(res, 404, { ok: false, error: 'not-found' });
      } catch (err) {
        json(res, 500, { ok: false, error: 'internal', message: err.message });
      }
    });
    return new Promise((resolve) => httpServer.listen(port, host, () => resolve(httpServer.address())));
  }

  async function close() {
    if (run?.child) killGroup(run.child.pid, 'SIGKILL');
    if (run) { clearTimeout(run.deadlineTimer); clearTimeout(run.killTimer); for (const w of [...run.waiters]) w(); }
    if (bridge) { for (const c of bridge.conns.values()) c.sock.destroy(); bridge.server.close(); bridge = null; }
    try { fs.unlinkSync(bridgeSocket); } catch { /* gone */ }
    if (httpServer) { httpServer.closeAllConnections?.(); await new Promise((r) => httpServer.close(r)); }
    closeLog(run);
  }

  return { handle, ping, listen, close, bridgeSocket };
}

/* -------------------------------- helpers --------------------------------- */

function invalidStart(req) {
  if (!req.runId || typeof req.runId !== 'string') return 'runId is required';
  if (!req.cwd || !path.isAbsolute(req.cwd)) return 'cwd must be an absolute path';
  if (!req.branch) return 'branch is required';
  if (!req.bundleUrl) return 'bundleUrl is required';
  if (!Array.isArray(req.argv) || !req.argv.length) return 'argv is required';
  for (const f of req.files || []) if (!f?.url || !path.isAbsolute(f?.path || '')) return 'every file needs an absolute path and a url';
  return null;
}

function killGroup(pid, signal) {
  if (!pid) return;
  try { process.kill(-pid, signal); } catch { try { process.kill(pid, signal); } catch { /* gone */ } }
}

// What the command may inherit from the sandbox itself: enough to find
// programs and a home, and nothing the image's own environment happens to hold.
export function pickBaseEnv(env) {
  const keep = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'SHELL', 'USER', 'NODE_EXTRA_CA_CERTS'];
  return Object.fromEntries(keep.filter((k) => env[k] !== undefined).map((k) => [k, env[k]]));
}

function safe(s) { return String(s).replace(/[^a-zA-Z0-9._-]/g, '_'); }

// git refuses to work in a folder another user owns ("dubious ownership"),
// and once the command has run, the task folder is the `agent` user's while
// this server, collecting it, is root. Every folder here is ours.
const TRUST_EVERY_FOLDER = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: '*' };

function sh(cmd, args, cwd, extraEnv = {}, asBuffer = false, input = undefined) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { cwd, env: { ...process.env, ...TRUST_EVERY_FOLDER, ...extraEnv }, maxBuffer: 256 * 1024 * 1024, encoding: asBuffer ? 'buffer' : 'utf8' }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} ${args[0]}: ${String(stderr || err.message).trim().slice(0, 500)}`));
      resolve(stdout);
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

async function download(fetchImpl, url, file) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`fetch ${res.status} for ${redact(url)}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

async function upload(fetchImpl, url, body) {
  const res = await fetchImpl(url, { method: 'PUT', body });
  if (!res.ok) throw new Error(`upload ${res.status} for ${redact(url)}`);
}

// A presigned URL carries a signature in its query; it never goes in a message.
function redact(url) { return String(url).split('?')[0]; }

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Started directly (the image's entrypoint), it serves AgentCore's port.
if (import.meta.url === `file://${process.argv[1]}`) {
  let runAs = null;
  const user = process.env.AGENTBOX_RUN_AS;
  if (user && process.getuid?.() === 0) {
    const id = (flag) => Number(execFileSync('id', [flag, user], { encoding: 'utf8' }).trim());
    const home = execFileSync('getent', ['passwd', user], { encoding: 'utf8' }).split(':')[5];
    runAs = { uid: id('-u'), gid: id('-g'), home, user };
  }
  const sandbox = createSandbox({ workRoot: '/var/lib/agentbox', bridgeSocket: '/tmp/agentbox-bridge.sock', runAs });
  sandbox.listen(Number(process.env.PORT) || 8080).then((a) => console.error(`agentbox sandbox listening on ${a.port}`));
}
