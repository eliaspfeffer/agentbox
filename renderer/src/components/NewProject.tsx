// NEW PROJECT: THE MAC'S OWN FOLDER WINDOW, AND NOTHING OF OURS.
//
// THERE IS NO CARD HERE ANY MORE. What stood here asked for a name, proposed
// `~/dev/<name>` from it, and made that folder on Make it. A tester typed
// "agentbox", got an empty `~/dev/agentbox` with no .git in it, and learned
// about it from the agent's reply; their clone was in `~/agentbox`.
//
// Three rounds of drawings tried to fix the picker — the folders you work in as
// rows, one field in ⌘K's shape, the question with no guess in it — and all
// three came back "super messy and confusing... I'm simply confused"
// (2026-10-05). So the component is deleted rather than redrawn, and the only
// window left is the one everybody on a Mac has already used a thousand times.
//
// WHAT IT DOES. It opens as soon as it is mounted: Apple's folder window, one
// pick, and the project is made in that folder with that folder's name. Cancel
// makes nothing. There is no second step and nothing to fill in, and a name is
// changed afterwards where every other rename lives, in the project's settings.
//
// IN A BROWSER TAB THERE IS NO MAC WINDOW, so `chooseFolder` answers
// `{ browse: true }` and <FolderPicker> stands in, walking the same disk
// through the same process. That is the one piece of interface left, and it
// only exists where Apple's window cannot open.

import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import FolderPicker from './FolderPicker';
import { projectFromFolder } from '../project-folder';

export function NewProject({ onCreate, onClose, onRefused }: {
  // Closing on success is the caller's, because only the caller knows whether
  // the store took it.
  onCreate: (p: { name: string; repoPath: string }) => void | Promise<unknown>;
  onClose: () => void;
  // WHY A PICK WAS TURNED DOWN. The home folder and the seven folders macOS
  // guards are not projects, and main refuses them rather than handing the path
  // back. With no card to write it on, the sentence goes to the caller, which
  // has the toast.
  onRefused?: (say: string) => void;
}) {
  // Up when there is no Mac window to open. Nothing else is ever drawn.
  const [browsing, setBrowsing] = useState(false);
  // ASKED ONCE, NOT ONCE PER RENDER. A second window opening behind the first
  // is a Mac asking the same question twice.
  const asked = useRef(false);

  const take = (picked: string) => {
    const made = projectFromFolder(picked);
    if (!made) { onClose(); return; }
    setBrowsing(false);
    onCreate(made);
  };

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    let live = true;
    (async () => {
      const { path: picked, refused: why, browse } = await api.chooseFolder();
      if (!live) return;
      // No Mac window behind this. Draw ours. Not a refusal and not a cancel.
      if (browse) { setBrowsing(true); return; }
      if (why) { onRefused?.(why); onClose(); return; }
      // Cancelling is not an answer: nothing is made and nothing is said.
      if (!picked) { onClose(); return; }
      take(picked);
    })();
    const off = () => { live = false; };
    return off;
    // Mounted once per opening, and the refs above are what keep it to one ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (browsing) {
    return <FolderPicker startIn={null} onPick={take} onClose={onClose} />;
  }
  return null;
}
