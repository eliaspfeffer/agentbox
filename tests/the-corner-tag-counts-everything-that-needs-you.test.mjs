// THE CORNER TAG SAID "3 WAITING" OVER A NEEDS YOU OF 58 (w-0961e5523b).
//
// The app hands the tag every thread in Needs you, and the tag then dropped
// every one that had become ready more than a day ago. That cut was the answer
// to a list that led with weeks-old threads, but it took the count down with
// it, so the number in the corner stopped matching the number in the app.
// Measured on the real inbox: 58 in Needs you, 3 of them from the last day,
// and the tag read "3 waiting".
//
// The count is everything waiting on you. Only the order of the list keeps
// the old threads out of the way: newest first, three lines, then "and N more".
import { describe, expect, it } from 'vitest';
import { readyNow, tagSays, tagShows, cardLines } from '../shared/corner-tag.mjs';

const now = Date.UTC(2026, 9, 11, 12, 0, 0);
const hour = 60 * 60_000;
const day = 24 * hour;

// 58 threads: 3 that became ready in the last few hours, 55 from days ago.
const inbox = [
  ...Array.from({ length: 3 }, (_, i) => ({ id: `today-${i}`, title: `T${i}`, says: 'is ready for you', since: now - (i + 1) * hour })),
  ...Array.from({ length: 55 }, (_, i) => ({ id: `old-${i}`, title: `O${i}`, says: 'is ready for you', since: now - (2 + i) * day })),
];

describe('the tag counts what Needs you counts', () => {
  it('says "58 waiting" over a Needs you of 58, not the 3 from today', () => {
    const ready = readyNow(inbox, now);
    expect(ready).toHaveLength(58);
    expect(tagSays({ ready: ready.length, working: 2 })).toEqual({ kind: 'ready', text: '58 waiting' });
  });

  it('counts a thread either side of a day old the same', () => {
    const r = readyNow([
      { id: 'inside', since: now - day + 60_000 },
      { id: 'past', since: now - day - 60_000 },
    ], now);
    expect(r.map((x) => x.id)).toEqual(['inside', 'past']);
  });

  it('shows over an inbox of only old threads instead of saying how many are working', () => {
    const old = inbox.filter((x) => x.id.startsWith('old-'));
    const ready = readyNow(old, now).length;
    expect(ready).toBe(55);
    expect(tagSays({ ready, working: 4 })).toEqual({ kind: 'ready', text: '55 waiting' });
    expect(tagShows({ on: true, hiddenUntil: 0, now, inApp: false, ready, working: 0 })).toBe(true);
  });

  it('still counts an agent stopped on a yes, which has no moment it became ready', () => {
    const r = readyNow([{ id: 'ask', since: undefined }, ...inbox], now);
    expect(r).toHaveLength(59);
    expect(r[0].id).toBe('ask');
  });

  it('counts nothing when nothing needs you', () => {
    expect(readyNow([], now)).toEqual([]);
    expect(readyNow(undefined, now)).toEqual([]);
    expect(tagSays({ ready: 0, working: 2 })).toEqual({ kind: 'working', text: '2 working' });
  });
});

describe('the old threads stay out of the way of the list', () => {
  it('leads with the newest three and folds the rest into "and N more"', () => {
    const shuffled = [...inbox].reverse();
    const { lines, more } = cardLines(readyNow(shuffled, now), now);
    expect(lines.map((l) => l.id)).toEqual(['today-0', 'today-1', 'today-2']);
    expect(more).toBe(55);
  });
});
