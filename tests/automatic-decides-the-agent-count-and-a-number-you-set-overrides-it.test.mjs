// AUTOMATIC DECIDES THE AGENT COUNT, AND A NUMBER YOU SET OVERRIDES IT — w-e5225b62ba.
//
// "The tool should figure out how many agents can be active at a time... that's
// more of an override that technical people should handle."
//
// WHAT THIS HAD TO NOT BREAK, which is most of the care in this file. The cap
// underneath is still per account and `_capacityFor` still multiplies it by the
// live accounts, so nothing downstream of it moved. Automatic only changes where
// that per-account number comes from: the machine, divided by the accounts,
// instead of a number sitting in zero.config.json.
//
// A SMALL PLAN STILL WINS. `slotsForPlans` answers one at a time for a
// subscription that is not Max, and that is a fact about the subscription rather
// than about the Mac, so Automatic may never raise it. It may only ever come out
// at or below what the plan allows.
//
// AND AN EXISTING INSTALL IS NOT QUIETLY CHANGED. Anybody who ever set the
// number by hand keeps exactly the number they set; Automatic is for the people
// who never touched it, which is what the old "fill it in once at load" was
// already doing less visibly.

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Supervisor } from '../main/supervisor.mjs';
import { autoAgents } from '../main/machine.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const made = [];
afterEach(() => { for (const s of made.splice(0)) s.stopMemoryGate?.(); });

/** A supervisor with `accounts` Claude logins and the config under test. */
function sup(config = {}, accounts = 1) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-agents-'));
  const store = { listItems: () => [], listProducts: () => [], isDue: () => true, readItem: () => null };
  const s = new Supervisor({ storeRoot: tmp, home: tmp, ...config }, store, root, tmp, tmp);
  s._liveProfilesFor = () => Array.from({ length: accounts }, (_, i) => (i ? `p${i}` : 'default'));
  s.engineChoices = () => [{ id: 'claude' }];
  made.push(s);
  return s;
}

const here = (gated, nudge = 0) => autoAgents({ gated, nudge });

describe('with Automatic on', () => {
  it('asks the machine, not the config', () => {
    const s = sup({ agentsAuto: true, memoryGate: false, maxConcurrentSessions: 99 });
    expect(s._slotsPerAccount('claude')).toBe(here(false));
  });

  it('carries more once the memory check is on, because heavy work takes turns', () => {
    const off = sup({ agentsAuto: true, memoryGate: false });
    const on = sup({ agentsAuto: true, memoryGate: true });
    expect(on._slotsPerAccount('claude')).toBeGreaterThan(off._slotsPerAccount('claude'));
  });

  it('splits the machine`s number across the accounts rather than per account', () => {
    // THE BUG THIS EXISTS FOR: the number used to be per account, so connecting a
    // second account silently doubled what the Mac was asked to carry.
    const one = sup({ agentsAuto: true, memoryGate: true }, 1);
    const two = sup({ agentsAuto: true, memoryGate: true }, 2);
    expect(one._capacityFor('claude')).toBe(two._capacityFor('claude'));
  });

  it('comes down a step each time you say something felt slow', () => {
    const calm = sup({ agentsAuto: true, memoryGate: true }, 1);
    const once = sup({ agentsAuto: true, memoryGate: true, agentsNudge: 1 }, 1);
    expect(once._slotsPerAccount('claude')).toBe(calm._slotsPerAccount('claude') - 1);
  });

  it('never comes out at none, however many times you said it', () => {
    const s = sup({ agentsAuto: true, memoryGate: true, agentsNudge: 99 }, 1);
    expect(s._slotsPerAccount('claude')).toBe(1);
  });

  it('obeys a plan that allows one at a time, whatever the Mac could carry', () => {
    const s = sup({ agentsAuto: true, memoryGate: true, maxConcurrentSessions: 1, planSlotsFrom: 'Pro' }, 1);
    expect(s._slotsPerAccount('claude')).toBe(1);
  });

  it('is not raised by a plan either: a generous plan still leaves the Mac in charge', () => {
    const s = sup({ agentsAuto: true, memoryGate: true, maxConcurrentSessions: 99, planSlotsFrom: 'Max' }, 1);
    expect(s._slotsPerAccount('claude')).toBe(here(true));
  });
});

describe('with a number you set', () => {
  it('uses it exactly, and the machine is not consulted', () => {
    const s = sup({ agentsAuto: false, memoryGate: true, maxConcurrentSessions: 9 }, 1);
    expect(s._slotsPerAccount('claude')).toBe(9);
  });

  it('stays per account, which is what it always was', () => {
    const two = sup({ agentsAuto: false, memoryGate: true, maxConcurrentSessions: 4 }, 2);
    expect(two._capacityFor('claude')).toBe(8);
  });

  it('never drops the fleet to nothing when the number is nonsense', () => {
    for (const bad of [0, -2, null, 'three', undefined]) {
      expect(sup({ agentsAuto: false, maxConcurrentSessions: bad }, 1)._slotsPerAccount('claude')).toBe(1);
    }
  });
});
