// A CODEX TASK RUNS ON THE ACCOUNT WHOSE PLAN HAS ITS MODEL.
//
// What broke (w-f1c00e679d, measured 2026-10-11 on the Mac it happened on): a
// weekend testing sprint was set to GPT-6.1-Sol on Codex, with 1d 17h of the
// plan's usage left to spend. Two Codex logins were signed in: the main one on
// a Pro plan, whose model list carries gpt-6.1-sol, and a second on the FREE
// plan, whose list does not. Work round-robins across the two, and the model
// check only ever read the main login's list, so the sprint was sent to the
// free one and died in 1.7 seconds on Codex's own refusal:
//
//   The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.
//
// It was filed as a cause nobody could name ("Codex stopped before it did
// anything"), the row went to Waiting, and the next try was forty hours later,
// on the same free login, with the same result. The whole weekend's usage went
// unused.
//
// Four things are asserted: the pick skips a login whose own list lacks the
// model; a refusal Codex makes anyway (a stale list) moves the task to a login
// that has it, at once, without benching the login for every other model; the
// check before the thread reads the list of the login that will actually run;
// and the words on her row say what happened and what to do.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Supervisor } from '../main/supervisor.mjs';
import { troubleCause, deadRunSentence, deadRunCause, needsHerHands, causeBreakdown } from '../shared/spawn-trouble.mjs';
import { shortNext } from '../renderer/src/trouble-row.ts';

// Copied off the two dead runs' trace logs.
const REFUSAL = "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.";
const REFUSAL_FRAME = JSON.stringify({ type: 'error', status: 400, error: { type: 'invalid_request_error', message: REFUSAL } });

let root;
let PRO;
let FREE;

// The two model lists as Codex keeps them, cut down to what is read.
const PRO_MODELS = ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-terra'];
const FREE_MODELS = ['gpt-6-luna', 'gpt-5.6-terra'];

function home(name, slugs) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  if (slugs) {
    fs.writeFileSync(path.join(dir, 'models_cache.json'), JSON.stringify({
      models: slugs.map((slug, i) => ({ slug, display_name: slug, visibility: 'list', priority: i, supported_reasoning_levels: [{ effort: 'high' }] })),
    }));
  }
  return dir;
}

function bare(config = {}) {
  const s = Object.create(Supervisor.prototype);
  // 'default' is the main login, which `_codexHome` resolves through
  // `config.codexHome`; the second is a home in its own right.
  s.config = { authProfiles: ['default'], codexHome: PRO, codexProfiles: ['default', FREE], maxConcurrentSessions: 3, ...config };
  s._profileCooldown = {};
  s._profileStrikes = {};
  s._profileTrouble = {};
  s._saveState = () => {};
  return s;
}

const refusedOn = (profile, extra = {}) => ({
  engine: 'codex',
  profile,
  model: 'gpt-6.1-sol',
  startedAt: Date.now() - 1_700,
  result: REFUSAL_FRAME,
  resultIsError: true,
  tail: [`stderr: ${REFUSAL_FRAME}`],
  ...extra,
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-plan-'));
  PRO = home('pro', PRO_MODELS);
  FREE = home('free', FREE_MODELS);
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function picks(s, model, n = 10) {
  const out = new Set();
  for (let i = 0; i < n; i += 1) out.add(s._pickProfile('codex', { model }));
  return [...out].sort();
}

describe('the pick', () => {
  it('sends a model only one plan has to that plan, every time', () => {
    expect(picks(bare(), 'gpt-6.1-sol')).toEqual(['default']);
  });

  it('still uses both logins for a model both plans have', () => {
    expect(picks(bare(), 'gpt-6-luna')).toEqual(['default', FREE].sort());
  });

  it('still uses both logins when the task names no model', () => {
    expect(picks(bare(), null)).toEqual(['default', FREE].sort());
    expect(picks(bare(), '')).toEqual(['default', FREE].sort());
  });

  // A login with no list on disk cannot be judged, and a guess would take
  // work away from a login that might well have the model.
  it('does not judge a login whose list it cannot read', () => {
    const unread = home('unread', null);
    expect(picks(bare({ codexProfiles: ['default', unread] }), 'gpt-6.1-sol')).toEqual(['default', unread].sort());
  });

  // Nowhere has it: somewhere still has to be tried, and the check before the
  // thread says why in words (below), rather than the pick answering nothing.
  it('falls back to the ordinary rotation when no login has the model', () => {
    expect(picks(bare(), 'gpt-9-imaginary')).toEqual(['default', FREE].sort());
  });

  // Claude Code keeps no per-login list to read, so nothing is ruled out.
  it('rules no claude login out', () => {
    expect(bare()._planLacksModel('claude', 'default', 'gpt-6.1-sol')).toBe(false);
  });
});

describe('the words Codex uses', () => {
  it('reads the refusal as the plan lacking the model', () => {
    expect(troubleCause(REFUSAL)).toBe('model-not-on-plan');
    expect(troubleCause(REFUSAL_FRAME)).toBe('model-not-on-plan');
  });

  // It is not a signed-out login, and must not bench the account for a person.
  it('is not a cause that needs her hands on the account', () => {
    expect(needsHerHands('model-not-on-plan')).toBe(false);
  });

  it('does not swallow a model that simply does not exist', () => {
    expect(troubleCause("The model 'gpt-9' does not exist")).not.toBe('model-not-on-plan');
  });
});

describe('a refusal Codex makes anyway', () => {
  // The free login's list is stale and still claims the model.
  function staleFree() {
    return home('stale-free', PRO_MODELS);
  }

  it('moves that model off the login that refused it, and keeps the login for others', () => {
    const stale = staleFree();
    const s = bare({ codexProfiles: ['default', stale] });
    expect(picks(s, 'gpt-6.1-sol')).toEqual(['default', stale].sort());
    s.noteExitForBackoff(refusedOn(stale));
    expect(picks(s, 'gpt-6.1-sol')).toEqual(['default']);
    expect(picks(s, 'gpt-6-luna')).toEqual(['default', stale].sort());
  });

  it('files no trouble and no strike against the login', () => {
    const stale = staleFree();
    const s = bare({ codexProfiles: ['default', stale] });
    for (let i = 0; i < 3; i += 1) s.noteExitForBackoff(refusedOn(stale));
    expect(s._profileTrouble[`codex:${stale}`]).toBeUndefined();
    expect(s._profileCooldown[`codex:${stale}`] ?? 0).toBe(0);
  });

  it('is the account\'s fault, not the row\'s, when another login has the model', () => {
    const stale = staleFree();
    const s = bare({ codexProfiles: ['default', stale] });
    const session = refusedOn(stale);
    s.noteExitForBackoff(session);
    expect(session.accountFault).toEqual({ cause: 'model-not-on-plan', account: `codex:${stale}` });
  });

  // Nowhere else to go: an instant retry would be a loop, so the row rests
  // and her row asks her to pick another model.
  it('is the row\'s to wait on when no login has the model', () => {
    const s = bare({ codexProfiles: ['default'], codexHome: FREE });
    const session = refusedOn('default');
    s.noteExitForBackoff(session);
    expect(session.accountFault).toBeUndefined();
  });

  it('does not touch her claude books', () => {
    const s = bare();
    s.noteExitForBackoff(refusedOn(FREE));
    expect(s._profileTrouble.default).toBeUndefined();
    expect(s._profileStrikes.default ?? 0).toBe(0);
  });
});

describe('the check before the thread starts', () => {
  const plan = { model: 'gpt-6.1-sol', effort: 'high', product: 'p' };

  it('reads the list of the login that will run, not the main one', () => {
    const s = bare();
    expect(() => s.codexThreadParamsFor(plan, '/tmp', [], null, PRO)).not.toThrow();
    let said = '';
    try { s.codexThreadParamsFor(plan, '/tmp', [], null, FREE); } catch (e) { said = e.message; }
    expect(said).toContain('gpt-6.1-sol');
    expect(troubleCause(said)).toBe('model-not-on-plan');
  });

  it('still calls a word no login knows an unknown model', () => {
    const s = bare();
    let said = '';
    try { s.codexThreadParamsFor({ model: 'gpt-9-imaginary' }, '/tmp', [], null, FREE); } catch (e) { said = e.message; }
    expect(said).toContain('not a model the Codex on this computer knows');
  });
});

describe('the words on her row', () => {
  it('names what happened in the first line, under the inbox clip', () => {
    const line = deadRunSentence({ engineWord: 'Codex', cause: 'model-not-on-plan' });
    const first = line.split('. ')[0] + '.';
    expect(first.length).toBeLessThan(112);
    expect(first).toMatch(/model/);
    expect(first).toMatch(/plan/);
    expect(deadRunCause(line)).toBe('model-not-on-plan');
  });

  it('says it is moving when another login has the model', () => {
    expect(deadRunSentence({ engineWord: 'Codex', cause: 'model-not-on-plan', elsewhere: true })).toMatch(/runs it again on a Codex account whose plan has it/);
  });

  it('asks for another model when none does', () => {
    const line = deadRunSentence({ engineWord: 'Codex', cause: 'model-not-on-plan', elsewhere: false });
    expect(line).toMatch(/Pick another model/);
    expect(line).not.toMatch(/keeps trying/);
  });

  it('is counted above the list as hers to fix, in a few words', () => {
    const [row] = causeBreakdown([{ cause: 'model-not-on-plan' }, { cause: 'interrupted' }]);
    expect(row.cause).toBe('model-not-on-plan');
    expect(row.hers).toBe(true);
    expect(shortNext(row)).toBe('need another model');
  });

  // The row comes back to the queue after our own sentence, but only when
  // there is a login to take it to.
  it('lets the row run again when another login has the model', () => {
    const s = bare();
    s._fruitless = { 'p:w-1': { runs: 1, saidTs: 5, saidWhy: 'model-not-on-plan', account: `codex:${FREE}` } };
    expect(s._onlyWeSpokeForAnAccount({ product: 'p', id: 'w-1', wrote: { result: { ts: 5, source: 'agent' } } })).toBe(true);
    s._fruitless['p:w-1'].account = undefined;
    expect(s._onlyWeSpokeForAnAccount({ product: 'p', id: 'w-1', wrote: { result: { ts: 5, source: 'agent' } } })).toBe(false);
  });
});
