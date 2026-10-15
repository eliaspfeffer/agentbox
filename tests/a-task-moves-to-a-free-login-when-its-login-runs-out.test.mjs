// A TASK MOVES TO A FREE LOGIN WHEN ITS OWN LOGIN RUNS OUT.
//
// Found 2026-10-12 by the pre-deploy check's live drive
// (.claude/skills/verify-agentbox), with two Claude logins on the copy: a new
// task landed on the second login, which was out of usage, while the first
// login was free (a task sent alongside it ran there and answered). For the
// three minutes measured the task never ran again, and its row told the person
// "Claude Code is at its usage limit … It starts again on its own at 11:59pm",
// hours away. In the code it would have slept a full 15-minute rest first:
// `restingUntil` woke a row only when THE login that refused it came back, and
// otherwise put it on the rest ladder, never asking whether another login was
// free.
//
// Only fresh work is gated by `restingUntil`, so moving it loses nothing: a
// task whose only run died on arrival has no conversation to resume.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Supervisor } from '../main/supervisor.mjs';

const T0 = new Date(2026, 9, 12, 15, 48, 0).getTime();
const TONIGHT = new Date(2026, 9, 12, 23, 59, 0).getTime();
let root, home, second;

const start = (profiles) => new Supervisor(
  // A Mac with both engines, and Codex choosable.
  { home, storeRoot: root, maxConcurrentSessions: 3, authProfiles: profiles, engineChoice: '2026-01-01T00:00:00.000Z', codexBin: '/opt/homebrew/bin/codex' },
  { listItems: () => [], listProducts: () => [] },
  '/nonexistent-app',
);
const item = (extra = {}) => ({ id: 'w-0a1b2c3d4e', product: 'sandbox', title: 'Do it', labels: ['founder'], ...extra });

/** The state one run that died at a usage limit leaves behind. */
function ranOutOn(sup, account, row = item()) {
  sup._fruitless = { [`${row.product}:${row.id}`]: { runs: 1, endedAt: T0, founderAt: T0 - 1000, account, saidAt: T0, saidTs: T0, saidWhy: 'at-limit' } };
  sup._profileCooldown = { ...(sup._profileCooldown ?? {}), [account]: TONIGHT };
  sup._profileTrouble = { ...(sup._profileTrouble ?? {}), [account]: { since: T0, at: T0, cause: 'at-limit', resetsAt: TONIGHT } };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0 + 30_000);
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'free-login-'));
  home = path.join(root, 'home');
  second = path.join(home, '.claude-second');
  fs.mkdirSync(second, { recursive: true });
});
afterEach(() => { vi.useRealTimers(); fs.rmSync(root, { recursive: true, force: true }); });

describe('one login is out of usage and another is free', () => {
  it('the task is awake now, not at the next rest or at the reset', () => {
    const sup = start(['default', second]);
    ranOutOn(sup, second);
    expect(sup.restingUntil(item())).toBe(0);
  });

  it('the same when it was the main login that ran out', () => {
    const sup = start(['default', second]);
    ranOutOn(sup, 'default');
    expect(sup.restingUntil(item())).toBe(0);
  });

  it('and the next login picked for it is the free one', () => {
    const sup = start(['default', second]);
    ranOutOn(sup, second);
    for (let i = 0; i < 4; i += 1) expect(sup._pickProfile('claude')).toBe('default');
  });
});

describe('no login can take it', () => {
  it('both logins out: it rests', () => {
    const sup = start(['default', second]);
    ranOutOn(sup, second);
    ranOutOn(sup, 'default');
    expect(sup.restingUntil(item())).toBeGreaterThan(Date.now());
  });

  it('the only login out: it rests', () => {
    const sup = start(['default']);
    ranOutOn(sup, 'default');
    expect(sup.restingUntil(item())).toBeGreaterThan(Date.now());
  });

  it('the other login is in trouble of its own (signed out): it rests', () => {
    const sup = start(['default', second]);
    ranOutOn(sup, second);
    sup._profileTrouble.default = { since: T0, at: T0, cause: 'signed-out' };
    expect(sup.restingUntil(item())).toBeGreaterThan(Date.now());
  });

  it('a Codex task whose Codex login ran out does not count free Claude logins', () => {
    const sup = start(['default', second]);
    // Chosen on the row after Codex was turned on, so it really runs on Codex.
    const codexTask = item({ engine: 'codex', wrote: { engine: { ts: T0 - 5000, source: 'founder' } } });
    ranOutOn(sup, 'codex:default', codexTask);
    expect(sup._engineFor(codexTask)).toBe('codex');
    expect(sup.restingUntil(codexTask)).toBeGreaterThan(Date.now());
  });

  it('a task that rests for a reason that is not its login still rests', () => {
    const sup = start(['default', second]);
    sup._fruitless = { 'sandbox:w-0a1b2c3d4e': { runs: 1, endedAt: T0, founderAt: T0 - 1000 } };
    expect(sup.restingUntil(item())).toBeGreaterThan(Date.now());
  });
});
