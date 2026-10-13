// WHAT A PHONE HOLDS BACK, AND WHEN IT LETS GO (2026-10-13).
//
// The app holds every send for three seconds so Z can take it back
// (UNDO_GRACE_MS in App.tsx). On a phone, replies sent from it went missing:
// a phone has no Z, and iOS freezes a page put away mid-hold and may throw it
// away, timer and all. The test that measured it is
// tests/a-reply-sent-from-a-phone-is-written-before-the-app-is-put-away.

/** Is a reply held for the undo window? Not on a phone: it is written at once. */
export const holdsReplies = (phone: boolean) => !phone;

/**
 * Write whatever is held the moment the page is hidden. iOS fires this on a
 * swipe home or an app switch, where `pagehide` does not come. Returns the
 * way to stop listening.
 */
export function writeHeldWhenHidden(doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>, write: () => unknown) {
  const onChange = () => { if (doc.visibilityState === 'hidden') void write(); };
  doc.addEventListener('visibilitychange', onChange);
  return () => doc.removeEventListener('visibilitychange', onChange);
}
