// A TASK WHOSE ACCOUNT IS OUT OF USAGE CARRIES ON UNDER ONE THAT IS NOT.
//
// w-ca48e69535. The shape: one Codex login hits its weekly limit. The user
// switches Agentbox to a second Codex login with room left, and replies on
// the row. Every reply goes back to the capped login, works for about two
// minutes and then fails with the line below, and the row sits still. Three
// things were wrong, and each has an assertion here:
//
//   1. A run that hits the limit after two minutes is not a "fast exit", so the
//      account was never marked, and the normal branch CLEARED its trouble.
//   2. Codex names a day, not an hour, so even a marked account would have come
//      back every thirty minutes for days.
//   3. The rule that moves a chat off a broken account only read Claude's
//      books, and waited out every usage limit however long it was.
import { describe, it, expect } from 'vitest';
import { Supervisor } from '../main/supervisor.mjs';
import { limitResetMoment, troubleCause } from '../shared/spawn-trouble.mjs';

// The line Codex prints, copied off a real run log.
const CODEX_LIMIT = "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Sep 28th, 2026 1:05 PM.";

const FIRST = 'default';
const SECOND = '/Users/her/.codex-2';

function bare(config = {}) {
  const s = Object.create(Supervisor.prototype);
  s.config = { authProfiles: ['default'], codexProfiles: [FIRST, SECOND], maxConcurrentSessions: 3, ...config };
  s._profileCooldown = {};
  s._profileStrikes = {};
  s._profileTrouble = {};
  s._saveState = () => {};
  return s;
}

// The same wording with a reset that is always ahead of the clock. The runs
// below are dated `Date.now()`, so the copied line above went stale at 1:05pm
// on 2026-09-28: past that moment the account is no longer capped and four
// assertions flipped on every machine (found on w-3fc39983be). The parsing
// test keeps the real line and its own fixed `from`.
const LIVE_LIMIT = CODEX_LIMIT.replace('2026', String(new Date().getFullYear() + 1));

const cappedAfterTwoMinutes = (profile = FIRST) => ({
  engine: 'codex',
  profile,
  startedAt: Date.now() - 118_800,
  result: LIVE_LIMIT,
  resultIsError: true,
  tail: [`stderr: usageLimitExceeded: ${LIVE_LIMIT}`],
});

describe('a limit is read as a limit', () => {
  it('is classified as one', () => {
    expect(troubleCause(CODEX_LIMIT)).toBe('at-limit');
  });

  it('waits until the day Codex names, not thirty minutes', () => {
    const from = new Date(2026, 8, 24, 14, 10).getTime();
    expect(limitResetMoment(CODEX_LIMIT, from)).toBe(new Date(2026, 8, 28, 13, 5).getTime());
  });

  it('still reads the hour-only wording', () => {
    const from = new Date(2026, 8, 24, 14, 10).getTime();
    expect(limitResetMoment("You've hit your limit · resets 6pm", from)).toBe(new Date(2026, 8, 24, 18, 0).getTime());
  });
});

describe('a run that hits the limit late marks its account', () => {
  it('marks the codex login, until the reset, and not her claude one', () => {
    const s = bare();
    s.noteExitForBackoff(cappedAfterTwoMinutes());
    expect(s._profileTrouble['codex:default']?.cause).toBe('at-limit');
    expect(s._profileCooldown['codex:default']).toBeGreaterThan(new Date(2026, 8, 28, 13, 0).getTime());
    expect(s._profileTrouble.default).toBeUndefined();
    expect(s._profileCooldown.default ?? 0).toBe(0);
  });

  it('keeps the capped login out of new work', () => {
    const s = bare();
    s.noteExitForBackoff(cappedAfterTwoMinutes());
    const picked = new Set();
    for (let i = 0; i < 10; i += 1) picked.add(s._pickProfile('codex'));
    expect([...picked]).toEqual([SECOND]);
  });

  // The branch this reuses must not swallow ordinary work: a long run that
  // ends cleanly still clears whatever was on its account.
  it('still clears an account when a long run ends normally', () => {
    const s = bare();
    s._profileTrouble['codex:default'] = { cause: 'unknown', since: 1, at: 1 };
    s.noteExitForBackoff({ engine: 'codex', profile: FIRST, startedAt: Date.now() - 600_000, result: 'done', resultIsError: false, tail: [] });
    expect(s._profileTrouble['codex:default']).toBeUndefined();
  });
});

describe('the chat moves to an account that can run it', () => {
  it('lets go of a capped codex login when another one can run', () => {
    const s = bare();
    s.noteExitForBackoff(cappedAfterTwoMinutes());
    expect(s._profileCannotHoldAChat(FIRST, 'codex')).toBe(true);
    expect(s._profileCannotHoldAChat(SECOND, 'codex')).toBe(false);
  });

  it('follows the account she picked', () => {
    const s = bare({ activeAccount: { codex: SECOND } });
    s.noteExitForBackoff(cappedAfterTwoMinutes());
    expect(s._profileCannotHoldAChat(FIRST, 'codex')).toBe(true);
    expect(s._pickProfile('codex')).toBe(SECOND);
  });

  // Nowhere better to go: dropping the chat would lose the thread and buy
  // nothing, so it waits for the reset as it always did.
  it('keeps the chat when the capped login is the only one', () => {
    const s = bare({ codexProfiles: [FIRST] });
    s.noteExitForBackoff(cappedAfterTwoMinutes());
    expect(s._profileCannotHoldAChat(FIRST, 'codex')).toBe(false);
  });

  it('keeps the chat when every login is capped', () => {
    const s = bare();
    s.noteExitForBackoff(cappedAfterTwoMinutes(FIRST));
    s.noteExitForBackoff(cappedAfterTwoMinutes(SECOND));
    expect(s._profileCannotHoldAChat(FIRST, 'codex')).toBe(false);
  });

  // WHERE HER REPLY GOES. `rowSessionFor` answering null is the fresh brief on
  // the picked account, carrying the row's own thread. That is the path a
  // hand-moved history takes, and it is the one known to work.
  it('sends her reply to a fresh session instead of the capped login', () => {
    const s = bare({ activeAccount: { codex: SECOND } });
    s._rowSessions = { 'w-1': { sessionId: 't-1', product: 'p', profile: FIRST, engine: 'codex' } };
    s._engineFor = () => 'codex';
    s.transcriptFile = () => '/somewhere/rollout.jsonl';
    const item = { id: 'w-1', product: 'p' };
    expect(s.rowSessionFor(item)).not.toBeNull();
    s.noteExitForBackoff(cappedAfterTwoMinutes());
    expect(s.rowSessionFor(item)).toBeNull();
  });

  // The same rule on Claude Code, so a second Claude subscription helps the
  // same way. A codex cap must not move a claude chat.
  it('works the same way for claude, and the engines stay apart', () => {
    const s = bare({ authProfiles: ['default', '/Users/her/.claude-second'] });
    s.noteExitForBackoff({ engine: 'claude', profile: 'default', startedAt: Date.now() - 300_000, result: "You've hit your limit · resets 6pm", resultIsError: true, tail: [] });
    expect(s._profileCannotHoldAChat('default', 'claude')).toBe(true);
    expect(s._profileCannotHoldAChat('default', 'codex')).toBe(false);
  });
});
