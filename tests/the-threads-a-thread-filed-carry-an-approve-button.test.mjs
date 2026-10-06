// THE THREADS AN AGENT FILED CARRY AN APPROVE BUTTON (w-9cf2b43110).
//
// Said 2026-10-05 on w-560647d4db: "when an agent files another agent i don't
// love that it ends up in my inbox with no clear next step. feels confusing,
// like it wastes my time. better for it to file those and have an approval
// button in that component."
//
// Every thread an agent files is a PROPOSAL: it sits in Needs you and nothing
// runs on it until it is approved. Approving one meant leaving the thread that
// filed it, finding its own row, and acting there — once per thread. The list
// of filed threads now carries the press itself.
//
// Measured on the shipped list (2ed0cce): three filed threads, three separate
// trips out of the pane and back. The two decisions this pins:
//
//   ONE ROW AT A TIME, never all of them. Approval is consequential and the
//   app has already been burned by a key that approved in bulk on her behalf
//   (the E-key comment in App.tsx's resolve). Three proposals are three
//   decisions; one button cannot stand for all three.
//
//   AND THE WORD BECOMES "In progress", which is the word the tab already
//   uses. Nothing new is invented: the approve puts the row in the pending
//   grace window, which the In progress list claims (App.tsx `progress`), so
//   the row says it is moving the instant it is pressed and keeps saying so
//   once the answer lands.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { approvableFiled } from '../renderer/src/threads-made.ts';
import { ThreadsMade } from '../renderer/src/components/ThreadsMade.tsx';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// An ordinary thread an agent filed under another: open, a task, nobody's reply
// on it, and not deliberately parked in Later.
const filed = (over = {}) => ({ id: 'w-kid', status: 'open', kind: 'task', labels: [], ...over });

describe('which filed threads are waiting to be approved', () => {
  it('is an open task an agent filed, which is the whole of the complaint', () => {
    expect(approvableFiled(filed(), 'waiting')).toBe(true);
  });

  it('is not one already approved, because the answer is what starts it', () => {
    expect(approvableFiled(filed({ answer: 'Approved. Run it.' }), 'waiting')).toBe(false);
  });

  it('is one whose approval was withdrawn, which is back to waiting', () => {
    expect(approvableFiled(filed({ answer: '(withdrawn)' }), 'waiting')).toBe(true);
  });

  it('is not one a worker already has, nor a finished or blocked one', () => {
    expect(approvableFiled(filed({ status: 'claimed' }), 'waiting')).toBe(false);
    expect(approvableFiled(filed({ status: 'done' }), 'waiting')).toBe(false);
    expect(approvableFiled(filed({ status: 'blocked' }), 'waiting')).toBe(false);
  });

  it('is not a question or a review, whose options have to be read first', () => {
    expect(approvableFiled(filed({ kind: 'question' }), 'waiting')).toBe(false);
    expect(approvableFiled(filed({ kind: 'review' }), 'waiting')).toBe(false);
  });

  it('is not a thread you wrote yourself: your own work needs no approval', () => {
    expect(approvableFiled(filed({ labels: ['founder'] }), 'waiting')).toBe(false);
  });

  it('is not one written down and deliberately not begun', () => {
    expect(approvableFiled(filed({ start: 'later' }), 'scheduled')).toBe(false);
  });

  // MEASURED BY PRESSING ONE IN THE BUILT APP, which is the only way this was
  // ever going to show up: the word went to IN PROGRESS and the button stayed
  // beside it. Approving holds its write for the undo window, so the row's
  // fields still say "open, no answer" for those few seconds while the inbox
  // has already let it go. The list was offering to start something it was
  // simultaneously reporting as started.
  it('is not one already moving, however open its fields still read', () => {
    const justApproved = filed(); // the ledger has not caught up yet
    expect(approvableFiled(justApproved, 'running')).toBe(false);
    expect(approvableFiled(justApproved, 'done')).toBe(false);
    expect(approvableFiled(justApproved, null)).toBe(false);
  });
});

describe('the button, drawn in the list', () => {
  const rows = [
    { id: 'w-a', title: 'Say why Send is off', state: 'waiting', approve: true },
    { id: 'w-b', title: 'Keep a pasted command exactly as typed', state: 'running' },
  ];
  const html = renderToStaticMarkup(React.createElement(ThreadsMade, { rows, onOpen: () => {}, onApprove: () => {} }));

  it('is one press per waiting thread and none on the rest', () => {
    expect(html.match(/class="made-approve"/g)).toHaveLength(1);
    expect(html).toContain('>Approve<');
  });

  it('names the thread it would start, so the press is never ambiguous', () => {
    expect(html).toContain('aria-label="Approve: Say why Send is off"');
  });

  it('still opens the thread, which is a second press and not the same one', () => {
    expect(html.match(/class="made-open"/g)).toHaveLength(2);
  });

  it('nests no button inside another, which no browser would accept', () => {
    expect(html).toContain('<div class="made-row"');
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/);
  });

  it('draws no press at all where nothing can be approved from', () => {
    const plain = renderToStaticMarkup(React.createElement(ThreadsMade, { rows, onOpen: () => {} }));
    expect(plain).not.toContain('made-approve');
  });

  // THE PRESS TAKES THE STATE WORD'S PLACE (2026-10-05). It first shipped
  // BESIDE the word, which left the words on rows that had no press 104px short
  // of the right-hand edge to keep the room for one: "look very unattractive.
  // was more thinking in the place of needs you etc... Right now this button
  // looks a little weird because of how much space there is."
  //
  // A row that can be approved says APPROVE where it would have said NEEDS YOU,
  // and nothing is held in reserve, so every word and every press ends at the
  // same right-hand edge.
  it('says APPROVE in the place of the state word, not beside it', () => {
    expect(html).toContain('>Approve<');
    // The waiting row's own word is gone; the running row below it keeps its.
    expect(html).not.toContain('>Needs you<');
    expect(html).toContain('>In progress<');
    expect(html.match(/class="made-state/g)).toHaveLength(1);
  });

  it('reserves no room beside the word, which is what pushed the column left', () => {
    expect(html).not.toContain('made-approve-room');
    expect(html).not.toContain('aria-hidden="true"');
  });

  it('leaves the state words alone in a list where nothing can be approved', () => {
    const none = renderToStaticMarkup(React.createElement(ThreadsMade, {
      rows: rows.map(({ approve, ...r }) => r), onOpen: () => {}, onApprove: () => {},
    }));
    expect(none).not.toContain('made-approve');
    expect(none.match(/class="made-state/g)).toHaveLength(2);
  });

  // THE OTHER HALF OF THE DECISION (w-9cf2b43110, second round). A proposal
  // nobody answers now waits in Later and brings its thread back a day later,
  // so there has to be a way to say no from the same row. It is the ordinary
  // close — "there is no decline" in App.tsx still holds — and it is drawn
  // quietly, under the cursor, because a list of three offers should not read
  // as six buttons.
  it('offers a No beside the press, named with its thread', () => {
    const both = renderToStaticMarkup(React.createElement(ThreadsMade, {
      rows, onOpen: () => {}, onApprove: () => {}, onReject: () => {},
    }));
    expect(both.match(/class="made-reject"/g)).toHaveLength(1);
    expect(both).toContain('aria-label="Reject: Say why Send is off"');
    expect(both).toContain('>No<');
  });

  it('draws no No on a row with nothing to approve', () => {
    const none = renderToStaticMarkup(React.createElement(ThreadsMade, {
      rows: rows.map(({ approve, ...r }) => r), onOpen: () => {}, onApprove: () => {}, onReject: () => {},
    }));
    expect(none).not.toContain('made-reject');
  });

  it('draws none at all where no rejection is wired, which is every other list', () => {
    expect(html).not.toContain('made-reject');
  });

  it('draws nothing at all when there are no rows', () => {
    expect(renderToStaticMarkup(React.createElement(ThreadsMade, { rows: [], onOpen: () => {} }))).toBe('');
  });
});

describe('where the press is wired', () => {
  const app = read('renderer/src/App.tsx');
  const focus = read('renderer/src/components/Focus.tsx');

  it('reaches the opened thread knowing which of its children can be approved', () => {
    expect(app).toMatch(/approve: approvableFiled\(i, stateOfMine\(i\)\)/);
    expect(app).toMatch(/import \{ threadsMade, approvableFiled \}/);
  });

  it('approves the child without taking you off the thread you are reading', () => {
    expect(app).toMatch(/onApproveFiled=\{\(i\) => resolve\(i, \{ stay: true \}\)\}/);
    expect(app).toMatch(/const resolve = useCallback\(async \(item: WorkItem, \{ stay \}/);
  });

  it('hands the list the press, by the row', () => {
    expect(focus).toMatch(/onApprove=\{[^}]*onApproveFiled/);
  });

  it('says no with the ordinary close, from the thread that proposed it', () => {
    expect(app).toMatch(/onRejectFiled=\{\(i\) => markDone\(i, \{ stay: true \}\)\}/);
    expect(focus).toMatch(/onReject=\{onRejectFiled && rejectFiled\}/);
  });
});

describe('the press looks like a press', () => {
  const css = read('renderer/src/components/threads-made.css');
  const rule = css.match(/\.made-approve \{[^}]*\}/)[0];

  it('is a bordered control in the row, not a word pretending to be one', () => {
    expect(rule).toMatch(/border: 1px solid/);
  });

  // "a button that matches our own app's style (sharp borders, caps text etc.)",
  // chosen off four drawings: the same square chip the state words are set in,
  // in the accent, because the one thing in the list you can press should be
  // the one coloured thing in it.
  it('wears the app\'s own capitals, square, in the accent', () => {
    expect(rule).toMatch(/text-transform: uppercase/);
    expect(rule).toMatch(/var\(--mono\)/);
    expect(rule).toMatch(/border-radius: 0/);
    expect(rule).toMatch(/var\(--accent\)/);
  });

  it('is pushed to the right-hand edge the state words end at', () => {
    expect(rule).toMatch(/margin-left: auto/);
    // The reserved spacer is gone with the room it reserved.
    expect(css).not.toContain('made-approve-room');
  });

  // "should be closer to the right side tho, feel as tho there's too much
  // padding on the approve button". Three numbers carry that, and all three
  // have to hold together or the column bends:
  //
  //   the row's right-hand padding, which is what the state words end at;
  //   the chip's own padding, which was 9px and read as a gap inside a box;
  //   and 2px of hang, so the chip's BORDER sits a touch past the words while
  //   its letters stay inside them. A box whose edge lines up exactly with a
  //   column of text always reads as further out than the text does.
  it('is tight inside and close to the edge', () => {
    expect(css).toMatch(/\.made-row \{[^}]*padding-right: 10px/);
    expect(rule).toMatch(/padding: 3px 7px/);
    expect(rule).toMatch(/margin-right: -2px/);
  });
});
