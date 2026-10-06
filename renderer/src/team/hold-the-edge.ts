// HOLDING THE THREAD PANEL'S EDGE, and letting go of it (w-45cbac227a).
//
// The drag used to end only on a release the edge itself heard. An opened task
// has a strip along its top that moves the window (`-webkit-app-region: drag`),
// right above the panel, and macOS keeps a release that lands there for itself.
// The page never heard it, so the window kept the resize cursor and the edge
// kept following a pointer with no button held. Now any of these lets go: a
// release anywhere in the window, a cancel, the window losing focus, the
// caller (the panel closing), or the first move with no button held, which is
// the release that went missing. tests/the-thread-edge-lets-go-when-you-let-go.

/** The class on <body> that puts the resize cursor on the whole window. */
export const DRAGGING = 'chat-thread-dragging';

type Grip = EventTarget & {
  setPointerCapture?: (id: number) => void;
  releasePointerCapture?: (id: number) => void;
  hasPointerCapture?: (id: number) => boolean;
};
type Pointer = Event & { pointerId?: number; buttons?: number; clientX?: number };

/** Starts the hold; returns the way to let go, which is safe to call twice. */
export function holdTheEdge({ grip, win, body, pointerId, onMove }: {
  grip: Grip;
  win: EventTarget;
  body: { classList: { add: (c: string) => void; remove: (c: string) => void } };
  pointerId: number;
  /** Where the pointer is across the window, while the button is held. */
  onMove: (clientX: number) => void;
}): () => void {
  let held = true;
  const ours = (e: Pointer) => e.pointerId == null || e.pointerId === pointerId;
  const move = (e: Pointer) => {
    if (!ours(e)) return;
    if (!e.buttons) { end(); return; }
    onMove(e.clientX ?? 0);
  };
  const up = (e: Pointer) => { if (ours(e)) end(); };
  function end() {
    if (!held) return;
    held = false;
    win.removeEventListener('pointermove', move as EventListener);
    win.removeEventListener('pointerup', up as EventListener);
    win.removeEventListener('pointercancel', up as EventListener);
    win.removeEventListener('blur', end);
    body.classList.remove(DRAGGING);
    try { if (grip.hasPointerCapture?.(pointerId)) grip.releasePointerCapture?.(pointerId); } catch { /* already gone */ }
  }
  body.classList.add(DRAGGING);
  try { grip.setPointerCapture?.(pointerId); } catch { /* a pointer the page no longer has */ }
  // AT THE WINDOW, so a release still counts when the capture was lost.
  win.addEventListener('pointermove', move as EventListener);
  win.addEventListener('pointerup', up as EventListener);
  win.addEventListener('pointercancel', up as EventListener);
  win.addEventListener('blur', end);
  return end;
}
