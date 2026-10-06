// The folder a new project is made IN, which is one the person picked and
// never one this app thought of.
//
// IT USED TO PROPOSE ONE. `proposedFolder(name, parent)` wrote `~/dev/<slug>`
// into the card from the name as it was typed, and Make it created that folder.
// A tester typed "agentbox", got an empty `~/dev/agentbox`, and heard about it
// from the agent that landed in it; their clone was in `~/agentbox` all along.
// Three rounds of drawings for a clearer picker all read as confusing
// (2026-10-05, w-33e1c968f0), so the proposal and the card it lived on are
// gone: the Mac's own folder window is the whole step.
//
// The `~` is deliberately NOT expanded here. The renderer does not know whose
// home this is; the main process does, and expands it on the way in.

import { nameFromFolder } from './onboarding';

/**
 * What a picked folder makes: its path, and the name setup would have given it.
 *
 * ONE NAMING RULE, NOT TWO. The walk has named a project after its folder since
 * it was rebuilt (`nameFromFolder`), so `~/Desktop/dev/agentbox-team` is
 * "Agentbox Team" whether it is somebody's first project or their eleventh.
 * Nothing is returned for nothing, so a cancelled window cannot make a project.
 */
export function projectFromFolder(picked: string | null | undefined): { name: string; repoPath: string } | null {
  const repoPath = String(picked ?? '').trim().replace(/\/+$/, '');
  if (!repoPath) return null;
  const name = nameFromFolder(repoPath);
  return name ? { name, repoPath } : null;
}

// The home directory as ~, the way the rail and Settings already write a path.
export function shortFolder(full: string): string {
  return full.replace(/^\/Users\/[^/]+/, '~');
}
