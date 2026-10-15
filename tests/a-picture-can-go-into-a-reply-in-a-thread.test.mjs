// A PICTURE CAN GO INTO A REPLY IN A THREAD, AND ATTACH LOOKS LIKE ATTACH.
//
// Reported 2026-10-13 (w-140ac855b1): "In team threads I can't seem to attach
// images or paste them in the chat. At least for the reply, there doesn't seem
// to be an easy way to attach something." Measured on their screenshot and in
// the code before the change:
//
//  - The "Reply in thread…" box in the side panel was a bare textarea and a
//    Send button. No paste handler, no drop handler, no attach button: a
//    screenshot pasted there went nowhere.
//  - The chat's own reply box did take a paste, and had an attach button, but
//    it was drawn as a "+", sitting between "@" and the emoji face, and the
//    person looking straight at it did not read it as attach.
//
// So the panel's box now takes a picture the three ways the chat's box does,
// and both draw a paperclip.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThreadPanel } from '../renderer/src/team/ThreadPanel.tsx';
import { FormatBar } from '../renderer/src/team/FormatBar.tsx';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const PLUS = 'M8 3v10M3 8h10';
const CLIP = 'm13.6 7.6-5.5 5.5';

const panel = () => renderToStaticMarkup(React.createElement(ThreadPanel, {
  product: 'talk-with-maya',
  parent: { at: 1, who: 'you', text: 'two tiers or three?', uid: 'u-1' },
  replies: [], md: (t) => React.createElement('p', null, t), width: 440,
  onSend: () => {}, onClose: () => {}, onResize: () => {},
}));

describe('the reply box in a thread', () => {
  it('has an attach button, drawn as a paperclip', () => {
    const html = panel();
    expect(html).toContain('aria-label="Attach a file"');
    expect(html).toContain(CLIP);
    expect(html).not.toContain(PLUS);
  });

  it('has the file picker the button opens, hidden', () => {
    expect(panel()).toMatch(/<input type="file" multiple="" style="display:none"/);
  });

  it('takes a pasted picture and a dropped one', () => {
    const src = code(read('renderer/src/team/ThreadPanel.tsx'));
    expect(src).toMatch(/onPaste=\{async \(e\) => \{\s*const pasted = await fromPaste\(e\)/);
    expect(src).toMatch(/onDrop=\{async \(e\) => \{[\s\S]*?collectFiles\(e\.dataTransfer\.files\)/);
  });

  // The file is saved into the conversation's own project, which is the folder
  // the team sync reads to send it on (main/team/sync.mjs), and the reply
  // carries the link to it after the words.
  it('saves the picture into the conversation and links it from the reply', () => {
    const src = code(read('renderer/src/team/ThreadPanel.tsx'));
    expect(src).toMatch(/\[words, await persistAttachments\(product, files\)\]\.filter\(Boolean\)\.join\('\\n\\n'\)/);
    expect(code(read('renderer/src/components/ItemThread.tsx'))).toMatch(/<ThreadPanel\s+product=\{item\.product\}/);
  });

  // THE BOUNDARY: a picture with no words is a reply worth sending, and an
  // empty box is still not.
  it('sends a picture with no words, and never an empty reply', () => {
    const src = code(read('renderer/src/team/ThreadPanel.tsx'));
    expect(src).toMatch(/if \(!words && !attachments\.length\) return;/);
    expect(src).toMatch(/const ready = !!draft\.trim\(\) \|\| attachments\.length > 0;/);
    expect(panel()).toMatch(/<button type="button" class="dock-send" disabled="" title="Send · ↵">Send <kbd>↵<\/kbd><\/button>/);
  });
});

// THE BOX ITSELF, second round. Their words on a one-line box with Send in the
// middle of it: "there's still not enough space to write your message... The
// send button should also be in the bottom-right corner... our approach should
// be rather similar to that of other input fields in our application."
describe('the thread reply box is laid out like the chat\'s own', () => {
  const html = panel();
  const css = read('renderer/src/team/chat.css');

  it('has room for three lines, growing as you write', () => {
    expect(html).toMatch(/<textarea rows="3"/);
    expect(css).toMatch(/\.chat-thread-box textarea \{[^}]*min-height: 82px; max-height: 240px;/);
  });

  it('ends in a footer: the chat\'s formatting bar on the left, Send last, in the corner', () => {
    const bar = html.slice(html.indexOf('class="chat-thread-bar"'));
    expect(bar.indexOf('class="fmt-bar"')).toBeGreaterThan(-1);
    expect(bar.indexOf('class="dock-send"')).toBeGreaterThan(bar.indexOf('aria-label="Add an emoji"'));
    expect(html.indexOf('class="chat-thread-bar"')).toBeGreaterThan(html.indexOf('<textarea'));
    expect(html.lastIndexOf('</button>')).toBe(html.indexOf('Send <kbd>↵</kbd></button>') + 'Send <kbd>↵</kbd>'.length);
  });

  // THE CASE THAT MUST NOT HAPPEN: a panel dragged narrow pushing Send off the
  // edge. The marks go; @, the paperclip and the emoji stay.
  it('lets the formatting marks go before Send when the panel is narrow', () => {
    expect(css).toMatch(/@container \(max-width: 400px\) \{\s*\.chat-thread-bar \.fmt-btn:has\(~ \.fmt-gap\), \.chat-thread-bar \.fmt-gap \{ display: none; \}/);
  });
});

// THE PICTURE DOES NOT TAKE OVER THE PANEL. Their words on the first build:
// "the image takes up almost all of the thread. In other chats the image is at
// the bottom and expands the thread." It sat above the line you type on at the
// app's full thumbnail size (84px tall, up to 220 wide) in a panel 440 wide.
describe('a picture waiting in the thread box', () => {
  const src = code(read('renderer/src/team/ThreadPanel.tsx'));
  const css = read('renderer/src/team/chat.css');

  it('sits under the words and above the footer', () => {
    expect(src.indexOf('<AttachRow')).toBeGreaterThan(src.indexOf('placeholder="Reply in thread…"'));
    expect(src.indexOf('<AttachRow')).toBeLessThan(src.indexOf('className="chat-thread-bar"'));
  });

  it('is drawn small there, and only there', () => {
    expect(css).toMatch(/\.chat-thread-box \.attach-thumb img \{ height: 48px; max-width: 120px; \}/);
    // The chat's own box keeps the full size.
    expect(read('renderer/src/styles.css')).toMatch(/\.attach-thumb img \{\s*height: 84px;/);
  });
});

// THE NEW MESSAGE CARD, TO A PERSON. It took no paste, no drop and had no
// attach button, and said "a message to a person carries words only".
describe('a new message to a person', () => {
  const src = code(read('renderer/src/threads/ThreadComposer.tsx'));

  it('no longer says its files stay behind', () => {
    expect(src).not.toMatch(/carries words only/);
    expect(src).not.toMatch(/if \(person\) return;/);
  });

  it('sends the files it holds with the words', () => {
    expect(src).toMatch(/attachments\.map\(\(\{ name, dataBase64, srcPath \}\) => \(\{ name, dataBase64, srcPath \}\)\)/);
    expect(src).toMatch(/person \? !!text\.trim\(\) \|\| attachments\.length > 0/);
  });

  it('has an attach button beside Send', () => {
    const from = src.indexOf('{person ? (');
    const bar = src.slice(from, src.indexOf('\n        ) : (', from));
    expect(bar).toMatch(/aria-label="Attach files"/);
  });
});

describe('the chat\'s own reply box', () => {
  const bar = (onAttach) => renderToStaticMarkup(React.createElement(FormatBar, { box: { current: null }, onChange: () => {}, onAttach }));

  it('draws attach as the same paperclip', () => {
    const html = bar(() => {});
    expect(html).toContain(CLIP);
    expect(html).not.toContain(PLUS);
  });

  // THE CASE THAT MUST NOT MATCH: where there is nothing to attach to, there is
  // no button at all.
  it('draws no attach button where there is nothing to attach to', () => {
    expect(bar(undefined)).not.toContain('Attach a file');
  });
});
