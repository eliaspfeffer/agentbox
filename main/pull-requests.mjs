// THE PULL REQUEST WATCHER (w-bde446f1aa, 2026-10-07).
//
// For a project somebody switched it on for, it asks GitHub every few minutes
// which pull requests are open and files ONE row per pull request per head
// commit, the review instructions first (shared/pull-requests.mjs). The row
// carries the founder label, the way a repeat's run does, so the fresh-work
// pass spawns its reviewer: nothing here spawns anything.
//
// OFF UNLESS A PERSON TURNS IT ON, in this Mac's own config
// (`pullRequestProducts`), never in the store or the repository, where an
// agent could switch it on for itself. On a team, only the Macs that turned it
// on look, and the row ids are the same from every Mac, so two that both look
// still describe one row.
//
// Asking GitHub is slow and can fail, so it never holds the tick: the
// supervisor starts a look and does not wait for it, and a failed look files
// nothing, finishes nothing and is tried again next interval.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import {
  PULL_REQUEST_LABEL, githubRepoOf, planPullRequestRows, pullRequestLabel, pullRequestRowBody, scanPullRequest,
} from '../shared/pull-requests.mjs';

const EVERY_MS = 5 * 60 * 1000;
const FIELDS = 'number,title,author,headRefOid,isDraft,url,isCrossRepository,additions,deletions,changedFiles';

// An app opened from the Dock does not have Homebrew on its PATH, and that is
// where `gh` almost always is.
const GH_CANDIDATES = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh'];
export const ghPath = () => GH_CANDIDATES.find((p) => fs.existsSync(p)) ?? 'gh';

export function runCommand(cmd, args, { cwd, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd === 'gh' ? ghPath() : cmd, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' },
    }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });
}

export class PullRequestWatcher {
  constructor({ store, products, watched, run = runCommand, sandbox, isLive = () => false, everyMs = EVERY_MS }) {
    this.store = store;
    this.products = products;
    this.watched = watched;
    this.run = run;
    this.sandbox = sandbox;
    this.isLive = isLive;
    this.everyMs = everyMs;
    this.lastLook = new Map();
    this.inFlight = new Set();
    this.me = null;
  }

  /** One look per watched project per interval. Safe to call every tick. */
  async tick(now = Date.now()) {
    const on = new Set(this.watched() ?? []);
    if (!on.size) return;
    for (const product of this.products()) {
      if (!on.has(product.slug) || !product.repoPath) continue;
      if (this.inFlight.has(product.slug)) continue;
      if (now - (this.lastLook.get(product.slug) ?? -Infinity) < this.everyMs) continue;
      this.lastLook.set(product.slug, now);
      this.inFlight.add(product.slug);
      try { await this.poll(product, now); } finally { this.inFlight.delete(product.slug); }
    }
  }

  // Who `gh` is signed in as, so the person's own pull requests are not
  // reviewed back to them. Unknown is fine: then nothing is skipped for it.
  async whoAmI() {
    if (this.me) return this.me;
    try { this.me = (await this.run('gh', ['api', 'user', '--jq', '.login'])).trim() || null; } catch { this.me = null; }
    return this.me;
  }

  async poll(product, now = Date.now()) {
    try {
      return await this._poll(product, now);
    } catch (err) {
      console.warn(`pull requests: could not look at ${product.slug}: ${err.message}`);
      return null;
    }
  }

  async _poll(product, now) {
    const remote = await this.run('git', ['-C', product.repoPath, 'remote', 'get-url', 'origin']);
    const repo = githubRepoOf(remote);
    if (!repo) return null;
    const me = await this.whoAmI();
    const prs = JSON.parse(await this.run('gh', ['pr', 'list', '-R', repo, '--state', 'open', '--limit', '100', '--json', FIELDS]));
    if (!Array.isArray(prs)) return null;

    const { workItemsDisk, lock } = this.store.modules;
    const dir = this.store.productDir(product.slug);
    const live = (item) => this.isLive({ ...item, product: product.slug });
    const plan = planPullRequestRows({ prs, items: workItemsDisk.readWorkItems(dir, now), me, isLive: live });

    // The slow part, outside the lock: what each new pull request changes.
    const ready = [];
    for (const entry of plan.create) {
      const n = String(entry.pr.number);
      let files = [];
      let diff = '';
      try { files = JSON.parse(await this.run('gh', ['pr', 'view', n, '-R', repo, '--json', 'files'])).files ?? []; } catch {}
      try { diff = await this.run('gh', ['pr', 'diff', n, '-R', repo]); } catch {}
      // Looked up here because `gh api` asks for a card on a review row.
      let association = null;
      try { association = (await this.run('gh', ['api', `repos/${repo}/pulls/${n}`, '--jq', '.author_association'])).trim() || null; } catch {}
      let account = null;
      const login = entry.pr.author?.login;
      if (login && !login.includes('/')) {
        try {
          const [created, repos] = (await this.run('gh', ['api', `users/${login}`, '--jq', '.created_at, .public_repos'])).trim().split('\n');
          if (created) account = `opened ${created.slice(0, 10)}, ${repos ?? '?'} public repositories`;
        } catch {}
      }
      const flags = scanPullRequest({ files, diff });
      // Not being able to see it is not evidence there is nothing to see.
      if (!diff.trim()) flags.push({ flag: 'unreadable', why: 'its diff could not be fetched, so the app has read none of it', files: [], holdsRun: true });
      ready.push({ ...entry, pr: { ...entry.pr, association, account }, flags });
    }

    // Re-read inside the lock: a worker can take or finish a row between the
    // look above and these writes.
    const still = (id) => {
      const item = workItemsDisk.readWorkItem(dir, id, now);
      return item && item.status !== 'done' && item.status !== 'claimed' && !live(item) ? item : null;
    };
    return lock.withProjectLock(dir, async () => {
      for (const id of plan.supersede) {
        if (!still(id)) continue;
        workItemsDisk.updateWorkItem(dir, id, {
          status: 'done',
          note: 'New commits arrived on this pull request, so a fresh review of them replaced this one.',
        }, { source: 'system', now });
      }
      let created = 0;
      for (const { pr, id, previous, flags } of ready) {
        const out = workItemsDisk.createWorkItemIfAbsent(dir, id, {
          title: `PR #${pr.number}: ${String(pr.title ?? '').trim() || 'untitled'}`,
          body: pullRequestRowBody({ pr, repo, repoPath: product.repoPath, sandbox: this.sandbox, flags, previous, rowId: id }),
          kind: 'directive',
          labels: ['founder', PULL_REQUEST_LABEL, pullRequestLabel(pr.number)],
          // ON CLAUDE CODE, where the review's permission rules apply
          // (PULL_REQUEST_RULES). A Mac with only Codex runs it on Codex anyway
          // (`engineFor`), under Codex's own approvals.
          engine: 'claude',
        }, { source: 'system', now });
        if (out.created) created += 1;
      }
      for (const id of plan.gone) {
        if (!still(id)) continue;
        workItemsDisk.updateWorkItem(dir, id, {
          status: 'done',
          note: 'This pull request is no longer open on GitHub (it was merged or closed there), so there is nothing left to review.',
        }, { source: 'system', now });
      }
      return { repo, created, superseded: plan.supersede.length, gone: plan.gone.length };
    }, { label: 'pull requests' });
  }
}
