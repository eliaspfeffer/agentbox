// 2026-10-13: "it would be nice to be able to resize. i was thinking dragging
// the side corner of it, but probs other ways to go about doing it."
//
// The tray already sizes itself off the screen it rests on (31px on a laptop,
// up to 48px on her 32"). So what a drag sets is not a height but a MULTIPLE of
// that automatic size: a tag she grows by a fifth stays a fifth bigger when she
// plugs in the big screen, instead of snapping back to a laptop's number.
// The same multiple is what the tag's own menu nudges up and down.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TAG_LIMITS, TAG_ZOOM, tagHeight, tagHeightOn, tagScaleOn, tagZoom, zoomFor, zoomStep,
} from '../shared/corner-tag.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(root, 'renderer/src/corner-tag/main.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'renderer/src/corner-tag/corner-tag.css'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'main/corner-tag-preload.cjs'), 'utf8');
const LAPTOP = 1728;
const BIG = 3413;

describe('the size she drags to is a multiple of the automatic one', () => {
  it('leaves the automatic size alone until she has touched it', () => {
    expect(tagHeightOn(LAPTOP, undefined)).toBe(tagHeight(LAPTOP));
    expect(tagHeightOn(BIG, 1)).toBe(tagHeight(BIG));
    expect(tagZoom(undefined)).toBe(1);
  });

  it('carries what she set to every other screen', () => {
    // a fifth bigger on the laptop is a fifth bigger on the 32" too
    const zoom = zoomFor(tagHeight(LAPTOP) * 1.2, LAPTOP);
    expect(zoom).toBeCloseTo(1.2, 1);
    expect(tagHeightOn(BIG, zoom)).toBeGreaterThan(tagHeight(BIG));
    expect(tagHeightOn(BIG, zoom) / tagHeight(BIG)).toBeCloseTo(zoom, 1);
  });

  it('reads a dragged height back as that multiple', () => {
    expect(zoomFor(tagHeight(LAPTOP), LAPTOP)).toBe(1);
    expect(zoomFor(62, LAPTOP)).toBe(tagZoom(62 / 31));
    expect(zoomFor(0, LAPTOP)).toBe(tagZoom(TAG_LIMITS.min / 31));
  });

  it('stays a tag however far the drag goes', () => {
    for (const width of [1280, LAPTOP, 2560, BIG]) {
      expect(tagHeightOn(width, 99)).toBeLessThanOrEqual(TAG_LIMITS.max);
      expect(tagHeightOn(width, -99)).toBeGreaterThanOrEqual(TAG_LIMITS.min);
      expect(tagZoom(99)).toBe(TAG_ZOOM.max);
      expect(tagZoom(0.01)).toBe(TAG_ZOOM.min);
    }
  });

  it('goes a notch at a time from the menu, and stops at its ends', () => {
    expect(zoomStep(1, 1)).toBeCloseTo(1.1, 2);
    expect(zoomStep(1, -1)).toBeCloseTo(0.9, 2);
    expect(zoomStep(TAG_ZOOM.max, 1)).toBe(TAG_ZOOM.max);
    expect(zoomStep(TAG_ZOOM.min, -1)).toBe(TAG_ZOOM.min);
  });

  it('hands the page one number, as before', () => {
    expect(tagScaleOn(LAPTOP, 1)).toBe(tagHeight(LAPTOP) / 28);
    expect(tagScaleOn(LAPTOP, 1.2) * 28).toBe(tagHeightOn(LAPTOP, 1.2));
  });
});

describe('the corner she drags', () => {
  it('is a grip in the tag, which only shows itself when pointed at', () => {
    expect(page).toContain('ct-grip');
    expect(css).toContain('.ct-grip');
    expect(css).toMatch(/\.ct-tag:hover \.ct-grip[^}]*opacity/);
  });

  it('presses through the same door as a drag, saying it is the grip', () => {
    expect(bridge).toContain('press: (x, y, grip)');
    expect(page).toContain('bridge?.press(e.screenX, e.screenY, true)');
  });
});
