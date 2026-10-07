// THE ALL TAB HOLDS EVERY THREAD, FINISHED ONES INCLUDED, AND THE OLD ONES
// ARRIVE AS YOU SCROLL.
//
// Reported 2026-10-07 (w-fda2165ec6): "done" and "all" did not contain most of
// her tasks. All was built as "everything open" (2026-10-01), so on her store
// it held about 40 threads of 1,339, and none of the 586 finished ones Done
// could show. Done itself was missing 155 more that the 8 MB ledger read cut
// off (tests/old-finished-threads-load-a-page-at-a-time.test.mjs).
//
// So All is now everything: what is still open first, in the Display's sort,
// then what is finished, newest finished first the way Done reads. And the
// page of old finished threads the foot of the list asks for is merged into
// the rows here: a thread missing from the snapshot is added, a half-cut one
// is replaced by its whole copy, and one the snapshot already has whole is
// left alone, because the snapshot is the live copy.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sorted } from '../renderer/src/threads/page-rules.ts';
import { mergeRows, teammateRows } from '../renderer/src/threads/people-rules.ts';
import { withOlder } from '../renderer/src/older-threads.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, '..', 'renderer', 'src', ...p), 'utf8');

const NOW = Date.UTC(2026, 9, 7, 17);
const HOUR = 3_600_000;
const byPriority = { view: 'list', sort: 'priority', priorities: [], projects: [], updated: 'any', privacy: 'any' };
const byUpdated = { ...byPriority, sort: 'updated' };
const open = (id, priority, ago) => ({ id, priority, product: 'p', status: 'open', updatedAt: NOW - ago, wrote: {} });
const done = (id, priority, doneAgo, touchedAgo = doneAgo) => ({
  id, priority, product: 'p', status: 'done', updatedAt: NOW - touchedAgo, wrote: { status: { ts: NOW - doneAgo } },
});
const ids = (list) => list.map((r) => r.id ?? r.threadId ?? r.item?.id ?? r.card?.threadId);

describe('the order of All', () => {
  const rows = [done('done-urgent', 9, 3 * HOUR), open('open-low', 1, HOUR), done('done-new', 1, HOUR, 5 * HOUR), open('open-urgent', 9, 2 * HOUR)];

  it('puts every open thread ahead of every finished one, under Sort by Priority', () => {
    expect(ids(sorted(rows, byPriority, 'all'))).toEqual(['open-urgent', 'open-low', 'done-new', 'done-urgent']);
  });

  it('and under Sort by Updated, open by when they changed, finished by when they finished', () => {
    expect(ids(sorted(rows, byUpdated, 'all'))).toEqual(['open-low', 'open-urgent', 'done-new', 'done-urgent']);
  });

  it('leaves the other tabs alone: Needs you still sorts by priority alone', () => {
    expect(ids(sorted(rows, byPriority, 'inbox'))).toEqual(['open-urgent', 'done-urgent', 'open-low', 'done-new']);
  });
});

describe("a teammate's threads on All", () => {
  const card = (threadId, state, ago, priority = 5) => ({ personId: 'them', threadId, state, visible: true, title: threadId, project: 'P', priority, updatedAt: NOW - ago });
  const cards = [card('their-open', 'waiting', HOUR), card('their-done', 'done', 2 * HOUR)];
  const args = { tab: 'all', picked: ['me', 'them'], me: 'me', display: byPriority, products: [], now: NOW };

  it('include their finished ones too', () => {
    expect(ids(teammateRows(cards, args)).sort()).toEqual(['their-done', 'their-open']);
  });

  it('and fall in with yours, open ahead, finished after by time', () => {
    const mine = sorted([done('mine-done-new', 5, HOUR / 2), done('mine-done-old', 5, 3 * HOUR), open('mine-open', 5, 4 * HOUR)], byPriority, 'all');
    const out = mergeRows(mine, teammateRows(cards, args), 'priority', { order: [], products: [] }, 'all');
    expect(ids(out)).toEqual(['their-open', 'mine-open', 'mine-done-new', 'their-done', 'mine-done-old']);
  });

  it('Done still takes only finished cards', () => {
    expect(ids(teammateRows(cards, { ...args, tab: 'done' }))).toEqual(['their-done']);
  });
});

describe('a page of old finished threads, merged into the rows', () => {
  const live = [
    { id: 'w-1', product: 'a', title: 'Live', createdAt: 10, updatedAt: 50, status: 'done' },
    { id: 'w-2', product: 'a', title: '', createdAt: 40, updatedAt: 45, status: 'done' },
  ];

  it('adds a thread the snapshot does not have', () => {
    const out = withOlder(live, [{ id: 'w-0', product: 'a', title: 'Old', createdAt: 1, updatedAt: 2, status: 'done' }]);
    expect(out.map((i) => i.id)).toEqual(['w-1', 'w-2', 'w-0']);
  });

  it('replaces a half-cut one with its whole copy', () => {
    const out = withOlder(live, [{ id: 'w-2', product: 'a', title: 'Started long ago', createdAt: 5, updatedAt: 45, status: 'done' }]);
    expect(out.find((i) => i.id === 'w-2').title).toBe('Started long ago');
  });

  it('keeps the live copy when the snapshot already has it whole', () => {
    const out = withOlder(live, [{ id: 'w-1', product: 'a', title: 'Stale', createdAt: 10, updatedAt: 20, status: 'done' }]);
    expect(out.find((i) => i.id === 'w-1').title).toBe('Live');
  });

  it('keeps the live copy when it moved on since the page was read', () => {
    const out = withOlder(live, [{ id: 'w-2', product: 'a', title: 'Started long ago', createdAt: 5, updatedAt: 30, status: 'done' }]);
    expect(out.find((i) => i.id === 'w-2').title).toBe('');
  });

  it('does not confuse the same id in two projects', () => {
    const out = withOlder(live, [{ id: 'w-1', product: 'b', title: 'Other project', createdAt: 1, updatedAt: 2, status: 'done' }]);
    expect(out).toHaveLength(3);
  });

  it('hands the snapshot back untouched when there is nothing older', () => {
    expect(withOlder(live, [])).toBe(live);
  });
});

describe('the app', () => {
  const app = src('App.tsx');
  it('builds All from every tab, Done included', () => {
    const all = app.slice(app.indexOf('const allRows = useMemo'), app.indexOf('const allRows = useMemo') + 600);
    expect(all).toContain('...done');
  });
  it('asks for the next page at the foot of Done and All, and only there', () => {
    expect(app).toMatch(/onEnd=\{[^}]*view === 'done' \|\| view === 'all'/);
    expect(src('components', 'List.tsx')).toContain('IntersectionObserver');
  });
  it('merges what arrives into the rows every tab reads', () => {
    expect(app).toMatch(/withOlder\(snap\?\.items \?\? \[\], older\)/);
    expect(app).toMatch(/walkRows\(itemsWithOlder, run\)/);
  });
});
