#!/usr/bin/env node
// THE MODEL BEHIND A REAL CODEX, FOR THE LIVE COPY, ANSWERING FROM THE TASK'S WORDS.
//
//   node stub-codex-server.mjs <instance folder>
//
// The real `codex` binary runs every worker: the app-server, its JSON-RPC, the
// sandbox, the rollout on disk, and Agentbox's own Codex modules. Only the
// language model is replaced, by scripts/lib/codex-stub-model.mjs on a loopback
// port, so nothing is billed and nobody's ~/.codex is read. `live.mjs up`
// starts this detached and points the copy's CODEX_HOME at it; `down` stops it
// (its command line names the instance folder, which is how `down` finds it).
//
// The task's words carry the script, the same words the Claude stand-in reads:
//   [[tok:abc]]          answer with "abc", so a proof can tell whose answer is whose
//   [[stub:slow:4000]]   take 4 s
//   [[stub:hang]]        never answer
//   [[stub:limit]]       refuse as a ChatGPT plan out of usage does (HTTP 429,
//                        usage_limit_reached), which Codex reports as usageLimitExceeded
//   [[stub:limit-first]] refuse the first time only
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const { createStubModel, messageItem, httpError, promptOf } = await import(path.join(REPO, 'scripts/lib/codex-stub-model.mjs'));

const instance = process.argv[2];
if (!instance) { console.error('usage: stub-codex-server.mjs <instance folder>'); process.exit(2); }
const seen = new Map();

const model = createStubModel({
  async respond(request) {
    const prompt = promptOf(request);
    const directive = (name) => prompt.match(new RegExp(`\\[\\[${name}(?::([^\\]]*))?\\]\\]`));
    const token = directive('tok')?.[1] ?? null;
    const key = token ?? prompt.slice(0, 200);
    const attempt = (seen.get(key) ?? 0) + 1;
    seen.set(key, attempt);
    fs.appendFileSync(path.join(instance, 'codex-model.log'), `${JSON.stringify({ at: Date.now(), token, attempt, chars: prompt.length })}\n`);
    if (directive('stub:limit') || (directive('stub:limit-first') && attempt === 1)) {
      return httpError(429, 'The usage limit has been reached', 'usage_limit_reached');
    }
    if (directive('stub:hang')) await new Promise(() => {});
    const slow = Number(directive('stub:slow')?.[1]);
    if (slow > 0) await new Promise((r) => setTimeout(r, slow));
    return [messageItem(`The verify Codex stand-in answered.${token ? ` [${token}]` : ''}`)];
  },
});

const url = await model.listen();
fs.writeFileSync(path.join(instance, 'codex-model.json'), `${JSON.stringify({ url, pid: process.pid })}\n`);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { model.close?.(); process.exit(0); });
