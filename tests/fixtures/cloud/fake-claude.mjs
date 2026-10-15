#!/usr/bin/env node
// A STAND-IN FOR CLAUDE CODE INSIDE A TEST'S CLOUD SANDBOX.
//
// It speaks the same stream-json the supervisor speaks to the real one: it
// reads user messages on stdin and prints `system`, `assistant` and `result`
// lines on stdout, and it reaches the app's tools the way the real one does,
// by starting the MCP servers its `--mcp-config` names (in the sandbox those
// are the stubs). What it does with a message is fixed so a test can check
// every effect on the Mac:
//   - calls `tools/list` and `tools/call {name: "note", arguments: {text}}` on
//     the `agentbox` server and puts the reply in its result;
//   - commits `cloud.txt` and leaves `loose.txt` uncommitted;
//   - writes its transcript where Claude Code would;
//   - prints the result, then waits for stdin to close, as Claude Code does.
// A message whose text includes "HANG" makes it ignore SIGTERM for a moment and
// then sit still, so a test can cancel it. "LOOK" makes it call look_at_page.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const root = process.env.AGENTBOX_PATH_ROOT || '';
const at = (p) => (root ? path.join(root, p) : p);
const argv = process.argv.slice(2);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const sessionId = val('--resume') || 'cloud-session-0001';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

out({ type: 'system', subtype: 'init', session_id: sessionId, cwd: process.cwd() });

const config = JSON.parse(fs.readFileSync(at(val('--mcp-config')), 'utf8'));
const store = config.mcpServers.agentbox;
const server = spawn(store.command, store.args, { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });
let sbuf = '';
const waiting = new Map();
server.stdout.on('data', (d) => {
  sbuf += d;
  let i;
  while ((i = sbuf.indexOf('\n')) >= 0) {
    const msg = JSON.parse(sbuf.slice(0, i));
    sbuf = sbuf.slice(i + 1);
    waiting.get(msg.id)?.(msg);
  }
});
let nextId = 1;
const call = (method, params) => new Promise((resolve) => {
  const id = nextId++;
  waiting.set(id, resolve);
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});

let ibuf = '';
let busy = Promise.resolve();
process.stdin.on('data', (d) => {
  ibuf += d;
  let i;
  while ((i = ibuf.indexOf('\n')) >= 0) {
    const line = ibuf.slice(0, i);
    ibuf = ibuf.slice(i + 1);
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.type !== 'user') continue;
    const text = typeof msg.message?.content === 'string' ? msg.message.content : JSON.stringify(msg.message?.content);
    busy = busy.then(() => turn(text));
  }
});
process.stdin.on('end', async () => { await busy; server.stdin.end(); process.exit(0); });

async function turn(text) {
  if (text.includes('HANG')) {
    process.on('SIGTERM', () => setTimeout(() => process.exit(143), 200));
    await new Promise(() => {});
  }
  const list = await call('tools/list', {});
  const names = (list.result?.tools || []).map((t) => t.name);
  const tool = text.includes('LOOK') ? 'look_at_page' : 'note';
  const reply = await call('tools/call', { name: tool, arguments: { text } });
  const said = reply.result?.content?.[0]?.text ?? JSON.stringify(reply);
  if (text.includes('SLOW')) await new Promise((r) => setTimeout(r, 1500));
  if (text.includes('SWITCH')) execSync('git checkout -q -b somewhere-else');
  fs.appendFileSync('cloud.txt', 'made in the cloud\n');
  execSync('git add cloud.txt && git commit -q -m "From the cloud"');
  fs.writeFileSync('loose.txt', 'not committed\n');
  const attachment = (text.match(/ATTACH:(\S+)/) || [])[1];
  const attached = attachment ? fs.readFileSync(at(attachment), 'utf8').trim() : null;
  const dir = path.join(at(process.env.CLAUDE_CONFIG_DIR), 'projects', process.cwd().slice(root.length).replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `${sessionId}.jsonl`), JSON.stringify({ type: 'user', text }) + '\n');
  out({ type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } });
  out({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: JSON.stringify({ said, names, attached, token: process.env.CLAUDE_CODE_OAUTH_TOKEN || null, home: process.env.HOME === undefined ? null : 'set' }) });
}
