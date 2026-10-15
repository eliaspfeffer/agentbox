// THE THREADS A THREAD MADE, IN LINE (w-2e8aa16f0f). One bordered row per
// thread, its title and where it stands, and the row opens it. The same list
// an agent answering in a chat shows for the tasks it opened, approved in the
// messages redesign; here it sits under a task whose agent filed threads.
//
// AND THE PRESSES THAT ANSWER ONE (w-9cf2b43110, w-554834e749). Every thread an
// agent files is a proposal waiting on you, and answering it used to mean
// leaving this thread, finding that one's own row and acting there, once per
// thread: "it ends up in my inbox with no clear next step." The next step is
// now in the row that names it, and there are two of them.
//
// DO IN THIS THREAD, or START NEW THREAD (w-554834e749). Approve was the only
// real answer, and it always meant a new thread: "I want to be able to do more
// than just reject or offer subthreads... have the agent not make that a
// different thread and just do it in our thread." Each press says in full what
// it does, because the bare word was the confusing part ("make sure it's extra
// clear"). Chosen off three rounds of drawings: the new thread is the press in
// the accent, as an outline rather than a solid block ("the orange backgrounds
// are a little bit too bright"), and this thread is the grey one beside it.
//
// THERE IS NO NO. It was drawn under the cursor, and "No basically means
// reject, so it's a different functionality"; "ignoring it is basically
// rejecting it". A proposal you leave alone never runs. One you want gone is
// closed from its own row like any other thread.
//
// ONE ROW AT A TIME. There is no press that answers the lot, and that is the
// decision rather than an omission: three proposals are three decisions, and
// this app has already been burned once by a key that approved on her behalf
// (the E-key history in App.tsx's `resolve`). What each row carries is its own.
//
// THE ROW IS A DIV, NOT A BUTTON, which it was until the press arrived: no
// browser accepts a button inside a button. The press to open is its own
// control filling the row, so the row looks identical and the presses can
// never be mistaken for each other.
import type { ThreadStateWord } from '../types';
import { stateWord } from '../threads-made';
import './threads-made.css';

export interface MadeRow {
  id: string;
  title: string;
  state: ThreadStateWord | null;
  /** Waiting on a press from you (`approvableFiled`, ../threads-made.ts). */
  approve?: boolean;
}

export const START_NEW = 'Start new thread';
export const DO_HERE = 'Do in this thread';

export function ThreadsMade({ rows, onOpen, onApprove, onHere, label }: {
  rows: MadeRow[];
  onOpen: (id: string) => void;
  /** Start it as its own thread: the approval that has always been here. */
  onApprove?: (id: string) => void;
  /**
   * Do it in this thread instead: sends the proposal back to the thread that
   * filed it and closes it (`doItHereWrites`, ../threads-made.ts).
   */
  onHere?: (id: string) => void;
  label?: string;
}) {
  if (!rows.length) return null;
  // WHILE ANY OF THEM WAITS FOR A YES, THE LIST SAYS SO (w-d2744c6daa): "I
  // often miss these filed tasks... they're not very visible and it's really
  // easy to skip them." One had waited 22 hours under a closed thread. Chosen
  // off seven rounds of drawings: the list's outer border goes orange, the
  // label reads "Still waiting on you" in white, and the waiting rows come
  // first. Only a row this list can actually answer counts, so a list drawn
  // without the press, or one holding a review, stays quiet.
  const canPress = (r: MadeRow) => !!onApprove && !!r.approve;
  const waiting = rows.some(canPress);
  const shown = waiting ? [...rows.filter(canPress), ...rows.filter((r) => !canPress(r))] : rows;
  // THE PRESSES STAND WHERE THE STATE WORD WOULD (2026-10-05). A row waiting
  // on you carries them where it would have said NEEDS YOU, so nothing is held
  // in reserve on the other rows and every row ends at the same right-hand edge.
  return (
    <div className={waiting ? 'made made-waiting' : 'made'}>
      {(waiting || label) && <div className="made-label">{waiting ? 'Still waiting on you' : label}</div>}
      <div className="made-list">
        {shown.map((r) => {
          const press = canPress(r);
          return (
            <div className="made-row" key={r.id}>
              {/* The word stays INSIDE the press that opens the thread, so on
                  every row that carries no answer the whole width of the row
                  is still the way in. */}
              <button type="button" className="made-open" onClick={() => onOpen(r.id)}>
                <span className="made-title">{r.title}</span>
                {!press && <span className={`made-state ${r.state ?? ''}`}>{stateWord(r.state)}</span>}
              </button>
              {/* NAMED WITH THE THREAD EACH ONE IS ABOUT. Several rows each say
                  the same words, so the bare words tell a screen reader, and a
                  hovering cursor, nothing about which proposal it is. */}
              {press && onHere && (
                <button
                  type="button"
                  className="made-here"
                  aria-label={`${DO_HERE}: ${r.title}`}
                  title={`${DO_HERE}: ${r.title}`}
                  onClick={() => onHere(r.id)}
                >
                  {DO_HERE}
                </button>
              )}
              {press && (
                <button
                  type="button"
                  className="made-approve"
                  aria-label={`${START_NEW}: ${r.title}`}
                  title={`${START_NEW}: ${r.title}`}
                  onClick={() => onApprove!(r.id)}
                >
                  {START_NEW}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
