// WHICH ACCOUNT THE AGENTS ARE ACTUALLY RUNNING ON, read off this Mac.
//
// w-e217e577e5, 2026-10-07, from a session with a new user: "He didn't realize
// it auto-connected to Claude/Codex; he wasn't sure how it was even running."
//
// Every fact here was already on the disk and already being read, each by the
// screen that needed it: main/claude-plan.mjs for the Claude plan (the Accounts
// page), main/codex-account.mjs for the ChatGPT one (the Codex card). What did
// not exist was ONE answer to "what is powering this", in a shape small enough
// to ride the snapshot and be drawn in a corner. That is all this is: the two
// readers, asked about the one account the fleet is spending, and null whenever
// the answer would be a guess.
//
// NULL IS AN ORDINARY ANSWER AND IT MEANS DRAW NOTHING. A Mac mid-setup, a
// config file being rewritten under us, a login that exists with no plan string
// in it: the first two are null, the third is the name with no plan. Nothing
// here ever reports an account that is not there, because the corner it feeds
// is read by somebody deciding whose money this is spending.
//
// IT IS CACHED ON THE LOGIN FILES' OWN TIMES, NOT ON A CLOCK. The snapshot is
// built every ten seconds and `~/.claude.json` is 148 KB on the machine this was
// written on, so parsing it per tick is work nobody asked for; it is also a file
// that genuinely changes, since Claude Code refetches its own profile as it
// runs. `signInFiles`/`signInStamp` (main/sign-in-files.mjs) already name the
// files a login writes and read their modification times and nothing else, so
// the cache key is the newest of those times. A moved time re-reads. A cache
// that aged out on a timer instead would be either stale after a sign-in or
// re-parsing for nothing, and the file itself knows which.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planFile, planOfAccount } from './claude-plan.mjs';
import { codexAccount, codexAuthFile } from './codex-account.mjs';
import { signInFiles, signInStamp } from './sign-in-files.mjs';

/** keyed by engine and folder, valued by the stamp it was read at. */
const remembered = new Map();

/**
 * WHAT THE FLEET IS RUNNING ON, or null because nothing readable is signed in.
 *
 * @param {object} facts
 * @param {string} facts.engine Which coding agent the workspace runs on, which
 *   the supervisor has already decided (`Supervisor#engineFacts`). Never worked
 *   out here: the capability gate lives there, and a corner that guessed could
 *   name the subscription the fleet is not spending.
 * @param {string} [facts.claudeProfile] The Claude login, `default` or a folder.
 * @param {string} [facts.codexHome] The CODEX_HOME this workspace runs on.
 * @returns {{ engine: string, plan: string|null }|null} `plan` is the words the
 *   tool itself reports, never a label of ours.
 */
export function runsOn({ engine = null, home = os.homedir(), claudeProfile = 'default', codexHome = null } = {}) {
  if (engine !== 'claude' && engine !== 'codex') return null;
  const folder = engine === 'codex'
    ? (codexHome || path.join(home, '.codex'))
    : (!claudeProfile || claudeProfile === 'default' ? null : claudeProfile);
  // The home is in the key as well as the folder. A default Claude login has no
  // folder of its own, so without it two homes share one entry, which is exactly
  // what a test with a throwaway home does and what a packaged app would do if
  // HOME ever moved under it.
  const key = `${engine}:${home}:${folder ?? 'default'}`;
  const stamp = signInStamp(signInFiles({ engine, folder, home }));
  const seen = remembered.get(key);
  if (seen && seen.stamp === stamp) return seen.value;
  const value = stamp ? read(engine, { home, claudeProfile, folder }) : null;
  remembered.set(key, { stamp, value });
  return value;
}

function read(engine, { home, claudeProfile, folder }) {
  if (engine === 'codex') {
    const id = codexAccount(null, { file: codexAuthFile(folder) });
    return id ? { engine: 'codex', plan: id.plan ?? null } : null;
  }
  // THE LOGIN AND THE PLAN COME OUT OF ONE READ. `readPlan` answers only the
  // second, and "not signed in" and "signed in with no plan string" are two
  // different screens: the first draws nothing, the second draws the name.
  let account = null;
  try {
    account = JSON.parse(fs.readFileSync(planFile(claudeProfile, home), 'utf8'))?.oauthAccount ?? null;
  } catch {
    return null;
  }
  if (!account || typeof account !== 'object') return null;
  const plan = planOfAccount(account);
  return { engine: 'claude', plan: plan.known ? plan.label : null };
}

/** Forgets every cached reading. For tests, and for a sign-out that lands. */
export function forgetRunsOn() {
  remembered.clear();
}
