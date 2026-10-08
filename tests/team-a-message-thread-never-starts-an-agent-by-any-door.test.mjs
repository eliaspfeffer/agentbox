// A MESSAGE THREAD BETWEEN TWO PEOPLE NEVER STARTS AN AGENT, WHICHEVER DOOR IS
// KNOCKED ON.
//
// Reported 2026-10-06 (w-7fc38861be): "In this chat with Margaret, for some
// reason the agent took over when I didn't ask it to." Measured on the real
// store: the conversation's ledger (a `direct` project, written by the
// teammate, last touched by her own test replies at 19:12) shows a worker
// claiming it at 22:28, spawned as "continuation (the founder answered)", in a
// wave of seventeen workers started between 22:25 and 22:30. That run read the
// thread, wrote a note and a result into it, and drew "The agent" into the
// middle of a conversation between two people.
//
// The tick could not have done it: `mayRunHere` refuses a direct project, and
// refuses this row twice over because its runner is the teammate. But the tick
// is not the only door. `resumeItems` (⌘K "Resume This Agent", or a resume over
// ticked rows), its slot queue, the interrupted-session recovery and a
// mid-flight reply all call `spawnWorker` without asking that rule, and
// `resumeItems` also reopened the row first. So the refusal now lives where
// the practice project's does, inside `spawnWorker`, which every one of them
// reaches; and `resumeItems` leaves a conversation alone rather than reopening
// it and counting it as resumed.
import { it, expect, describe, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Supervisor } from '../main/supervisor.mjs';

const ME = 'p-me';
const TEAMMATE = 'p-teammate';

const chatProject = { slug: 'direct-bbde723e', team: { projectId: 'c1', visibility: 'people', people: [ME], sharedBy: TEAMMATE, direct: true } };
const sharedProject = { slug: 'website', team: { projectId: 's1', visibility: 'team', people: [], sharedBy: ME, direct: false } };
const privateProject = { slug: 'home', team: null };

// The real conversation, reduced: the teammate opened it, it was handed to
// them, and the last words are yours, in a thread.
const chat = {
  id: 'w-881203686a', product: chatProject.slug, status: 'open', kind: 'directive',
  title: 'Hi, sending my findings here', body: 'Title: New project presets an empty folder',
  createdBy: TEAMMATE, assignee: TEAMMATE, people: [TEAMMATE, ME],
  answer: 'Testing a thread :)', inReplyTo: 'l-a9d616ede66a00ad',
  wrote: { answer: { ts: 1791252773333, by: ME }, body: { ts: 1, by: TEAMMATE } },
  labels: [], createdAt: 1, updatedAt: 1,
};
const rowIn = (product, id) => ({
  id, product: product.slug, status: 'open', kind: 'directive', title: id, body: 'Do the thing',
  createdBy: ME, answer: 'Go ahead', wrote: { answer: { ts: 5, by: ME } }, labels: ['founder'], createdAt: 1, updatedAt: 1,
});

let before;
beforeEach(() => { before = process.env.AGENTBOX_PERSON_ID; process.env.AGENTBOX_PERSON_ID = ME; });
afterEach(() => { if (before === undefined) delete process.env.AGENTBOX_PERSON_ID; else process.env.AGENTBOX_PERSON_ID = before; });

function supervisorWith(items) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'team-chat-door-'));
  const reopened = [];
  const sup = new Supervisor({ storeRoot: tmp, maxConcurrentSessions: 5 }, {
    listItems: () => items,
    listProducts: () => [chatProject, sharedProject, privateProject].map((p) => ({ ...p, name: p.slug, dir: tmp })),
    answerItem: (product, id, patch) => reopened.push({ id, ...patch }),
    isDue: () => true,
  }, tmp);
  // A start is recorded at the first step past the refusals, where a real one
  // would begin building the row's folder.
  sup.started = [];
  sup._folderFirst = (item) => { sup.started.push(item.id); return true; };
  sup._liveProfilesFor = () => ['default'];
  sup.reopened = reopened;
  return sup;
}

describe('the door every run goes through', () => {
  it('refuses a conversation, as a fresh run and as a reply', () => {
    const sup = supervisorWith([chat]);
    sup.spawnWorker(chat);
    sup.spawnWorker(chat, { continuation: true });
    expect(sup.started).toEqual([]);
  });

  it('still starts your private rows and your ordinary shared tasks, with the same options', () => {
    const mine = rowIn(privateProject, 'w-000000a1');
    const team = rowIn(sharedProject, 'w-000000a2');
    const sup = supervisorWith([mine, team]);
    sup.spawnWorker(mine, { continuation: true });
    sup.spawnWorker(team);
    expect(sup.started).toEqual(['w-000000a1', 'w-000000a2']);
  });

  it('refuses a conversation even when its record no longer says direct on the row, only on the project', () => {
    // The flag is the project's, never the row's: a row carries no `direct` of
    // its own, so the refusal cannot hinge on one.
    const sup = supervisorWith([chat]);
    sup.spawnWorker({ ...chat, assignee: undefined, createdBy: ME });
    expect(sup.started).toEqual([]);
  });
});

describe('putting an agent back on rows by name', () => {
  it('leaves a conversation as it was: not reopened, not started, not counted as resumed', () => {
    const closed = { ...chat, status: 'done' };
    const sup = supervisorWith([closed]);
    const out = sup.resumeItems([closed.id]);
    expect(sup.started).toEqual([]);
    expect(sup.reopened).toEqual([]);
    expect(out.resumed).toBe(0);
    expect(out.queued).toBe(0);
  });

  it('still puts one back on the rest of what you ticked alongside it', () => {
    const mine = rowIn(privateProject, 'w-000000b1');
    const sup = supervisorWith([chat, mine]);
    const out = sup.resumeItems([chat.id, mine.id]);
    expect(sup.started).toEqual(['w-000000b1']);
    expect(out.resumed).toBe(1);
  });
});

describe('a reply that lands while a run is going', () => {
  it('does not start one on a conversation', () => {
    const sup = supervisorWith([chat]);
    sup.deliverMidflightReply({ ...chat, answer: 'earlier', wrote: { answer: { ts: 1 } } }, 'earlier');
    expect(sup.started).toEqual([]);
  });
});
