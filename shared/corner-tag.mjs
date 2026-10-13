// THE CORNER TAG (w-dafae58a23): the rules, and nothing that touches a window.
//
// You lose track of agents once you are in another app, and the ones waiting on
// you sit idle. The answer that survived eight rounds of drawings is a small tag
// in a corner of the screen that says "2 ready for you" when an agent has
// something for you and "20 working" when none does. Twenty agents running is
// ordinary, so working agents are a count and never a list: only what is ready
// for you is worth a line.
//
// It must never become a nag. So it hides for a while and comes back on its
// own, there is no one-click way to make it gone for good (that becomes a thing
// you closed once and forgot existed), it is turned off only in Settings, and
// it steps aside while you are in the app itself.
//
// main/corner-tag.mjs owns the window and renderer/src/corner-tag owns the
// page; both decide through this file so the tests pin behaviour, not wiring.

/** Space between the tag and the edge of the screen when it rests in a corner. */
export const MARGIN = 18;

/** The ways to hide it. All of them come back; none of them is permanent. */
export const HIDE_CHOICES = [
  { key: '5m', label: '5 min' },
  { key: '30m', label: '30 min' },
  { key: 'today', label: 'Today' },
];

/** When a hide chosen at `now` runs out. 0 means "not hidden". */
export function hiddenUntil(choice, now) {
  if (choice === '5m') return now + 5 * 60_000;
  if (choice === '30m') return now + 30 * 60_000;
  if (choice === 'today') {
    const d = new Date(now);
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }
  return 0;
}

/** The words on the tag, or null when there is nothing to say. Short, because
 *  "22 ready for you" in the corner of a full screen was more than it needed;
 *  "waiting" was picked over "ready" and "need you". */
export function tagSays({ ready = 0, working = 0 } = {}) {
  if (ready > 0) return { kind: 'ready', text: `${ready} waiting` };
  if (working > 0) return { kind: 'working', text: `${working} working` };
  return null;
}

/**
 * HOW BIG THE TAG DRAWS, from the width of the screen it rests on (2026-10-13).
 * One number: the page multiplies everything in the tag and its list by it, so
 * the words, the chevron, the nine-dot mark and the padding grow together.
 *
 * She reads the tray on a 32" screen and on a laptop, and 28px was too small on
 * both, worst on the big one: "a little bigger... esp on my 32 inch screen but
 * also maybe on smaller screens too". So it is a ladder off the screen's own
 * width in points, not one size for everything and not a setting to find.
 *
 * The first ladder climbed too gently — "34 px on a 32-inch screen is still far
 * too small so you need to scale it more with screen size" — so the steps are
 * now 31px on a laptop, 36px, 42px, and 48px on a screen as wide as hers
 * (3413 points). 1 would be the old 28px tag, which nothing asks for any more.
 *
 * THE STEPS ARE WHOLE PIXELS, and the scale is worked back from them. A tag
 * 30.8px tall puts its bottom border on half a device pixel, where it goes
 * soft and its bottom corners break up; she saw exactly that and called it
 * messed up (2026-10-13). Whole heights keep every edge on a real pixel.
 */
export const TAG_BASE = 28;
export const TAG_HEIGHTS = [
  { from: 0, px: 31 },
  { from: 1900, px: 36 },
  { from: 2400, px: 42 },
  { from: 3000, px: 48 },
];

/** How tall the tag draws on a screen this many points wide, in whole pixels. */
export function tagHeight(width) {
  const w = Number.isFinite(width) ? width : 0;
  let px = TAG_HEIGHTS[0].px;
  for (const step of TAG_HEIGHTS) if (w >= step.from) px = step.px;
  return px;
}

/** The one number the page multiplies everything by. */
export function tagScale(width) {
  return tagHeight(width) / TAG_BASE;
}

/**
 * HER OWN SIZE, KEPT AS A MULTIPLE OF THE AUTOMATIC ONE (2026-10-13). She
 * asked to be able to resize the tray, by dragging a corner of it.
 *
 * What she sets is not a height in pixels but how much bigger or smaller than
 * the automatic size she wants it, because the automatic size is the thing
 * that knows about screens: a tag she grows by a fifth on her laptop is a
 * fifth bigger on the 32" too, rather than shrinking back to a laptop's
 * number the moment she plugs the big screen in.
 */
export const TAG_ZOOM = { min: 0.75, max: 2, step: 0.1 };
/** However far she drags, the tag stays a tag. */
export const TAG_LIMITS = { min: 24, max: 80 };

/** Her multiple, kept sane; nothing stored means the automatic size. */
export function tagZoom(zoom) {
  const z = Number.isFinite(zoom) ? zoom : 1;
  return clamp(Math.round(z * 100) / 100, TAG_ZOOM.min, TAG_ZOOM.max);
}

/** How tall the tag draws on this screen, with her multiple applied. */
export function tagHeightOn(width, zoom) {
  return clamp(Math.round(tagHeight(width) * tagZoom(zoom)), TAG_LIMITS.min, TAG_LIMITS.max);
}

/** The scale the page is handed: the automatic size times her multiple. */
export function tagScaleOn(width, zoom) {
  return tagHeightOn(width, zoom) / TAG_BASE;
}

/** The multiple a tag dragged to this height means, on this screen. */
export function zoomFor(height, width) {
  const h = clamp(Number.isFinite(height) ? height : 0, TAG_LIMITS.min, TAG_LIMITS.max);
  return tagZoom(h / tagHeight(width));
}

/** One notch bigger or smaller, for the tag's own menu. */
export function zoomStep(zoom, by) {
  return tagZoom(tagZoom(zoom) + by * TAG_ZOOM.step);
}

/** Every corner resizes it, because one ledge in one corner was not findable. */
export const GRIPS = ['tl', 'tr', 'bl', 'br'];

/**
 * How tall a drag on this corner means. The corner follows the cursor and the
 * opposite one stays where it is, the way a window resizes. The tag is four
 * times wider than it is tall, so sideways travel counts for about a third:
 * the diagonal still feels like a diagonal without the width running away.
 */
export function heightFromDrag(corner, fromHeight, dx, dy) {
  const down = corner.startsWith('b') ? dy : -dy;
  const out = corner.endsWith('r') ? dx : -dx;
  return Math.round(fromHeight + down + out * 0.35);
}

/**
 * HOW MUCH OF THE TAG'S SIZE THE LIST TAKES (2026-10-13). The tag is a glance
 * from across a desk and wants to be big on a big screen; the list is read a
 * line at a time and does not. At the tag's full scale on her 32" the rows came
 * out "really, really big... way bigger than anything else I'm used to seeing
 * on the screen", so the list follows the tag less than a third of the way and
 * stops at a quarter bigger than the app's own text.
 */
export function cardScale(scale) {
  const s = Number.isFinite(scale) ? scale : 1;
  return clamp(Math.round((1 + (s - 1) * 0.3) * 1000) / 1000, 1, 1.25);
}

/**
 * THE NINE DOTS ARE WHOLE PIXELS, not a share of the tag (2026-10-13). They
 * used to be 2.7 and 0.95 points multiplied by the scale, which at 31px came
 * out as 2.99 and 1.05: every row and column rounded somewhere different, so
 * the gaps were uneven and a dot that small turned into an aliased square.
 * She caught it in the running app: "the dots aren't even here".
 *
 * So each height gets a dot and a gap in whole pixels. Every track is then
 * identical at any pixel ratio, and a dot has enough pixels to be round.
 */
export const LATTICE_CELLS = {
  31: { dot: 3, gap: 1 },
  36: { dot: 4, gap: 1 },
  42: { dot: 4, gap: 2 },
  48: { dot: 5, gap: 2 },
};

/** The dot and gap for a tag this tall. */
export function latticeCell(height) {
  const h = Number.isFinite(height) ? Math.round(height) : TAG_HEIGHTS[0].px;
  if (LATTICE_CELLS[h]) return LATTICE_CELLS[h];
  // A height nobody planned for still draws something even: about a tenth of
  // the tag for a dot, a third of that for the gap, both whole.
  const dot = Math.max(2, Math.round(h / 10));
  return { dot, gap: Math.max(1, Math.round(dot / 3)) };
}

/**
 * What the tag counts and lists: everything waiting on you, newest first.
 * The first version put threads from weeks ago at the top of the list; the
 * second cut everything older than a day, and then a Needs you of 58 read
 * "3 waiting" in the corner (w-0961e5523b). So the count is the whole of it,
 * the same number the app shows, and only the order keeps the old ones out
 * of the way: the list shows the newest three and folds the rest into "and N
 * more". Something with no moment it became ready (an agent stopped on a
 * yes, right now) sorts as now.
 */
export function readyNow(ready, now) {
  return [...(ready ?? [])]
    .sort((a, b) => (Number.isFinite(b.since) ? b.since : now) - (Number.isFinite(a.since) ? a.since : now));
}

/** Whether the tag is on screen right now. */
export function tagShows({ on, hiddenUntil: until = 0, now, inApp, ready = 0, working = 0 }) {
  if (on === false) return false;
  if (until > now) return false;
  // In the app itself the inbox already says all of this, bigger.
  if (inApp) return false;
  return !!tagSays({ ready, working });
}

/** How long something has waited, in units. */
export function waitedFor(since, now) {
  if (!Number.isFinite(since)) return '';
  const min = Math.floor((now - since) / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h`;
}

/** The lines under the tag: the newest first, three at most. */
export function cardLines(ready, now, max = 3) {
  const sorted = readyNow(ready, now, Infinity);
  const lines = sorted.slice(0, max).map((r) => ({ ...r, waited: waitedFor(r.since, now) }));
  return { lines, more: Math.max(0, sorted.length - lines.length) };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function areaFor(point, areas) {
  return areas.find((a) => point.x >= a.x && point.x < a.x + a.width && point.y >= a.y && point.y < a.y + a.height) ?? areas[0];
}

/**
 * Where the tag goes when it appears: back where you last dragged it, pulled
 * onto a screen if that screen is gone, or the bottom-right corner the first
 * time. `spot` is the tag's top-left, `areas` are the screens' work areas.
 */
export function restingSpot(spot, size, areas) {
  if (!spot) {
    const a = areas[0];
    return { x: a.x + a.width - MARGIN - size.width, y: a.y + a.height - MARGIN - size.height };
  }
  const a = areaFor({ x: spot.x + size.width / 2, y: spot.y + size.height / 2 }, areas) ?? areas[0];
  return {
    x: clamp(spot.x, a.x, a.x + a.width - size.width),
    y: clamp(spot.y, a.y, a.y + a.height - size.height),
  };
}

function inRightHalf(r, a) { return r.x + r.width / 2 > a.x + a.width / 2; }
function inLowerHalf(r, a) { return r.y + r.height / 2 > a.y + a.height / 2; }

/**
 * The tag's new bounds when its words change length. The edge nearest its
 * corner stays put, so "2 ready for you" turning into "20 working" does not
 * walk the tag away from the edge you parked it against.
 */
/**
 * WHERE THE TAG IS PARKED, SAID IN A WAY THAT SURVIVES A CHANGE OF SCREEN
 * (2026-10-13). Its spot used to be remembered as a point on the whole desktop,
 * so plugging in a monitor, or unplugging one, moved every screen's
 * coordinates underneath it and the tag "jumps around quite a bit". A corner
 * and a gap mean the same thing on any screen: bottom right, 18 points in.
 */
export function cornerPlace(bounds, area) {
  const right = inRightHalf(bounds, area);
  const lower = inLowerHalf(bounds, area);
  return {
    corner: `${lower ? 'b' : 't'}${right ? 'r' : 'l'}`,
    dx: Math.round(right ? area.x + area.width - (bounds.x + bounds.width) : bounds.x - area.x),
    dy: Math.round(lower ? area.y + area.height - (bounds.y + bounds.height) : bounds.y - area.y),
  };
}

/** That same place on this screen, wholly on it however small it is. */
export function spotFor(place, size, area) {
  if (!place?.corner) return null;
  const right = place.corner.endsWith('r');
  const lower = place.corner.startsWith('b');
  const dx = clamp(Number.isFinite(place.dx) ? place.dx : MARGIN, 0, Math.max(0, area.width - size.width));
  const dy = clamp(Number.isFinite(place.dy) ? place.dy : MARGIN, 0, Math.max(0, area.height - size.height));
  return {
    x: right ? area.x + area.width - size.width - dx : area.x + dx,
    y: lower ? area.y + area.height - size.height - dy : area.y + dy,
  };
}

export function keepCorner(bounds, size, area) {
  const x = inRightHalf(bounds, area) ? bounds.x + bounds.width - size.width : bounds.x;
  const y = inLowerHalf(bounds, area) ? bounds.y + bounds.height - size.height : bounds.y;
  return { x, y, width: size.width, height: size.height };
}

/**
 * Where the list opens when you point at the tag: toward the middle of the
 * screen, so it never runs off an edge, lined up with the tag's outer edge.
 */
export function cardPlacement(tag, card, area, gap = 8) {
  let above = inLowerHalf(tag, area);
  const alignRight = inRightHalf(tag, area);
  const x = clamp(alignRight ? tag.x + tag.width - card.width : tag.x, area.x, area.x + area.width - card.width);
  const up = tag.y - gap - card.height;
  const down = tag.y + tag.height + gap;
  // A tall list near a short screen's middle may not fit the side it prefers.
  if (above && up < area.y) above = false;
  else if (!above && down + card.height > area.y + area.height) above = true;
  const y = clamp(above ? up : down, area.y, area.y + area.height - card.height);
  return { above, alignRight, card: { x, y, width: card.width, height: card.height } };
}
