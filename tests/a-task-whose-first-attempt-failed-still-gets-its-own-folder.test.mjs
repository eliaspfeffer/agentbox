// A FOLDER THAT HALF BUILT MUST NOT COST THE TASK ITS ISOLATION.
//
// FOUND 2026-10-07 (w-5952e6de3e), reviewing with Codex why people on X call
// agent worktrees brittle. This one is ours and it is the worst kind: it ends
// with two agents editing the same files and nothing on screen saying so.
//
// THE SEQUENCE, read out of main/task-folders.mjs.
//
//   1. A task has no branch yet, so `branchExists` is read as false, once.
//   2. The fast path runs. Its FIRST act is `worktree add --no-checkout -b`,
//      which CREATES the branch. Only then does it copy the files.
//   3. The copy or its verification fails. The rollback deliberately keeps the
//      branch, because every commit on a branch outlives any folder.
//   4. The ordinary path runs with the branchExists it read in step 1, which is
//      now stale, and asks git for `worktree add -b <branch>` a second time.
//      Git refuses: a branch of that name already exists.
//   5. `ensureTaskFolder` throws. main/supervisor.mjs catches it in two places
//      and both answer the same way: `console.warn('... is running in the
//      shared checkout')`, and hand the session the shared checkout.
//
// So one recoverable copy failure silently turns off the isolation this whole
// file exists to provide, and the only trace is a line in a console nobody has
// open. main/git-change.mjs says what that costs: the review card a person
// reads can then carry another agent's edits.
//
// WHAT TRIGGERS STEP 3 IN REAL LIFE. The copy skips the whole `.claude`
// directory, so a repository that COMMITS a file under `.claude` (a
// `.claude/settings.json`, which is ordinary) fails verification every single
// time: the clone is missing a tracked file, which is exactly the check that is
// meant to catch a bad clone. That is the trigger used below because it is
// deterministic. It is not the only one. Measured on this Mac the same day:
// the volume holding the checkouts was 96% full with 21 GiB free, and an
// out-of-space copy lands in the same place.
//
// WHAT MUST BE TRUE INSTEAD: the branch that survived step 3 is the task's own
// branch, so the second attempt ATTACHES to it rather than asking for it again,
// and never resets it, because by then it may carry commits.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureTaskFolder, taskFolderPath, taskBranch } from '../main/task-folders.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** A repository shaped like one of the products, clean and on its main branch. */
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'half-built-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'app.txt'), 'one\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'first');
  return dir;
}

/**
 * The repository commits a file under `.claude`, which the fast path's copy
 * skips wholesale. Every clone from this checkout therefore creates the branch
 * and then fails its own verification.
 */
function commitsAFileUnderDotClaude(dir) {
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{"permissions":{}}\n');
  git(dir, 'add', '.claude/settings.json');
  git(dir, 'commit', '-q', '-m', 'settings everyone shares');
}

describe('a task whose first attempt at a folder failed', () => {
  let dir;
  beforeEach(() => { dir = repo(); });
  afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  // THE REPORTED CASE. The clone creates the branch, then fails.
  it('still gets its own folder, on its own branch', () => {
    commitsAFileUnderDotClaude(dir);

    const made = ensureTaskFolder(dir, 'w-halfbuilt');

    expect(made.path).toBe(taskFolderPath(dir, 'w-halfbuilt'));
    expect(made.branch).toBe(taskBranch('w-halfbuilt'));
    expect(git(made.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(taskBranch('w-halfbuilt'));
    // The ordinary path ran, so the folder is the commit and nothing else.
    expect(made.how).toBe('checkout');
    expect(git(made.path, 'status', '--porcelain', '--untracked-files=no')).toBe('');
    // And the tracked file the clone could not carry IS here, which is the
    // whole reason the clone was right to refuse itself.
    expect(fs.existsSync(path.join(made.path, '.claude', 'settings.json'))).toBe(true);
  });

  // THE BOUNDARY ON ONE SIDE: the branch already existed and carries commits.
  // Attaching must never reset it, or the second attempt eats the work the
  // first session did.
  it('keeps the commits already on a branch it attaches to', () => {
    const first = ensureTaskFolder(dir, 'w-hascommits');
    fs.writeFileSync(path.join(first.path, 'app.txt'), 'the agent changed this\n');
    git(first.path, 'commit', '-qam', 'the work');
    const workDone = git(first.path, 'rev-parse', 'HEAD');
    // Give the folder back without touching the branch, as closing a row does.
    git(dir, 'worktree', 'unlock', first.path);
    git(dir, 'worktree', 'remove', '--force', first.path);
    // And only NOW make every clone from this checkout fail.
    commitsAFileUnderDotClaude(dir);

    const again = ensureTaskFolder(dir, 'w-hascommits');

    expect(again.branch).toBe(taskBranch('w-hascommits'));
    expect(git(again.path, 'rev-parse', 'HEAD')).toBe(workDone);
    expect(fs.readFileSync(path.join(again.path, 'app.txt'), 'utf8')).toBe('the agent changed this\n');
  });

  // THE BOUNDARY ON THE OTHER SIDE: a failure BEFORE the branch is created.
  // A dirty checkout turns the fast path down at the door, so it never creates
  // a branch, and the ordinary path has to create it exactly once.
  it('still gets its own folder when the fast path never started', () => {
    fs.writeFileSync(path.join(dir, 'app.txt'), 'somebody is mid-edit\n');

    const made = ensureTaskFolder(dir, 'w-neverstarted');

    expect(made.how).toBe('checkout');
    expect(git(made.path, 'rev-parse', 'HEAD')).toBe(git(dir, 'rev-parse', 'refs/heads/main'));
    expect(fs.readFileSync(path.join(made.path, 'app.txt'), 'utf8')).toBe('one\n');
  });

  // AND THE CASE THAT MUST NOT MATCH: a checkout with nothing in its way still
  // takes the fast path. Without this the bug above could be "fixed" by turning
  // the clone off, and every test here would still pass.
  it('does not stop the clone being used when there is nothing wrong', () => {
    const made = ensureTaskFolder(dir, 'w-fastpath');

    expect(made.how).toBe('clone');
    expect(git(made.path, 'status', '--porcelain', '--untracked-files=no')).toBe('');
    expect(git(made.path, 'rev-parse', 'HEAD')).toBe(git(dir, 'rev-parse', 'refs/heads/main'));
  });
});
