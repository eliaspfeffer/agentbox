// Finder launches inherit launchd's PATH rather than the user's shell tools.
// Read only PATH: importing a profile's whole environment would import keys
// and login overrides too. Workers still pass through their billing scrub.
import { execFile } from 'node:child_process';
import path from 'node:path';

const MARKER = '\0agentbox-path\0';
function runShell(file, args, options) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, options, (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin?.end();
  });
}

/**
 * WHERE THE SHELL SAYS CLAUDE CODE AND CODEX KEEP THEIR SESSIONS (w-e46f2e9cea).
 *
 *  An app opened from the Dock, or from a Linux launcher entry, never sees what
 *  a shell profile exports, so a CLAUDE_CONFIG_DIR or CODEX_HOME set there was
 *  invisible to the import unless the folder happened to be named
 *  ~/.claude-<name>. These two names and nothing else are read, the same way
 *  PATH is above, and they are handed to the session finder rather than put
 *  into the app's environment: CLAUDE_CONFIG_DIR there would change which
 *  account every worker runs on.
 *
 *  Only an absolute path is kept. A quoted `~` the shell did not expand is
 *  expanded here; anything else, or no answer at all, is left out. */
const DIRS_MARKER = '\0agentbox-dirs\0';
export async function readShellDataDirs({ env = process.env, platform = process.platform, run = runShell } = {}) {
  if (platform !== 'darwin' && platform !== 'linux') return {};
  const shell = env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
  try {
    const stdout = String(await run(shell, ['-ilc', `printf '\\0agentbox-dirs\\0%s\\0%s\\0' "$CLAUDE_CONFIG_DIR" "$CODEX_HOME"`], {
      env: { ...env }, encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024,
    }));
    const start = stdout.lastIndexOf(DIRS_MARKER);
    if (start < 0) return {};
    const [claude = '', codex = ''] = stdout.slice(start + DIRS_MARKER.length).split('\0');
    const out = {};
    const keep = (name, raw) => {
      let v = String(raw ?? '').trim();
      if (!v || /[\r\n]/.test(v)) return;
      if (v === '~' || v.startsWith('~/')) {
        if (!env.HOME) return;
        v = path.join(env.HOME, v.slice(1));
      }
      if (path.isAbsolute(v)) out[name] = v;
    };
    keep('CLAUDE_CONFIG_DIR', claude);
    keep('CODEX_HOME', codex);
    return out;
  } catch {
    return {};
  }
}

/**
 * What the shell answered, kept for the life of the app. Empty until it
 *  answers, which is long before setup reaches its last card. */
let shellDataEnv = {};
export const shellDataDirsNow = () => shellDataEnv;
export function learnShellDataDirs(opts) {
  return readShellDataDirs(opts).then((found) => { shellDataEnv = found; return found; });
}

export async function recoverShellPath({ env = process.env, platform = process.platform, run = runShell } = {}) {
  const original = env.PATH || '';
  if (platform !== 'darwin') return { path: original, error: null };
  const shell = env.SHELL || '/bin/zsh';
  const value = path.basename(shell) === 'fish' ? '(string join : $PATH)' : '"$PATH"';
  try {
    // NUL framing keeps messages printed by .zshrc out of the returned PATH.
    const stdout = String(await run(shell, ['-ilc', `printf '\\0agentbox-path\\0%s\\0' ${value}`], {
      env: { ...env }, encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024,
    }));
    const start = stdout.lastIndexOf(MARKER);
    const end = start < 0 ? -1 : stdout.indexOf('\0', start + MARKER.length);
    const recovered = end < 0 ? '' : stdout.slice(start + MARKER.length, end);
    if (!recovered || /[\r\n]/.test(recovered)) throw Error('Your shell did not return its command search path.');
    const entries = [...new Set([...recovered.split(':'), ...original.split(':')].filter(Boolean))];
    if (!entries.length) throw Error('Your shell returned an empty command search path.');
    return { path: entries.join(':'), error: null };
  } catch (error) {
    return { path: original, error: String(error?.message || error) };
  }
}
