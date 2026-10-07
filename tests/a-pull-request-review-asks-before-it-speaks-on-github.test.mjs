// A PULL REQUEST REVIEW ASKS BEFORE IT SAYS ANYTHING ON GITHUB.
//
// w-bde446f1aa, 2026-10-07. A review agent spends its whole run reading text a
// stranger wrote, and the classic attack on it is a line in that text telling
// it to merge, approve or post something. Its instructions say never to, and
// instructions can be argued with. So a pull request row is the one kind of
// row that carries permission rules of ours: every command that speaks on
// GitHub, pushes, or reaches the network by hand raises an approval card
// showing the exact command, and the `gh` token cannot be printed at all.
//
// Every other row still carries none (w-6ade63e1aa): that is the case that
// must not match, pinned below beside the one that must.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Supervisor } from '../main/supervisor.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let root, appDir;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-gate-'));
  appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-gate-app-'));
  fs.copyFileSync(path.join(REPO, 'worker-permissions.json'), path.join(appDir, 'worker-permissions.json'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(appDir, { recursive: true, force: true });
});

const store = { listItems: () => [], listProducts: () => [], isDue: () => true };
const rulesFor = (item) => {
  const sup = new Supervisor({ storeRoot: root, home: root }, store, appDir, root, root);
  const file = sup.writeWorkerSettings(null, `t-${Math.random()}`, item);
  const rules = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.unlinkSync(file);
  return rules.permissions;
};

const reviewRow = { id: 'pr-22-1a2b3c4', product: 'acme', labels: ['founder', 'pull-request', 'pr:22'] };

describe('a pull request review row', () => {
  it('asks before every command that is public on GitHub', () => {
    const { ask } = rulesFor(reviewRow);
    for (const rule of [
      'Bash(gh pr merge:*)', 'Bash(gh pr close:*)', 'Bash(gh pr comment:*)', 'Bash(gh pr review:*)',
      'Bash(gh pr edit:*)', 'Bash(gh issue:*)', 'Bash(gh api:*)', 'Bash(gh workflow:*)', 'Bash(gh run rerun:*)',
    ]) expect(ask).toContain(rule);
  });

  it('asks before pushing or reaching the network by hand', () => {
    const { ask } = rulesFor(reviewRow);
    expect(ask).toEqual(expect.arrayContaining(['Bash(git push:*)', 'Bash(curl:*)', 'Bash(wget:*)']));
  });

  it('can never print the gh token', () => {
    expect(rulesFor(reviewRow).deny).toContain('Bash(gh auth token:*)');
  });

  // Reading stays free, or every look at the pull request would be a card.
  it('reads the pull request without asking', () => {
    const { ask } = rulesFor(reviewRow);
    for (const read of ['Bash(gh pr view:*)', 'Bash(gh pr diff:*)', 'Bash(gh pr checks:*)', 'Bash(gh pr list:*)', 'Bash(gh run list:*)']) {
      expect(ask).not.toContain(read);
    }
  });

  it('keeps the folders it had', () => {
    expect(rulesFor(reviewRow).additionalDirectories).toEqual([root]);
  });
});

describe('every other row', () => {
  it('carries no rules of ours, as before', () => {
    for (const item of [null, { id: 'w-1', labels: ['founder'] }, { id: 'w-2', labels: ['pr-review-notes'] }]) {
      expect(Object.keys(rulesFor(item))).toEqual(['additionalDirectories']);
    }
  });
});

describe('the spawn hands the row over', () => {
  it('passes the row to the rules it writes', () => {
    const sup = fs.readFileSync(path.join(REPO, 'main', 'supervisor.mjs'), 'utf8');
    expect(sup).toContain('this.prepareClaudePermissions(plan, product, runId, spawnFiles, item);');
    expect(sup).toContain('const rules = this.writeWorkerSettings(product, runId, item);');
  });
});
