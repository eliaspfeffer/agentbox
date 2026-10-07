// A NEW PULL REQUEST BECOMES ONE REVIEW ROW, AND ONLY ONE.
//
// w-bde446f1aa, 2026-10-07: pull requests on the public repository were being
// noticed by somebody opening GitHub, which nobody does on a schedule. On the
// day this was written there were eight open (#13, #15, #16 to #20, #22) and
// none of them had reached the inbox. The watcher asks GitHub every few
// minutes, for a project somebody switched it on for, and files one row per
// pull request per head commit, with the review instructions first.
//
// What is pinned, each against a fake `gh` so no test touches GitHub:
//   - a pull request becomes one row, and asking again files nothing more;
//   - new commits file a fresh row and finish the stale one, but never while
//     an agent is still working on the stale one;
//   - drafts, the person's own pull requests and projects that did not switch
//     it on file nothing;
//   - a pull request merged or closed on GitHub finishes its open row;
//   - a failing `gh` files nothing and throws nothing.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadStore } from '../main/store-modules.mjs';
import { PullRequestWatcher } from '../main/pull-requests.mjs';
import { githubRepoOf, pullRequestRowId, PULL_REQUEST_PROTOCOL } from '../shared/pull-requests.mjs';

let dir, mods, prs, calls, me, failGh;

const PR = (number, over = {}) => ({
  number,
  title: `Change number ${number}`,
  author: { login: 'stranger' },
  headRefOid: `${number}abcdef0123456789`,
  isDraft: false,
  url: `https://github.com/acme/app/pull/${number}`,
  isCrossRepository: true,
  additions: 8,
  deletions: 0,
  changedFiles: 1,
  ...over,
});

// The fake command line: git answers the remote, gh answers the queue.
const run = async (cmd, args) => {
  calls.push([cmd, ...args].join(' '));
  if (cmd === 'git') return 'git@github.com:acme/app.git\n';
  if (failGh) throw new Error('gh: could not resolve host');
  if (args[0] === 'api' && args[1] === 'user') return `${me}\n`;
  if (args[0] === 'api' && /^repos\/acme\/app\/pulls\/\d+$/.test(args[1])) return 'FIRST_TIME_CONTRIBUTOR\n';
  if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify(prs);
  if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify({ files: [{ path: 'main/x.mjs', additions: 8, deletions: 0 }] });
  if (args[0] === 'pr' && args[1] === 'diff') return 'diff --git a/main/x.mjs b/main/x.mjs\n+++ b/main/x.mjs\n+const ok = 1;\n';
  throw new Error(`unexpected: ${cmd} ${args.join(' ')}`);
};

const product = () => ({ slug: 'acme', name: 'Acme', dir, repoPath: '/tmp/acme-repo' });
const watcher = (over = {}) => new PullRequestWatcher({
  store: { modules: mods, productDir: () => dir },
  products: () => [product()],
  watched: () => ['acme'],
  run,
  sandbox: '/app/scripts/run-untrusted.sh',
  isLive: () => false,
  ...over,
});
const rows = () => [...mods.workItemsDisk.readWorkItems(dir)];

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prs-'));
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({ schemaVersion: 1, id: 'acme', name: 'Acme' }));
  mods = await loadStore();
  prs = [PR(22)];
  calls = [];
  me = 'owner';
  failGh = false;
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('which repository a project is', () => {
  it('reads both shapes of a GitHub remote, and nothing else', () => {
    expect(githubRepoOf('git@github.com:acme/app.git')).toBe('acme/app');
    expect(githubRepoOf('https://github.com/acme/app')).toBe('acme/app');
    expect(githubRepoOf('https://github.com/acme/app.git\n')).toBe('acme/app');
    expect(githubRepoOf('https://gitlab.com/acme/app.git')).toBe(null);
    expect(githubRepoOf('')).toBe(null);
  });
});

describe('a pull request reaching the inbox', () => {
  it('files one row, carrying the review instructions first and the facts after', async () => {
    await watcher().poll(product());
    const list = rows();
    expect(list.length).toBe(1);
    const row = list[0];
    expect(row.id).toBe(pullRequestRowId(22, PR(22).headRefOid));
    expect(row.title).toBe('PR #22: Change number 22');
    expect(row.labels).toEqual(['founder', 'pull-request', 'pr:22']);
    // On Claude Code, where its permission rules apply.
    expect(row.engine).toBe('claude');
    expect(row.body).toContain('Their relation to the repository: FIRST_TIME_CONTRIBUTOR');
    expect(row.body.startsWith(PULL_REQUEST_PROTOCOL.slice(0, 60))).toBe(true);
    expect(row.body).toContain('https://github.com/acme/app/pull/22');
    expect(row.body).toContain('/app/scripts/run-untrusted.sh');
    expect(row.body).toContain('Running its code on this Mac: allowed');
    // The protocol names the real repository and number, not placeholders.
    expect(row.body).toContain('gh pr diff 22 -R acme/app');
    expect(row.body).not.toContain('<N>');
  });

  it('files nothing more when asked again about the same commit', async () => {
    const w = watcher();
    await w.poll(product());
    await w.poll(product());
    expect(rows().length).toBe(1);
  });

  it('tells the reviewer when a run here is not allowed, and why', async () => {
    prs = [PR(18, { title: 'Bump react and @types/react', author: { login: 'app/dependabot' } })];
    const deps = async (cmd, args) => {
      if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify({ files: [{ path: 'package.json', additions: 1, deletions: 1 }, { path: 'package-lock.json', additions: 280, deletions: 60 }] });
      return run(cmd, args);
    };
    await watcher({ run: deps }).poll(product());
    expect(rows()[0].body).toContain('Running its code on this Mac: not allowed');
    expect(rows()[0].body).toMatch(/dependencies/i);
  });

  it('files a fresh row for new commits and finishes the stale one', async () => {
    const w = watcher();
    await w.poll(product());
    const first = rows()[0].id;
    prs = [PR(22, { headRefOid: 'ffff000011112222' })];
    await w.poll(product());
    const list = rows();
    expect(list.length).toBe(2);
    expect(list.find((r) => r.id === first).status).toBe('done');
    const fresh = list.find((r) => r.id !== first);
    expect(fresh.status).toBe('open');
    expect(fresh.body).toContain(first);
  });

  // THE BOUNDARY: an agent halfway through the old review is not cut off, and
  // no second agent starts on the same pull request beside it.
  it('waits while an agent is still on the stale row', async () => {
    await watcher().poll(product());
    const first = rows()[0].id;
    prs = [PR(22, { headRefOid: 'ffff000011112222' })];
    await watcher({ isLive: (item) => item.id === first }).poll(product());
    expect(rows().length).toBe(1);
    expect(rows()[0].status).toBe('open');
  });

  it('finishes the open row of a pull request merged or closed on GitHub', async () => {
    await watcher().poll(product());
    prs = [];
    await watcher().poll(product());
    const row = rows()[0];
    expect(row.status).toBe('done');
    expect(row.note).toMatch(/no longer open on GitHub/);
  });
});

describe('what files nothing', () => {
  it('a draft', async () => {
    prs = [PR(22, { isDraft: true })];
    await watcher().poll(product());
    expect(rows()).toEqual([]);
  });

  it('a pull request the person opened themselves', async () => {
    prs = [PR(22, { author: { login: 'owner' } })];
    await watcher().poll(product());
    expect(rows()).toEqual([]);
  });

  // A draft is still open: its row, if it had one, is not "closed on GitHub".
  it('does not finish a row whose pull request went back to draft', async () => {
    await watcher().poll(product());
    prs = [PR(22, { isDraft: true })];
    await watcher().poll(product());
    expect(rows()[0].status).toBe('open');
  });

  it('a project nobody switched it on for, and asks GitHub nothing', async () => {
    await watcher({ watched: () => [] }).tick(Date.now());
    expect(rows()).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('a failing gh, without throwing and without finishing any row', async () => {
    await watcher().poll(product());
    failGh = true;
    await expect(watcher().poll(product())).resolves.not.toThrow();
    expect(rows().length).toBe(1);
    expect(rows()[0].status).toBe('open');
  });

  it('a project whose code is not on GitHub', async () => {
    const elsewhere = async (cmd, args) => (cmd === 'git' ? 'https://gitlab.com/acme/app.git\n' : run(cmd, args));
    await watcher({ run: elsewhere }).poll(product());
    expect(rows()).toEqual([]);
  });
});

describe('how often it asks', () => {
  it('asks GitHub at most once per interval per project, however often the app ticks', async () => {
    const w = watcher({ everyMs: 5 * 60 * 1000 });
    const t0 = 1_000_000;
    await w.tick(t0);
    await w.tick(t0 + 15_000);
    await w.tick(t0 + 60_000);
    expect(calls.filter((c) => c.startsWith('gh pr list')).length).toBe(1);
    await w.tick(t0 + 5 * 60 * 1000 + 1);
    expect(calls.filter((c) => c.startsWith('gh pr list')).length).toBe(2);
  });
});
