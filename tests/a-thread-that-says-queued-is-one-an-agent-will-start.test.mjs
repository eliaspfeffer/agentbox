// A THREAD THAT SAYS "QUEUED" IS ONE AN AGENT WILL START.
//
// A tester on a Mac with only Codex started a thread and it sat at "Queued"
// with nothing running and nothing said (2026-10-06). The plain path was
// measured first and works: a Codex-only Mac with a repository starts a
// composed thread on Codex inside a tick. Three other paths did not, and each
// left the row reading "Queued. An agent starts on it as soon as one is free":
//
//   - A thread sent while the setup walk was up, or left half finished, waited
//     out the walk's twenty-minute hold on every agent.
//   - A thread in the practice project is refused by every spawn path, yet
//     `status().queued` listed it, so it said Queued for ever.
//   - With a second Codex account half added ("Not signed in" in Settings),
//     the round-robin handed the first thread to that account and not to the
//     signed-in one. Measured: the spawn's CODEX_HOME was the empty home.

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const spawns = vi.hoisted(() => []);
vi.mock('node:child_process', async (importActual) => {
  const actual = await importActual();
  const { EventEmitter: Emitter } = await import('node:events');
  return {
    ...actual,
    spawn: (bin, args, options) => {
      spawns.push({ bin, args, options });
      const child = new Emitter();
      child.stdout = new Emitter();
      child.stderr = new Emitter();
      child.stdin = Object.assign(new Emitter(), { write: (_c, cb) => { cb?.(null); return true; }, end() {} });
      child.kill = () => true;
      return child;
    },
  };
});

vi.mock('../main/account-tooling.mjs', async (importActual) => ({
  ...(await importActual()),
  linkAccountTooling: () => null,
}));

const { Supervisor } = await import('../main/supervisor.mjs');

const CODEX_BIN = '/nonexistent/codex/codex';
const dirs = [];
const temp = (name) => { const d = mkdtempSync(join(tmpdir(), name)); dirs.push(d); return d; };

function build({ items = [], products, extra = {} } = {}) {
  const dir = temp('queued-');
  const list = products ?? [{ slug: 'shop', name: 'Shop', dir, repoPath: null }];
  const sup = new Supervisor(
    {
      home: '/nonexistent-home', storeRoot: dir, claudeBin: '/nonexistent/claude',
      claudeFound: false, codexBin: CODEX_BIN, maxConcurrentSessions: 3,
      ...extra,
    },
    {
      listItems: () => items,
      listProducts: () => list,
      getProduct: (slug) => list.find((p) => p.slug === slug),
      isDue: () => true,
      settleAnswer() {},
      recordSessionResult() {},
      listRepeats: () => [],
    },
    '/nonexistent-app',
  );
  return sup;
}

const row = (extra = {}) => ({
  id: 'w-task', product: 'shop', kind: 'directive', status: 'open', title: 'Review the repo',
  body: '', labels: ['founder'], priority: 5, createdAt: 1, updatedAt: 1,
  claim: null, claimExpired: false, ...extra,
});

const codexSpawns = () => spawns.filter((s) => s.bin === CODEX_BIN && s.args[0] === 'app-server');

beforeEach(() => { spawns.length = 0; });
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

describe('a thread sent during the setup walk', () => {
  it('ends the hold and starts', async () => {
    const sup = build({ items: [row()] });
    sup.firstRunWalking(true);
    sup.sentByThem(['founder']);
    expect(sup.firstRunHolding()).toBe(false);
    await sup.tick();
    expect(codexSpawns()).toHaveLength(1);
  });

  it('but the walk\'s own thread keeps the hold', () => {
    const sup = build();
    sup.firstRunWalking(true);
    sup.sentByThem(['founder', 'first-run']);
    expect(sup.firstRunHolding()).toBe(true);
  });

  it('and with no walk up there is nothing to end', () => {
    const sup = build();
    let changes = 0;
    sup.onChange = () => { changes += 1; };
    sup.sentByThem(['founder']);
    expect(changes).toBe(0);
  });
});

describe('a thread in the practice project', () => {
  it('is never listed as queued, since nothing runs there', () => {
    const dir = temp('practice-');
    const sup = build({
      items: [row({ product: 'practice' }), row({ id: 'w-real' })],
      products: [
        { slug: 'practice', name: 'Practice', dir, practice: true },
        { slug: 'shop', name: 'Shop', dir, repoPath: null },
      ],
    });
    expect(sup.status().queued).toEqual(['w-real']);
  });
});

describe('a Codex account still being added', () => {
  function twoAccounts({ secondSignedIn = false } = {}) {
    const signedIn = temp('codex-signed-in-');
    writeFileSync(join(signedIn, 'auth.json'), '{}');
    const halfAdded = temp('codex-half-added-');
    mkdirSync(halfAdded, { recursive: true });
    if (secondSignedIn) writeFileSync(join(halfAdded, 'auth.json'), '{}');
    return { signedIn, halfAdded };
  }

  it('is not handed the first thread while the signed-in one sits idle', async () => {
    const { signedIn, halfAdded } = twoAccounts();
    const sup = build({ items: [row()], extra: { codexHome: signedIn, codexProfiles: ['default', halfAdded] } });
    await sup.tick();
    expect(codexSpawns()).toHaveLength(1);
    expect(codexSpawns()[0].options.env.CODEX_HOME).toBe(signedIn);
  });

  it('nor any thread after it', () => {
    const { halfAdded, signedIn } = twoAccounts();
    const sup = build({ extra: { codexHome: signedIn, codexProfiles: ['default', halfAdded] } });
    expect([1, 2, 3, 4].map(() => sup._pickProfile('codex'))).toEqual(['default', 'default', 'default', 'default']);
  });

  it('takes its turn once its sign-in lands', () => {
    const { halfAdded, signedIn } = twoAccounts({ secondSignedIn: true });
    const sup = build({ extra: { codexHome: signedIn, codexProfiles: ['default', halfAdded] } });
    expect(new Set([1, 2].map(() => sup._pickProfile('codex')))).toEqual(new Set(['default', halfAdded]));
  });

  it('is still tried when no account has a sign-in, so a signed-out Mac says so', () => {
    const sup = build({ extra: { codexHome: temp('codex-empty-'), codexProfiles: ['default'] } });
    expect(sup._pickProfile('codex')).toBe('default');
  });
});
