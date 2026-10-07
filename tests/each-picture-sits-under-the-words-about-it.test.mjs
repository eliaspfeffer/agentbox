// EACH PICTURE SITS UNDER THE WORDS ABOUT IT.
//
// What broke (w-630e526abe, 2026-10-07): a run that drew three fixes, A, B and
// C, wrote all three explanations at the top of its answer and then stacked the
// screenshots underneath, so comparing them meant scrolling back up to find
// which paragraph went with which picture. The app draws a picture exactly
// where it is named (remark-artifact-paths.ts), so the stacking was the rule's
// doing: it asked for every path "on its own line" after the answer and said
// nothing about captions. When a run did try to interleave, it named the path
// inside a sentence or a bullet, and the picture, which draws as a block, split
// the sentence or was pushed in under the bullet.
//
// Measured by reading the shipped rule: the one paragraph about pictures said
// where to save them and "one per line", and nothing about where they sit
// relative to the words. These tests hold the new wording, and run the rule's
// own example through the renderer's picture plugin to prove it draws as
// caption, picture, caption, picture.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { linkArtifactPaths } from '../renderer/src/remark-artifact-paths.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = fs.readFileSync(path.join(root, 'briefs/message-rules.md'), 'utf8');
const flat = rules.replace(/\s+/g, ' ');

// The worked example in the rule, from its first bold label to the end of the
// second paragraph, with its placeholders filled the way a run fills them.
const example = (dir) => {
  const start = rules.indexOf('**A. ');
  const end = rules.indexOf('\n\n', rules.indexOf('**B. '));
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return rules.slice(start, end).replaceAll('<docs folder>', dir).replaceAll('<task id>', 'w-1');
};

const drawn = (markdown, dir) => {
  const tree = unified().use(remarkParse).parse(markdown);
  linkArtifactPaths(tree, { dir });
  return tree;
};

describe('the rule for showing pictures', () => {
  it('asks for the words about a picture directly above it, one picture at a time', () => {
    expect(flat).toMatch(/name each one right under the words about it/i);
  });

  it('forbids piling the pictures under all the text', () => {
    expect(flat).toMatch(/never stack the pictures/i);
  });

  it('keeps a path out of a sentence and out of a bullet, which is the wonky case', () => {
    expect(flat).toMatch(/never in the middle of a sentence or inside a bullet/i);
  });

  it('still says where a picture is saved, and that /tmp is never drawn', () => {
    expect(flat).toMatch(/in designs\/ under this task's id/);
    expect(flat).toMatch(/never in \/tmp/);
  });

  it('says the captions do not eat the short answer\'s word budget', () => {
    expect(flat).toMatch(/captions do not count toward the 200 words/i);
  });
});

describe('the rule\'s own example, drawn by the app', () => {
  const dir = '/Users/someone/store/acme';

  it('draws as caption, picture, caption, picture', () => {
    const md = example(dir);
    const tree = drawn(md, dir);
    // Each paragraph: the bold label and its sentences, then the picture.
    const shape = tree.children.map((block) => {
      const kids = block.children ?? [];
      const firstPicture = kids.findIndex((k) => k.type === 'image');
      const wordsBefore = kids.slice(0, Math.max(firstPicture, 0)).some((k) => k.type === 'strong' || (k.type === 'text' && k.value.trim()));
      return firstPicture > -1 && wordsBefore ? 'caption+picture' : firstPicture > -1 ? 'picture' : 'words';
    });
    expect(shape).toEqual(['caption+picture', 'caption+picture']);
  });

  it('puts each picture last in its paragraph, so nothing trails after it', () => {
    const md = example(dir);
    for (const block of drawn(md, dir).children) {
      const kids = block.children.filter((k) => !(k.type === 'text' && !k.value.trim()));
      expect(kids.at(-1).type).toBe('image');
    }
  });

  it('a path in the middle of a sentence still splits it, which is why the rule forbids it', () => {
    const tree = drawn(`Here is A ${dir}/designs/w-1/a.png which does the thing.`, dir);
    const kids = tree.children[0].children;
    expect(kids.map((k) => k.type)).toEqual(['text', 'image', 'text']);
  });
});
