#!/usr/bin/env node
// GIVES ONE CLAUDE ACCOUNT ITS SIGN-IN FOR CLOUD RUNS, ONCE A YEAR.
//
//   node scripts/cloud-signin.mjs                 # the account in ~/.claude
//   node scripts/cloud-signin.mjs ~/.claude-2     # another account's folder
//
// It runs Claude Code's own `claude setup-token`, which opens Anthropic's
// sign-in page and prints a token that lasts a year and runs on that
// account's subscription. The token is saved for that account in the macOS
// keychain (on Linux, in a file only you can read) and handed to that
// account's cloud runs, and to nothing else. It is never an API key and it is
// never written into this repository. Then it checks the token really works
// by asking Claude one word with it, from an empty folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { accountKey, saveClaudeToken, readClaudeToken } from '../main/cloud/config.mjs';
import { tokenHider, tokenIn } from '../main/cloud/redact.mjs';

const configDir = accountKey(process.argv[2] ? process.argv[2].replace(/^~/, os.homedir()) : path.join(os.homedir(), '.claude'));
const say = (m) => console.log(`cloud-signin: ${m}`);

function runSetupToken() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir };
    for (const k of Object.keys(env)) if (/^ANTHROPIC_/.test(k)) delete env[k];
    const child = spawn('claude', ['setup-token'], { env, stdio: ['inherit', 'pipe', 'inherit'] });
    // THE TOKEN IS NEVER SHOWN (main/cloud/redact.mjs): the sign-in link and
    // the prompt for the code pass through as they arrive, the token does not.
    let seen = '';
    const shown = tokenHider((t) => process.stdout.write(t));
    child.stdout.on('data', (d) => { seen += d; shown.push(d); });
    child.on('error', reject);
    child.on('exit', () => {
      shown.end();
      const token = tokenIn(seen);
      if (token) resolve(token); else reject(new Error('no token was printed; was the sign-in finished?'));
    });
  });
}

function works(token) {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'agentbox-signin-check-'));
  try {
    const env = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token, CLAUDE_CONFIG_DIR: empty };
    for (const k of Object.keys(env)) if (/^ANTHROPIC_/.test(k)) delete env[k];
    const out = execFileSync('claude', ['-p', 'Reply with the single word: ok', '--max-turns', '1'], { cwd: empty, env, encoding: 'utf8', timeout: 120_000 });
    return /ok/i.test(out);
  } catch {
    return false;
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
}

async function main() {
  say(`signing in the Claude account in ${configDir}`);
  if (readClaudeToken(configDir)) say('it already has a cloud sign-in; this replaces it');
  const token = await runSetupToken();
  say('checking the sign-in works');
  if (!works(token)) throw new Error('Claude refused the new sign-in; nothing was saved');
  saveClaudeToken(configDir, token);
  say('saved. Cloud runs on this account will use it.');
}

main().catch((err) => { console.error(`cloud-signin: ${err.message}`); process.exit(1); });
