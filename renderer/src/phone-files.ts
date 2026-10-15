// PICTURES AND DESIGN PAGES ON A PHONE.
//
// The desktop draws them from two addresses only its own window can open
// (main/img-scheme.mjs, main/doc-scheme.mjs). A phone cannot open either, so
// they came up blank on a real iPhone (2026-10-11). The phone's server hands
// the same files out under /f/<file key>/ (main/serve.mjs), and this points
// every such address the screen draws at it, in one place rather than in each
// of the components that draw a picture, a page, a sound or a film.
import { DOC_SCHEMES, IMG_SCHEMES } from '../../shared/schemes.mjs';

const KINDS: [readonly string[], 'doc' | 'img'][] = [[DOC_SCHEMES, 'doc'], [IMG_SCHEMES, 'img']];

/** The phone's address for one of the desktop's, or the address unchanged. */
export function phoneFileUrl(url: string, key: string): string {
  if (!url) return url;
  for (const [schemes, kind] of KINDS) {
    for (const scheme of schemes) {
      const prefix = `${scheme}://file/`;
      if (url.startsWith(prefix)) return `/f/${key}/${kind}/${url.slice(prefix.length)}`;
    }
  }
  return url;
}

const ATTRS = ['src', 'poster'];

/* -------------------------------------------- a picture while it loads */

// THROUGH THE RELAY A PICTURE ARRIVES A PIECE AT A TIME, so it drew from the
// top down and grew from nothing, pushing the words under it ("as images load
// in mobile they look rather weird. Best to have nice skeleton loaders",
// 2026-10-12). Each picture is marked loading, ready or failed, and phone.css
// draws a loading one as a shimmering box of a picture's shape.
const STATE = 'data-phone-img';
type PictureLike = Pick<HTMLImageElement, 'complete' | 'naturalWidth' | 'setAttribute' | 'getAttribute' | 'addEventListener'> & { naturalHeight?: number; style?: { aspectRatio?: string } };
const watched = new WeakSet<object>();

// THE SHAPE EACH PICTURE HAD, by address, for as long as the page is open. A
// picture is never served from memory (main/serve.mjs), so one drawn again
// loads again, and its 4:3 box was a third the height of a phone screenshot:
// everything under it jumped down and back each time (2026-10-13,
// tests/a-thread-on-a-phone-holds-still-while-something-above-it-changes).
const shapes = new Map<string, string>();
export const shapeOf = (src: string) => shapes.get(src) ?? null;

export function watchPicture(img: PictureLike) {
  const src = img.getAttribute('src') ?? '';
  const loading = !img.complete;
  img.setAttribute(STATE, img.complete ? (img.naturalWidth > 0 ? 'ready' : 'failed') : 'loading');
  // While it loads, the box is the shape it had last time, if it has been seen.
  const shape = (value: string) => { if (img.style) img.style.aspectRatio = value; };
  shape(loading ? shapes.get(src) ?? '' : '');
  if (watched.has(img)) return;
  watched.add(img);
  img.addEventListener('load', () => {
    if (img.naturalWidth > 0 && (img.naturalHeight ?? 0) > 0) shapes.set(img.getAttribute('src') ?? '', `${img.naturalWidth} / ${img.naturalHeight}`);
    shape('');
    img.setAttribute(STATE, 'ready');
  });
  img.addEventListener('error', () => { shape(''); img.setAttribute(STATE, 'failed'); });
}

/** Every picture drawn from now on, and again whenever its address changes. */
export function installPictureWatch(root: Node = document) {
  const each = (node: Node) => {
    if (!(node instanceof Element)) return;
    if (node instanceof HTMLImageElement) watchPicture(node);
    for (const img of node.querySelectorAll('img')) watchPicture(img);
  };
  each(root instanceof Document ? root.documentElement : root);
  new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type === 'attributes') { if (change.target instanceof HTMLImageElement) watchPicture(change.target); }
      else for (const node of change.addedNodes) each(node);
    }
  }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
}

/** Rewrite every address already drawn and every one drawn from now on. */
export function installPhoneFiles(key: string, root: Node = document) {
  const fix = (el: Element) => {
    for (const attr of ATTRS) {
      const was = el.getAttribute(attr);
      if (!was) continue;
      const now = phoneFileUrl(was, key);
      if (now !== was) el.setAttribute(attr, now);
    }
  };
  const sweep = (node: Node) => {
    if (!(node instanceof Element)) return;
    fix(node);
    for (const el of node.querySelectorAll(ATTRS.map((a) => `[${a}*="://file/"]`).join(','))) fix(el);
  };
  sweep(root instanceof Document ? root.documentElement : root);
  const watch = new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type === 'attributes') fix(change.target as Element);
      else for (const node of change.addedNodes) sweep(node);
    }
  });
  watch.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ATTRS });
  return () => watch.disconnect();
}
