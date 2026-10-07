// ENTER ON A COMMAND THAT WANTS WORDS PUTS IT IN THE BOX AND WAITS FOR SEND.
//
// The bug: typing /loop and pressing Return started a loop straight away, with
// nothing to loop on. Nobody ever wants a bare /loop; the description of what
// to repeat is the whole command. Measured by reading `pickRow` in Focus.tsx:
// every command row except Tab went to `send()`, so Enter on /loop, /fork or
// any of the session's own skills ran it with no words at all.
//
// The rule now is the terminal's: a command that wants words is completed into
// the box with its trailing space, she writes them, and Send runs it. A command
// that is whole on its own (/usage, /context, /model) still runs on Enter,
// which is the w-5d1ad29efa fix and stays.
//
// And the box says which command it is holding while she writes, because the
// menu closes on the space and a box that only grew a space is the "Return did
// nothing" complaint /fork once had.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slashRows, enterWaitsForWords, commandBeingWritten } from '../renderer/src/slash-menu.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const row = (query, name, native = []) => slashRows(query, false, true, native).find((r) => r.kind === 'command' && r.cmd.name === name);

describe('Enter on a command row', () => {
  it('waits on a command the session brought, like /loop', () => {
    expect(enterWaitsForWords(row('loop', 'loop', ['loop']))).toBe(true);
    expect(enterWaitsForWords(row('simp', 'simplify', ['simplify']))).toBe(true);
  });

  it('waits on a command whose words are required', () => {
    expect(enterWaitsForWords(row('fork', 'fork'))).toBe(true);
    expect(enterWaitsForWords(row('ren', 'rename'))).toBe(true);
  });

  it('still runs a command that is whole on its own', () => {
    for (const name of ['usage', 'context', 'model', 'effort', 'compact', 'diff', 'help']) {
      expect(enterWaitsForWords(row(name, name)), name).toBe(false);
    }
  });

  it('never waits on a permission mode, which is not a message', () => {
    const mode = slashRows('pl', false, true).find((r) => r.kind === 'mode');
    expect(mode).toBeTruthy();
    expect(enterWaitsForWords(mode)).toBe(false);
  });

  it('is wired into the pick, so Enter fills rather than sends', () => {
    const focus = read('renderer/src/components/Focus.tsx');
    expect(focus).toContain("if (how === 'fill' || enterWaitsForWords(row)) { setText(commandDraft(row.cmd)); ref.current?.focus(); return; }");
  });
});

describe('the command the box is holding', () => {
  it('is named once she has typed past the word', () => {
    expect(commandBeingWritten('/loop ', true, ['loop'])?.name).toBe('loop');
    expect(commandBeingWritten('/loop check the deploy every 5m', true, ['loop'])?.name).toBe('loop');
    expect(commandBeingWritten('/fork try the other layout', true, [])?.name).toBe('fork');
  });

  it('is nothing while the word is still being typed, which is the menu\'s job', () => {
    expect(commandBeingWritten('/loop', true, ['loop'])).toBe(null);
    expect(commandBeingWritten('/', true, ['loop'])).toBe(null);
  });

  it('is nothing for a word that is not a command, or not at the start', () => {
    expect(commandBeingWritten('/looping around', true, ['loop'])).toBe(null);
    expect(commandBeingWritten('please /loop this', true, ['loop'])).toBe(null);
    expect(commandBeingWritten('plain words', true, ['loop'])).toBe(null);
  });

  it('is nothing for a command that is whole on its own, which ran on Enter', () => {
    expect(commandBeingWritten('/usage ', true, [])).toBe(null);
  });

  it('is nothing for a Claude command on a Codex row', () => {
    expect(commandBeingWritten('/loop check it', false, ['loop'])).toBe(null);
  });
});
