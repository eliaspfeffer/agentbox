# Cloud runs: the build

Status: revised 2026-10-13 after Codex's review of the first draft (its 14
findings are answered inline below, as R1..R14). This file is the handoff
between sessions building it. Keep it current: tick what landed, say what is
next.

## What it is

A thread can run in a cloud sandbox instead of on this Mac. Two reasons, in the
order they matter:

1. **Overflow.** A 16 GB Mac runs two or three agents at once. Every thread
   past that waits. With cloud runs on, a Claude Code thread that would wait
   runs in the cloud instead, so how many run at once stops being the limit.
2. **The lid closes.** A run that is already in the cloud keeps going while the
   Mac sleeps. Its result lands when the Mac wakes. (Starting NEW runs while
   the Mac sleeps needs a scheduler in the cloud; that is phase 2, below.)

## Settled decisions (do not reopen)

- AWS Bedrock AgentCore Runtime, us-east-1, in the user's own AWS account, paid
  by AWS credits. One microVM per run (2 vCPU / 8 GB ceiling, 8 h max).
- The agents run on the user's own Claude subscription, never an API key and
  never Bedrock pay-per-token. Claude Code takes a long-lived token from
  `claude setup-token` (Anthropic's own sign-in) in `CLAUDE_CODE_OAUTH_TOKEN`,
  given to the remote command only, after `_workerEnv`'s scrub (R9).
- The cloud side is a plain remote computer: it starts a command, keeps what
  it prints, and carries the app's tools through as raw lines. It never learns
  what a harness or a tool is.
- A budget alarm that counts spend before credits exists (`agentcore-sandboxes`,
  made by the spike, w-bad6fbae78).

## Codex in the cloud (added 2026-10-13: "a fundamental requirement")

On the Mac, every Codex thread of one login runs inside one shared
`codex app-server`, spoken to over JSON-RPC (main/codex-app-server.mjs). A
cloud Codex thread gets an app-server of its OWN, in its sandbox:

- **The connection.** `createCodexAppServer` already takes any process that
  speaks the protocol on stdin/stdout. For a cloud thread that process is
  `main/cloud/run-cli.mjs --agentbox-codex app-server`, the same proxy, whose
  remote command is `codex app-server`. Approvals are server requests on the
  same stream, so they reach the existing cards untouched; steering and
  interrupts are client requests on it.
- **The app's tools.** Codex is told its MCP servers inside `thread/start`
  and `thread/resume` (`config.mcp_servers`), not on a command line. The
  proxy reads those two messages on their way in, swaps each server's command
  for the sandbox's stub, and keeps the original to run here, exactly as for
  Claude Code. Entries with `enabled: false` (her own servers, switched off)
  pass untouched.
- **The sign-in, with nothing for her to do.** Measured 2026-10-13 on this
  Mac: a ChatGPT-plan Codex access token lasts 240 h and Codex renews it on its
  own about every eight days. The sandbox gets a copy of `auth.json` whose
  refresh token is a placeholder: Codex runs on the access token (a real
  `codex exec` answered from such a copy, no 401s) and can never renew, so it
  can never rotate the login and sign the Mac out; the placeholder was
  untouched after the run, and both real logins still read signed in. A login
  whose access token has under 9 h left stays on the Mac until Codex renews it
  there. Codex access tokens (`codex login --with-access-token`) are Business
  and Enterprise only, and the app-server's `chatgptAuthTokens` mode is marked
  "for OpenAI internal use only", so neither is used.
- **The transcript.** Codex finds a thread by scanning `CODEX_HOME/sessions`.
  The sandbox's `CODEX_HOME` is the Mac's path, holding only the sign-in and,
  for `thread/resume`, that thread's rollout (sent when the proxy sees the
  resume go by); its `sessions/` comes home after the run.
- **The end.** A Codex worker ends when its turn ends, before the proxy has
  brought the work home. So a cloud Codex worker's `exit` is held until the
  proxy has exited: the worker's end closes the connection, which stops the
  remote app-server; the sandbox uploads, the proxy imports, and only then
  does the supervisor see the run end. Exit 75 from the proxy arrives as a
  transport fault, as for Claude Code.

- **The sandbox is the machine** (her decision, 2026-10-13). Codex's own
  command sandbox (bubblewrap) cannot nest inside an AgentCore microVM:
  measured, every write and command was refused. A `workspace-write` thread
  therefore runs with full access inside the throwaway VM, as OpenAI's docs
  advise for containers; read-only stays read-only, approvals are untouched.
- **Fresh threads only.** A Codex resume runs on the Mac, whose shared
  app-server may hold the thread loaded. A thread that started in the cloud
  resumes on the Mac from the rollout that came home (measured: it did, and
  remembered what it had done).
- **Measured end to end against real AWS**, with the app's own thread settings
  (`workerThreadParams`): Codex ran commands, wrote and committed a file,
  called the store tool on the Mac, and the commit and rollout came home in
  16 s; only the store tool was connected, her ChatGPT apps and plugins off.

## v1 scope, and what is deliberately left out

- **Claude Code and Codex.** Other harnesses later, each a small adapter.
- **No re-attach across an app restart (R1, R2, R5, R6, R7).** Today every app
  restart stops every local worker and `recoverInterrupted` resumes each one
  from its transcript. A cloud run does exactly the same: when the app stops a
  cloud run, for any reason (Stop, archive, preemption, quit), the run is
  cancelled, its work and transcript are brought home, and the existing resume
  takes over. That removes replayed store writes, orphaned claims, approvals
  keyed to a dead app's key, and double runs, because there is never a remote
  run the app is not holding a live session for.
- **The Mac sleeping is not a restart.** The app, the proxy, the store server
  and the approvals server all freeze together and thaw together; their memory
  is intact. The sandbox keeps going. A store call it makes while the Mac
  sleeps waits (the remote command gets `MCP_TOOL_TIMEOUT` of 8 h). An approval
  asked while the Mac sleeps is refused 15 minutes after it was asked, by wall
  clock, exactly as a local one would be (R7); the agent carries on with what
  it may do.
- **No `look_at_page`** in the cloud: it would open Chrome on the Mac against
  the Mac's localhost, not the sandbox's (R10). The proxy drops it from the
  store server's tool list on the way out and refuses a call to it.

## How it works

### The proxy: one local process per cloud run

For a cloud run the supervisor spawns `main/cloud/run.mjs` in place of
`claude`, with the same argv, env and cwd, through Electron's node
(`ELECTRON_RUN_AS_NODE`), the way the approvals server already runs. It is a
duplex pipe (R8): stdin bytes go to the remote command in order, EOF included,
so the prompt the supervisor writes after spawn, live replies, interrupts and
the close at the end all reach Claude Code exactly as they do locally. Remote
stdout and stderr come back byte for byte. Its life:

1. **Launch manifest (R9).** From the argv and env it builds an explicit list,
   never the host environment wholesale:
   - the `--settings` file, rewritten without the memory-gate hooks (R12);
   - the `--mcp-config` file, rewritten so each server is
     `cloud/sandbox/mcp-stub.mjs <name>`;
   - for `--resume <id>`, the transcript file at the same path under the same
     account folder;
   - every file under the product's folder named in the prompt or the
     appended system text (attachments), up to 25 MB each;
   - env: `ZERO_PRODUCT`, `ZERO_ITEM`, `CLAUDE_CONFIG_DIR` (always set, to the
     account folder's Mac path), git's author name and email, `MCP_TOOL_TIMEOUT`,
     `CLAUDE_CODE_OAUTH_TOKEN` for that account. Nothing from `memoryGateEnv`.
2. **Pack.** `git bundle` of the task branch, `main` and `origin/main` (55 MB,
   1 s for this repo) to S3. A pending-import marker goes into the task
   folder's git dir (`<git dir>/agentbox-cloud.json`), naming the run id and the
   start commit.
3. **Start.** `InvokeAgentRuntime {action:"start"}` with presigned URLs: a GET
   for the bundle and each file, and PUTs for every result (R11). The sandbox
   checks the bundle out at the SAME absolute path as the task folder, so the
   brief's paths, `--resume` and the transcript's folder name are identical.
4. **Run.** Long-polls `{action:"events", since}`; writes stdout and stderr out;
   feeds `mcp` lines to the REAL local servers (started from the original
   `--mcp-config` with the worker's own env, exactly as Claude Code would start
   them) and returns their lines with `{action:"mcp"}`. MCP traffic is never
   resent: the cursor lives in memory and only moves forward (R5).
5. **Finish.** When the command exits, the sandbox itself uploads the new
   commits, the uncommitted work (one commit on its own ref) and the account's
   `projects/<folder>` transcripts to the PUT URLs, plus the full event log,
   whether or not the Mac is awake (R11). Then it lets the session go idle.
6. **Import.** The proxy downloads them (from S3, not from the sandbox, so a
   reaped session loses nothing), fetches the commits into a staging ref,
   fast-forwards the task branch only if its tip is still the start commit (if
   not, the cloud commits stay on `refs/agentbox/cloud/<run>` and the run
   reports it), applies the uncommitted work, unpacks the transcripts, removes
   the marker, and exits with the remote exit code.
7. **Cancel.** On SIGTERM (Stop, archive, preemption, quit) the proxy signals
   the remote command, waits up to 30 s for it to exit, and then does 5 and 6.
   If it cannot reach the sandbox it exits with a failure and leaves the
   marker.

### Guards in the supervisor

- **Shipping waits for the import (R3).** `nextToShip` skips a folder whose git
  dir holds a pending-import marker, so a `ship` label added by a cloud worker
  can never ship the stale local branch.
- **Folder cleanup waits too.** Release and park skip a folder with a marker.
- **Delivery (R4).** A proxy that ran the remote result to the end but could
  not import exits with a distinct code (`75`, EX_TEMPFAIL) and writes nothing
  to stdout after the result; the supervisor treats that code as a transport
  fault (redeliver, no attempt spent) rather than a finished run.
- **Slots (R13).** Local capacity counts local sessions only. A Claude thread
  may take a cloud slot when no local slot is free, cloud runs are on, fewer
  than `maxCloudSessions` (default 10) cloud runs are live, and an account is
  healthy. Account cooldowns and the fleet brake apply to cloud runs exactly as
  to local ones.
- **Hangs.** The reaper is unchanged: silence plus an expired claim. The store
  server runs on the Mac, so its heartbeat renews the claim for a cloud run
  exactly as for a local one.

### The sandbox

`cloud/sandbox/`: an arm64 image (Node 22, git, Claude Code) running
`server.mjs` on :8080 (`/ping`, `/invocations`). One run per microVM. It keeps
every event numbered for replay, answers `HealthyBusy` from start until its
results are uploaded, and holds the bridge socket that `mcp-stub.mjs` uses.
Built and tested (cloud/sandbox/*, tests/a-cloud-sandbox-*, tests/a-cloud-run-*).

### AWS setup, once

`scripts/cloud-setup.mjs`, run with an admin sign-in (`aws login`), creates or
updates, idempotently: the S3 bucket (block public access, objects expire after
7 days), the ECR repository, a CodeBuild project that builds the arm64 image
in AWS (no Docker on the Mac), the runtime's execution role (ECR pull and logs
only: the sandbox reaches S3 through presigned URLs and holds no AWS rights of
its own), the AgentCore runtime, and an IAM user for the app that may invoke
and stop sessions on that one runtime and read and write that one bucket. Its
key goes into `~/.aws/credentials` as the `agentbox-cloud` profile (0600), so
the app never runs on the 12-hour `aws login`. Names and ARNs go to
`<app data>/cloud.json`, never to git.

### Turning it on

On by itself once a Mac has run the setup script and saved one account's
sign-in (`claude setup-token`, stored in the macOS keychain); a Mac that has
done neither is exactly today's app. Three settings, chosen from the cloud
button: `cloudRuns: false` is "This Mac only", null is "When this Mac is
full", `'all'` is "Everything" (the cloud first; this Mac for what cannot go
there or when the cloud is at its cap).

This Mac's memory gate (main/start-hold.mjs) holds only this Mac: a row it
holds goes to the cloud when a cloud slot is free (`_roomFor`).

### What the user sees

A square cloud button beside the filters button, drawn only on a Mac set up
for the cloud, wearing how many threads run there while any do. Its menu is
built like the filters menu: the three choices with the picked one in
orange, one line on what it does, and this month's agent-hours and
estimated cost. Approved 2026-10-13 after four rounds of screenshots
(designs/w-1dc7ee2408/).

### What each run used

The sandbox measures its whole machine, which is what AWS bills: CPU time
(cgroup v2 cpu.stat, else /proc/stat) and memory's high-water mark
(memory.peak, else sampled), plus wall time (cloud/sandbox/usage.mjs).
done.json carries it home and the Mac keeps one line per run in
~/.agentbox/cloud-usage.jsonl; `node scripts/cloud-usage.mjs` summarises it
at AgentCore's published rates. The plan limits are set from these.

## Plans (decided 2026-10-13, numbers to be set from measured use)

- Sold as "+N agent slots": agents running in the cloud at once, on top of
  this Mac's. A monthly agent-hour limit sits behind each plan, high enough
  that most people never reach it; past it, threads wait for the Mac.
- Pro $40 +10 slots, Plus $100 +25, Max $200 +60. No top-ups for now.
- A cloud hour is one agent working for one hour; waiting for a reply is
  free (a run ends with its turn). Each agent is its own machine, billed on
  what it uses, so packing agents onto one machine would not save money.
- AWS lets this account run 5,000 sessions at once and start 25 a second
  (checked 2026-10-13; both can be raised).
- Free: 5 hours, no card. Sign-in is the app's own sign-in page.

## Phases

1. Spike: AgentCore measured for real. Running as w-bad6fbae78.
2. **Done.** The sandbox image and server (cloud/sandbox/), with the bridge.
3. **Done.** `scripts/cloud-setup.mjs`, run against the real account
   2026-10-13: bucket, ECR, CodeBuild ARM build, roles, runtime, app user.
4. **Done.** The proxy (main/cloud/run.mjs, run-cli.mjs, aws.mjs), tested end
   to end against the real sandbox server on one machine, and against real
   AWS with a shell command in place of Claude Code: packed, started,
   committed in the sandbox and brought home in 11 s. The microVM measured:
   aarch64, 2 vCPU, 8 GB, 8.8 GB disk.
5. **Done.** The supervisor's placement, slots, guards (ship, cleanup,
   restart) and exit-75 handling, with tests. The lid, measured against real
   AWS: the Mac-side process frozen (SIGSTOP, as in sleep) for 50 s while the
   sandbox ran a 25 s job; on waking it read the rest and brought the commit
   and the loose file home 2 s later.
6. **Waiting on one Claude sign-in** (`scripts/cloud-signin.mjs`): a real
   Claude Code thread of this repo runs in the cloud, writes to the store,
   asks for an approval, commits, ships.
7. Phase 2, filed separately: Codex in the cloud, new runs while the Mac
   sleeps, replies from the phone, and a managed version for people with no
   AWS account.

## How it was checked

Codex reviewed the plan twice and the code twice (scripts/scratch/cloud, not
committed); every finding is either fixed or written down above as a limit.
Tests: tests/a-cloud-sandbox-runs-one-command-and-replays-what-it-printed,
a-cloud-run-reaches-the-apps-tools-through-the-sandbox,
a-cloud-run-brings-the-agents-work-home, a-cloud-run-sends-only-what-it-may,
a-thread-runs-in-the-cloud-only-when-this-mac-is-full,
a-thread-running-in-the-cloud-says-so.

## Turning it on, for whoever runs this Mac

1. `aws login --region us-east-1` (an admin), then
   `node scripts/cloud-setup.mjs`.
2. `node scripts/cloud-signin.mjs <account folder>` for each Claude account
   that may run in the cloud. An account without one keeps its threads here.

That is all: cloud runs are on for a Mac that has been set up, and nowhere
else. `"cloudRuns": false` in zero.config.json turns them off.

## Known limits

- A cloud run waits for the Mac whenever it calls the store or asks for an
  approval, so with the lid shut it keeps working until its next such call.
- A run that ended on another branch, or whose folder changed on this Mac
  while it was away, is kept on `refs/agentbox/cloud/<run>` and its folder
  stays marked until a person looks (the app logs which folder).
- The budget the spike made (`agentcore-sandboxes`) counts all of the
  account's spend, not only cloud runs.
- The sandbox is Linux: a project that builds with Xcode cannot run there,
  and nothing yet keeps such a project on the Mac.
- Each run starts on a fresh machine and installs what it needs; a
  per-project setup step and a saved installed copy are not built yet.

## The privacy and terms pages

They say Agentbox sends nothing and hosts nothing. A cloud run sends the task's
code, prompt and transcript to the user's own AWS account, by their choice, so
both pages are edited in the change that turns cloud runs on.
