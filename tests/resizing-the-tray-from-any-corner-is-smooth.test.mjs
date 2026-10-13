// RESIZING THE AGENT TRAY, 2026-10-13, second attempt.
//
// The first had one small ledge in the bottom-left corner: "there was no way to
// discover that it was actually expandable... I'm not a fan of that UI". Now
// every corner takes a drag. And it has to be smooth: "as I scaled it, I
// noticed that sometimes the corner visually gets cut off. The dots don't even
// look right and there are a lot of little quirks with it."
//
// The cut-off corner was the window lagging the page. The page redraws at the
// new size and reports it a frame later; until that report the window is still
// the old rectangle, and a tag drawn larger than its window has its corners
// clipped. So a growing drag widens the window BEFORE the page is told, and a
// shrinking one waits for the page. That is what most of this file measures,
// by driving the real controller with a pretend screen, windows and cursor.
import { describe, expect, it } from 'vitest';
import { createCornerTag } from '../main/corner-tag.mjs';
import { GRIPS, TAG_LIMITS, cardScale, heightFromDrag, tagHeight, tagZoom } from '../shared/corner-tag.mjs';

const AREA = { x: 0, y: 0, width: 1728, height: 1080 };

function rig({ config = {} } = {}) {
  const handlers = {};
  const timers = [];
  let timerId = 0;
  let clock = 1_000_000;
  const windows = [];
  class FakeWindow {
    constructor() {
      this.bounds = null; this.visible = false; this.sent = [];
      this.webContents = { send: (ch, p) => this.sent.push([ch, p]), on: () => {} };
      windows.push(this);
    }
    setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} on() {}
    isDestroyed() { return false; } isVisible() { return this.visible; }
    hide() { this.visible = false; } showInactive() { this.visible = true; }
    setBounds(b) { this.bounds = b; } getBounds() { return this.bounds; }
    setPosition(x, y) { this.bounds = { ...this.bounds, x, y }; }
  }
  const cursor = { x: 0, y: 0 };
  const screen = {
    getAllDisplays: () => [{ workArea: AREA }], getDisplayMatching: () => ({ workArea: AREA }),
    getCursorScreenPoint: () => ({ x: cursor.x, y: cursor.y }), on: () => {}, removeListener: () => {},
  };
  const saved = [];
  const api = createCornerTag({
    BrowserWindow: FakeWindow, screen, ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, removeHandler: () => {} },
    powerMonitor: { on: () => {}, removeListener: () => {} },
    Menu: { buildFromTemplate: (t) => ({ popup: () => { api.menu = t; } }) },
    config, saveConfig: (c, patch) => { Object.assign(c, patch); saved.push(patch); },
    mainWindow: { isDestroyed: () => false, isFocused: () => false, isMinimized: () => false, on: () => {}, show: () => {}, focus: () => {}, restore: () => {}, webContents: { send: () => {} } },
    load: (w, part) => { w.part = part; }, preload: '/p.cjs', now: () => clock,
    setTimer: (fn, ms) => { const id = ++timerId; timers.push({ id, fn, at: clock + ms }); return id; },
    clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    mac: true,
  });
  const call = (ch, p) => handlers[ch](null, p);
  const advance = (ms) => {
    const target = clock + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > target) break;
      timers.shift(); clock = next.at; next.fn();
    }
    clock = target;
  };
  const win = () => windows.filter((w) => w.part === 'tag').at(-1);
  // The page draws everything from the scale it is handed, so what it reports
  // back is that scale: a 28pt tag, four times as wide as it is tall.
  const scaleSent = () => win().sent.filter((s) => s[0] === 'corner-tag:state').at(-1)[1].scale;
  const redraw = () => {
    const height = Math.round(28 * scaleSent());
    call('corner-tag:size', { part: 'tag', width: Math.round(height * 3.9), height });
    return { width: Math.round(height * 3.9), height };
  };
  const show = () => {
    call('zero:corner-tag', { ready: [{ id: 'w-1', title: 'Pricing page', says: 'is ready for you', since: clock - 60_000 }], working: 3 });
    call('corner-tag:ready', { part: 'tag' });
    redraw();
  };
  return { api, call, win, cursor, advance, saved, config, show, redraw, scaleSent, clock: () => clock };
}

// Hold a corner and move the cursor, redrawing the page as a browser would,
// and report every rectangle the window was given along the way.
function dragCorner(r, corner, steps) {
  const b = r.win().bounds;
  const grab = {
    x: corner.endsWith('r') ? b.x + b.width - 2 : b.x + 2,
    y: corner.startsWith('b') ? b.y + b.height - 2 : b.y + 2,
  };
  r.cursor.x = grab.x; r.cursor.y = grab.y;
  r.call('corner-tag:press', { x: grab.x, y: grab.y, grip: true, corner });
  const frames = [];
  for (const [dx, dy] of steps) {
    r.cursor.x = grab.x + dx; r.cursor.y = grab.y + dy;
    r.advance(16);
    const drawn = { width: Math.round(28 * r.scaleSent() * 3.9), height: Math.round(28 * r.scaleSent()) };
    frames.push({ window: { ...r.win().bounds }, drawn });
    r.redraw();
  }
  r.call('corner-tag:release', { cancelled: false });
  return frames;
}

describe('every corner resizes it', () => {
  it('grows when the corner is dragged away from the tag, from any of the four', () => {
    for (const corner of GRIPS) {
      const r = rig();
      r.show();
      const was = r.win().bounds.height;
      const out = corner.startsWith('b') ? 60 : -60;
      dragCorner(r, corner, [[0, out / 3], [0, out]]);
      expect(r.win().bounds.height).toBeGreaterThan(was);
    }
  });

  it('shrinks when it is dragged into the tag, from any of the four', () => {
    for (const corner of GRIPS) {
      const r = rig({ config: { cornerTagZoom: 1.6 } });
      r.show();
      const was = r.win().bounds.height;
      const inward = corner.startsWith('b') ? -20 : 20;
      dragCorner(r, corner, [[0, inward]]);
      expect(r.win().bounds.height).toBeLessThan(was);
    }
  });

  it('never draws the tag larger than the window it is in, which is what cut the corners off', () => {
    for (const corner of GRIPS) {
      const r = rig();
      r.show();
      const out = corner.startsWith('b') ? 1 : -1;
      const steps = [4, 9, 15, 22, 30, 40, 22, 9, 30, 50].map((n) => [n * (corner.endsWith('r') ? 1 : -1), n * out]);
      for (const frame of dragCorner(r, corner, steps)) {
        expect(frame.window.width).toBeGreaterThanOrEqual(frame.drawn.width);
        expect(frame.window.height).toBeGreaterThanOrEqual(frame.drawn.height);
      }
    }
  });

  it('holds the corner opposite the one she has hold of exactly still', () => {
    for (const corner of GRIPS) {
      const r = rig();
      r.show();
      const b = r.win().bounds;
      const anchor = {
        x: corner.endsWith('r') ? b.x : b.x + b.width,
        y: corner.startsWith('b') ? b.y : b.y + b.height,
      };
      const steps = [[10, 10], [24, 24], [40, 40]].map(([dx, dy]) => [corner.endsWith('r') ? dx : -dx, corner.startsWith('b') ? dy : -dy]);
      for (const frame of dragCorner(r, corner, steps)) {
        const w = frame.window;
        expect(corner.endsWith('r') ? w.x : w.x + w.width).toBe(anchor.x);
        expect(corner.startsWith('b') ? w.y : w.y + w.height).toBe(anchor.y);
      }
    }
  });

  it('stays on its screen, and keeps its corner, once she lets go', () => {
    const r = rig();
    r.show();
    dragCorner(r, 'br', [[40, 40], [80, 80]]);
    const b = r.win().bounds;
    expect(b.x).toBeGreaterThanOrEqual(AREA.x);
    expect(b.y).toBeGreaterThanOrEqual(AREA.y);
    expect(b.x + b.width).toBeLessThanOrEqual(AREA.x + AREA.width);
    expect(b.y + b.height).toBeLessThanOrEqual(AREA.y + AREA.height);
    expect(r.config.cornerTagPlace?.corner).toBe('br');
  });

  it('remembers the size as a multiple, once, when she lets go', () => {
    const r = rig();
    r.show();
    dragCorner(r, 'br', [[0, 30]]);
    const zooms = r.saved.filter((p) => 'cornerTagZoom' in p);
    expect(zooms).toHaveLength(1);
    expect(zooms[0].cornerTagZoom).toBeGreaterThan(1);
    expect(zooms[0].cornerTagZoom).toBe(tagZoom(zooms[0].cornerTagZoom));
  });

  it('writes nothing, and opens nothing, when a corner is pressed and let go', () => {
    const r = rig();
    r.show();
    const b = r.win().bounds;
    r.cursor.x = b.x + b.width - 2; r.cursor.y = b.y + b.height - 2;
    r.call('corner-tag:press', { x: r.cursor.x, y: r.cursor.y, grip: true, corner: 'br' });
    r.advance(16);
    r.call('corner-tag:release', { cancelled: false });
    expect(r.saved.filter((p) => 'cornerTagZoom' in p)).toHaveLength(0);
    expect(r.win().bounds.height).toBe(Math.round(28 * tagHeight(AREA.width) / 28));
  });

  it('stays a tag however far the corner is dragged', () => {
    const r = rig();
    r.show();
    dragCorner(r, 'br', [[0, 400], [0, 900]]);
    expect(r.win().bounds.height).toBeLessThanOrEqual(TAG_LIMITS.max);
    const small = rig();
    small.show();
    dragCorner(small, 'br', [[0, -400]]);
    expect(small.win().bounds.height).toBeGreaterThanOrEqual(TAG_LIMITS.min);
  });
});

describe('which way a corner means bigger', () => {
  it('follows the corner she has hold of, not the screen', () => {
    expect(heightFromDrag('br', 31, 0, 20)).toBe(51);
    expect(heightFromDrag('tr', 31, 0, -20)).toBe(51);
    expect(heightFromDrag('bl', 31, -20, 0)).toBe(38);
    expect(heightFromDrag('tl', 31, -20, -20)).toBe(58);
    expect(heightFromDrag('br', 31, 0, -20)).toBe(11);
  });
});

describe('the list does not grow as hard as the tag', () => {
  it('stays near the size of everything else on the screen', () => {
    // her 32": the tag is 48px, 1.71 times the base, and 13px rows at that
    // scale came out at 22px, "way bigger than anything else" on her screen
    expect(cardScale(48 / 28)).toBeLessThan(1.25);
    expect(13 * cardScale(48 / 28)).toBeLessThan(17);
    // and on a laptop it is all but the app's own size
    expect(cardScale(31 / 28)).toBeLessThan(1.05);
    expect(cardScale(1)).toBe(1);
  });

  it('never shrinks below the words it sits beside, and never runs away with the tag', () => {
    for (const s of [0.5, 1, 1.2, 1.7, 2.4, 9]) {
      expect(cardScale(s)).toBeGreaterThanOrEqual(1);
      expect(cardScale(s)).toBeLessThanOrEqual(1.25);
    }
  });
});
