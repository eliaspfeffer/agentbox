// THE LOCAL FILES A NEW TASK FOLDER IS GIVEN, AND THE ONES IT IS REFUSED.
//
// A worktree is a fresh checkout, so it holds the commit and nothing else. Every
// file a repository needs that git does not track -- the dependencies, a `.env`,
// a key, a machine's own config -- is simply absent, and that is what people
// mean when they say agent worktrees are brittle. Measured on one Mac on
// 2026-10-07 (w-5952e6de3e): of the seven task folders then live, seven had
// node_modules because exactly one ignored path was ever carried, and five had
// no `zero.config.json`, so the app ran in them on fallback defaults.
//
// `.worktreeinclude` IS NOT OURS, AND THAT IS WHY IT WAS CHOSEN. It is a file at
// the repository root in .gitignore pattern syntax, naming the IGNORED files to
// carry into a new worktree. Conductor reads it; so does Claude Code. A
// repository already set up for either works here with nothing new to write.
//
// THE PATTERNS ARE MATCHED BY GIT, NEVER BY US. `git ls-files --others --ignored
// --exclude-from=<list>` answers with the files git itself would ignore that
// those patterns select, which gets comments, blank lines, anchoring, nested
// globs, directory patterns and `!` negation right by construction rather than
// by a matcher of ours that would drift. It also gives the central safety
// property for free: `--others` never lists tracked content, so a pattern naming
// a file the commit carries selects NOTHING and the commit can never be shadowed
// by somebody's local copy of it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The file a repository says what it needs in, at its root. */
export const INCLUDE_FILE = '.worktreeinclude';

/**
 * What a repository that has never heard of this gets: its dependencies, which
 * is exactly what was carried before, so nothing is worse off for not asking.
 *
 * Anchored, because the old behaviour was the root's `node_modules` and not every
 * `node_modules` anywhere in the tree. And WITHOUT the trailing slash, which is
 * not cosmetic: measured 2026-10-07, `/node_modules/` matches a directory and
 * nothing else, so a `node_modules` that is really a SYMLINK to a shared one is
 * not selected, not carried, and -- the part that matters -- not reported either.
 * Without the slash it is selected, and then the link rule below refuses it by
 * name. A folder silently sharing its dependencies with the checkout is the
 * failure; a folder saying it would not is the fix.
 */
export const DEFAULT_PATTERNS = ['/node_modules'];

/**
 * Where the app's own task folders live, which may never be carried into one.
 * It is ignored (the app ignores it itself), so a pattern as broad as `**`
 * selects it, and carrying it would copy every other task's folder into this
 * one. Said as a constant because it is the single unconditional exclusion.
 */
const MANAGED = '.claude/worktrees';

const run = (cwd, args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

function tryRun(cwd, args) {
  try { return { ok: true, out: run(cwd, args) }; }
  catch (error) { return { ok: false, out: String(error?.stderr ?? error?.message ?? '').trim() }; }
}

/** Lines that are a pattern: not blank, not a comment. */
const patternsIn = (text) => text.split('\n')
  .map((line) => line.replace(/\r$/, ''))
  .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'));

/**
 * What this repository asks for.
 *
 * A FILE THAT EXISTS AND SELECTS NOTHING CARRIES NOTHING. Present and empty is a
 * decision, not an absence: without that there is no way to say "give me a bare
 * folder", and a repository that deliberately wants its dependencies installed
 * fresh would be overruled by our default.
 */
export function askedFor(root) {
  const file = path.join(root, INCLUDE_FILE);
  if (!fs.existsSync(file)) return { patterns: DEFAULT_PATTERNS, source: 'default' };
  try { return { patterns: patternsIn(fs.readFileSync(file, 'utf8')), source: INCLUDE_FILE }; }
  catch { return { patterns: DEFAULT_PATTERNS, source: 'default' }; }
}

/**
 * The paths those patterns actually select in this checkout, as git sees them.
 *
 * `--directory` collapses a wholly untracked directory to one entry, which turns
 * a node_modules of sixty thousand files into a single `cp`. `-z` because a
 * newline is a legal character in a filename and this list decides what gets
 * copied.
 */
export function localFilesIn(root) {
  const { patterns, source } = askedFor(root);
  if (!patterns.length) return { paths: [], patterns, source };
  const list = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-include-'));
  const file = path.join(list, 'patterns');
  try {
    fs.writeFileSync(file, `${patterns.join('\n')}\n`);
    const found = tryRun(root, ['ls-files', '-z', '--others', '--ignored', '--directory', `--exclude-from=${file}`]);
    if (!found.ok) return { paths: [], patterns, source };
    const paths = found.out.split('\0')
      .map((p) => p.replace(/\/$/, ''))
      .filter(Boolean)
      .filter(keepable);
    return { paths, patterns, source };
  } finally {
    try { fs.rmSync(list, { recursive: true, force: true }); } catch { /* a temp dir */ }
  }
}

/**
 * THE EXCLUSIONS NO PATTERN CAN OVERRIDE.
 *
 * `.git` is the repository, and the folder other tasks live in is other tasks'
 * work. A selected path that CONTAINS the managed folder is dropped whole rather
 * than picked apart: `**` collapses to `.claude`, and narrowing that by hand
 * would be a second matcher to get wrong. A repository that needs one file from
 * in there names it exactly, and an exact name is not an ancestor of the managed
 * folder, so it still comes through.
 */
function keepable(rel) {
  const parts = rel.split('/');
  if (parts[0] === '.git') return false;
  if (rel === MANAGED || rel.startsWith(`${MANAGED}/`)) return false;
  // An ancestor of the managed folder: `.claude`, or the repository root itself.
  if (MANAGED === rel || MANAGED.startsWith(`${rel}/`)) return false;
  return true;
}

/**
 * A LINK OUT OF THE FOLDER IS NOT ISOLATION, IT IS THE OPPOSITE.
 *
 * Measured on one Mac, 2026-10-07: a hand-made worktree beside the checkout had
 * `node_modules -> ../agentbox-team/node_modules`, so an install in it rewrote
 * the dependencies of every other folder pointing at that target. Carrying such
 * a link forward recreates exactly that, in a folder whose whole purpose is that
 * nothing it does reaches anybody else.
 *
 * So: a RELATIVE link whose target stays inside the repository is carried, and
 * after the folder is moved into place it points at the folder's own copy, which
 * is what a workspace link is for. An ABSOLUTE link is refused even when it
 * points inside this very checkout, because absolute is exactly what survives
 * the move and keeps pointing at the original.
 */
function linkIsSafe(root, abs) {
  let target;
  try { target = fs.readlinkSync(abs); } catch { return false; }
  if (path.isAbsolute(target)) return false;
  const resolved = path.resolve(path.dirname(abs), target);
  const inside = path.relative(root, resolved);
  return inside !== '' && !inside.startsWith('..') && !path.isAbsolute(inside);
}

/**
 * Carry the selected local files into a folder that has just been made.
 *
 * `cp -c` asks APFS for a block-sharing clone: measured 2026-09-22, this
 * repository's 929 MB of dependencies took 2.9 seconds and moved the volume's
 * free space by nothing at all, because the blocks are shared until something
 * writes.
 *
 * WHAT IS AN ERROR AND WHAT IS NOT. A pattern that matches nothing is silent:
 * a repository may name a `.env` that this machine does not have. A file that
 * was found and could not be copied THROWS, naming it, because somebody asked
 * for it by name and a folder quietly missing it is the failure this whole
 * module exists to end. A link that is refused is named in `refused` and does
 * not stop the folder: it is a fact about the source worth reporting, and
 * leaving it out is the correct outcome rather than a partial one.
 */
export function carryLocalFiles(root, folder) {
  const { paths, source } = localFilesIn(root);
  const carried = [];
  const refused = [];
  for (const rel of paths) {
    const from = path.join(root, rel);
    const to = path.join(folder, rel);
    // Resolved rather than trusted: a selected path must land inside the folder.
    const inside = path.relative(folder, to);
    if (inside.startsWith('..') || path.isAbsolute(inside)) { refused.push(rel); continue; }
    if (!fs.existsSync(from) && !isLink(from)) continue;
    // NEVER OVER THE COMMIT. The patterns cannot select tracked content in the
    // source, but the folder may stand on a DIFFERENT commit than the checkout
    // beside it, and a file this branch tracks is content, not a local file.
    if (tracksIt(folder, rel)) { refused.push(rel); continue; }
    if (fs.existsSync(to)) continue;
    if (isLink(from) && !linkIsSafe(root, from)) { refused.push(rel); continue; }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try {
      execFileSync('cp', ['-c', '-R', from, to], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      throw Error(`${source} asks for ${rel} and it could not be carried in: ${String(error?.stderr ?? error?.message ?? '').trim()}`);
    }
    refused.push(...dropLinksOutOfTheFolder(root, to, rel));
    carried.push(rel);
  }
  return { carried, refused, source };
}

const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };

const tracksIt = (folder, rel) => tryRun(folder, ['ls-files', '--error-unmatch', '-z', '--', rel]).ok;

/**
 * The same link rule, one level inside a directory that was carried.
 *
 * ONE LEVEL AND NOT EVERY LEVEL, deliberately. A workspace install writes its
 * links exactly there (`node_modules/<name>` pointing at `packages/<name>`), and
 * walking sixty thousand files to find the rest would cost more than it saves.
 * A link deeper than this that points outside the folder is NOT caught, and
 * saying so here is better than implying a guarantee that is not given.
 *
 * Dropped rather than refused-and-abandoned: the directory is still worth having
 * without it, and the name is reported either way.
 */
function dropLinksOutOfTheFolder(root, to, rel) {
  let children = [];
  try { children = fs.readdirSync(to, { withFileTypes: true }); } catch { return []; }
  const dropped = [];
  for (const child of children) {
    if (!child.isSymbolicLink()) continue;
    const at = path.join(to, child.name);
    if (linkIsSafe(root, path.join(root, rel, child.name))) continue;
    try { fs.rmSync(at, { force: true }); dropped.push(path.posix.join(rel, child.name)); }
    catch { /* it can only have gone */ }
  }
  return dropped;
}

/**
 * THE FOLDER IS THE COMMIT, PLUS WHAT WAS ASKED FOR, AND NOTHING ELSE.
 *
 * The clone copies whole top-level directories, so an ignored build output
 * living inside a tracked one (`renderer/dist`) rides along. That used to be the
 * difference between the two ways of making a folder: the clone carried every
 * untracked file in the checkout and the ordinary checkout carried one. Two
 * folders that are not the same thing is the bug underneath "worktrees don't
 * work", so the extras are cleared and the asked-for files are put back by name.
 *
 * Run BEFORE anything is carried in, so it can never remove what was asked for.
 */
export function onlyTrackedContent(folder) {
  const found = tryRun(folder, ['ls-files', '-z', '--others', '--directory', '--no-empty-directory']);
  if (!found.ok) return [];
  const gone = [];
  for (const rel of found.out.split('\0').map((p) => p.replace(/\/$/, '')).filter(Boolean)) {
    if (!keepable(rel)) continue;
    try { fs.rmSync(path.join(folder, rel), { recursive: true, force: true }); gone.push(rel); }
    catch { /* already gone */ }
  }
  return gone;
}

/**
 * The top-level entries the clone has to copy: the ones holding tracked content.
 * Everything else in the checkout is either ignored or somebody's scratch, and
 * whichever of it is wanted arrives by name through `.worktreeinclude`.
 */
export function trackedTopLevel(root) {
  const listed = tryRun(root, ['ls-files', '-z']);
  if (!listed.ok) return [];
  const top = new Set();
  for (const rel of listed.out.split('\0').filter(Boolean)) top.add(rel.split('/')[0]);
  return [...top];
}
