// THE TRAY'S MARK: the nine-dot lattice from the Agent Tray launch film
// (w-3133d503b1 v15, her pick: "I really like what we did with the nine dots.
// I actually think it looks way better than our current design").
//
// It is the app's own lattice (components/LiveMark.tsx: eight dots orbiting a
// centre, 1488ms in 186ms steps) with two things changed for the corner.
//
// THE CENTRE DOT IS ALWAYS FILLED, lit or resting. LiveMark leaves it a faint
// hole; in a 10px mark on a tag that read as a gap, and she called it wonky.
//
// AND IT DOES NOT TURN THE WHOLE TIME. The film turns it for as long as agents
// work, which is right for a film and wrong for a corner somebody is trying to
// work next to: "while agents are working, the eye should NOT be drawn to it".
// So it turns twice, 1856ms a turn, WHEN SOMETHING CHANGES, and settles still.
// Motion in this corner always means news; the rest of the time there is none.
// Her pick of three, 2026-10-13: "I agree with: 1. It turns, then it settles."
import React from 'react';

// Which step of the orbit each dot takes; null is the centre, which never
// joins in because it is never dim.
const ORBIT = [0, 1, 2, 7, null, 3, 6, 5, 4];

/** One turn of the orbit. The app's 1488ms, a quarter slower, because the
 *  corner is read out of the side of an eye rather than looked at. */
export const TURN_MS = 1856;
/** How many turns one piece of news is worth. */
export const TURNS = 2;

export type Says = { kind: string; count: number };
export type Move = 'pop' | 'stir' | 'none';

/**
 * What the mark does when the tag's words change. `before` is null the first
 * time, which is the tray appearing: it greets you rather than sitting dead.
 *
 * A count that goes UP is news you have not seen, so it pops. A count that
 * goes DOWN is news you have just dealt with, so it does nothing: answering
 * three threads should not flash at you three times.
 */
export function markMoves(before: Says | null, after: Says): Move {
  const ready = after.kind === 'ready';
  if (!before) return ready ? 'pop' : 'stir';
  if (ready && (before.kind !== 'ready' || after.count > before.count)) return 'pop';
  if (ready) return 'none';
  return before.kind !== after.kind || before.count !== after.count ? 'stir' : 'none';
}

/**
 * The mark. `lit` is the waiting state, where all nine dots are full and still.
 * `beat` changes with every move so the element is replaced and its animation
 * starts again from the top; nothing here runs a timer.
 */
export function Lattice({ lit, move, beat }: { lit: boolean; move: Move; beat: number }) {
  const how = `${lit ? ' is-waiting' : ''}${move === 'stir' && !lit ? ' is-turning' : ''}${move === 'pop' ? ' is-popping' : ''}`;
  return (
    <span key={beat} className={`ct-lat${how}`} aria-hidden="true">
      {ORBIT.map((step, i) => (
        <i
          key={i}
          className={step === null ? 'ct-heart' : undefined}
          style={step === null ? undefined : ({ '--p': step, '--r': i } as React.CSSProperties)}
        />
      ))}
    </span>
  );
}
