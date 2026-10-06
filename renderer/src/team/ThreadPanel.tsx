// A THREAD IN A CHAT WITH TEAMMATES, IN A PANEL BESIDE THE CHAT (w-920461cbe6).
//
// The pick, in the person's words: "Yeah, definitely agree with the panel
// beside the chat. I think in Slack you can resize this so we might want to
// allow resizing." Drawn first as designs/w-920461cbe6/A-panel-beside-the-chat.png:
// a "Thread" head with a close, the message the thread hangs off, a quiet
// "3 replies" rule, the replies, and a reply box of its own at the foot, on the
// same line as the chat's.
//
// THE MESSAGES ARE DRAWN HERE, NOT BY ../components/Thread.tsx. That component
// owns the chat's scroll (it holds the page at the newest message), and a second
// copy of it in this panel would fight the first for the same box. These are the
// same `.chat-msg` blocks in the same materials, so they read as one chat.
//
// The rules (which replies, the line, the width) are ./chat-threads.ts.
import { useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Face, TeamContext } from './people';
import { ChatFold } from './ChatFold';
import { MessageActions, Reactions } from './ChatActions';
import { clock } from '../thread-history';
import { THREAD_WIDTH, threadLine } from './chat-threads';
import { holdTheEdge } from './hold-the-edge';
import type { AgentTurn } from '../types';
import './chat.css';

// Before the frame is drawn in the app; a plain effect where there is no window.
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** How far one arrow press moves the edge, for a keyboard. */
const NUDGE = 24;

export function ThreadPanel({ parent, replies, md, width, reactions, onReact, onSend, onClose, onResize }: {
  /** The message the thread hangs off. */
  parent: AgentTurn;
  /** Its replies, oldest first. */
  replies: AgentTurn[];
  md: (text: string) => ReactNode;
  /** The width to draw at, already held inside its limits by the caller. */
  width: number;
  reactions?: Record<string, Record<string, string[]>>;
  onReact?: (uid: string, emoji: string, off: boolean) => void;
  /** Send a reply in this thread. */
  onSend: (text: string) => unknown;
  onClose: () => void;
  /** The width the left edge was dragged to; the caller holds it in its limits. */
  onResize: (width: number) => void;
}) {
  const team = useContext(TeamContext);
  const me = team?.me ?? null;
  const panel = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState('');
  // WHAT YOU SENT AND THE LEDGER DOES NOT HAVE YET, drawn at once and dropped
  // when your own committed copy arrives, so a reply never appears to vanish
  // between Enter and the next read of the row.
  const [sending, setSending] = useState<{ at: number; text: string }[]>([]);
  useEffect(() => {
    setSending((was) => was.filter((s) => !replies.some((r) => (r.by ?? me) === me && r.at >= s.at - 5_000 && (r.text ?? '').trim() === s.text.trim())));
  }, [replies, me]);
  // A new thread starts empty, with the box ready.
  useEffect(() => { setDraft(''); setSending([]); box.current?.focus(); }, [parent.uid]);

  // THE PANE MAKES ROOM FOR AS LONG AS THE PANEL IS DRAWN, and no longer. Set
  // from here rather than by whoever opened it, so a thread whose message has
  // left the screen (and so draws nothing) can never leave the chat narrowed
  // beside an empty strip. chat.css reads both.
  useBeforePaint(() => {
    const pane = panel.current?.parentElement;
    if (!pane) return undefined;
    pane.dataset.thread = 'open';
    return () => { delete pane.dataset.thread; };
  }, []);
  useBeforePaint(() => {
    panel.current?.parentElement?.style.setProperty('--chat-thread-w', `${width}px`);
  }, [width]);

  // AT THE NEWEST REPLY, on opening and whenever one arrives.
  const shown = replies.length + sending.length;
  useBeforePaint(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [parent.uid, shown]);

  // The box grows with what is typed, to a point, then scrolls.
  useBeforePaint(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setSending((was) => [...was, { at: Date.now(), text }]);
    setDraft('');
    onSend(text);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
    // Escape leaves the thread, and goes no further: the page behind it would
    // otherwise take the same key as "leave this conversation".
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
  };

  // THE LEFT EDGE DRAGS, like Slack's. The panel's right edge is the pane's, so
  // the width is the distance from the pointer to it. Letting go is
  // ./hold-the-edge.ts, which also lets go if the panel closes mid-drag.
  const letGo = useRef<(() => void) | null>(null);
  useEffect(() => () => letGo.current?.(), []);
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    const right = panel.current?.getBoundingClientRect().right;
    if (right == null) return;
    e.preventDefault();
    letGo.current?.();
    letGo.current = holdTheEdge({
      grip: e.currentTarget, win: window, body: document.body, pointerId: e.pointerId,
      onMove: (x) => onResize(right - x),
    });
  };
  const nudge = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); onResize(width + NUDGE); }
    if (e.key === 'ArrowRight') { e.preventDefault(); onResize(width - NUDGE); }
  };

  const said = (e: AgentTurn, pending = false) => {
    const by = e.by ?? me;
    const mine = !!me && by === me;
    const person = by ? team?.byId.get(by) ?? null : null;
    return (
      <div key={`${e.uid ?? 'p'}-${e.at}`} className="thread-block is-msg">
        <div className={`msg chat-msg${pending ? ' sending' : ''}`}>
          <div className="chat-gutter"><Face person={person} me={mine} size="lg" /></div>
          <div className="msg-head">
            <span className="msg-who">{mine ? 'You' : person?.name ?? 'A teammate'}</span>
            <span className="msg-when">{clock(e.at)}</span>
          </div>
          <ChatFold>{md(e.text ?? '')}</ChatFold>
          {e.uid && (
            <Reactions on={reactions?.[e.uid]} me={me} onReact={(emoji, off) => onReact?.(e.uid!, emoji, off)} />
          )}
          {e.uid && onReact && (
            <MessageActions onReact={(emoji) => onReact(e.uid!, emoji, (reactions?.[e.uid!]?.[emoji] ?? []).includes(me ?? ''))} />
          )}
        </div>
      </div>
    );
  };

  return (
    <aside className="chat-thread-panel" ref={panel} style={{ width }} aria-label="Thread">
      <div
        className="chat-thread-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize thread"
        aria-valuemin={THREAD_WIDTH.min}
        aria-valuemax={THREAD_WIDTH.max}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={drag}
        onKeyDown={nudge}
        onDoubleClick={() => onResize(THREAD_WIDTH.start)}
        title="Drag to resize. Double-click to reset."
      />
      <div className="chat-thread-head">
        <span className="chat-thread-title">Thread</span>
        <button type="button" className="chat-thread-close" aria-label="Close thread" title="Close thread" onClick={onClose}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square" aria-hidden="true">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
          </svg>
        </button>
      </div>
      <div className="chat-thread-body" ref={body}>
        {said(parent)}
        {(replies.length > 0 || sending.length > 0) && (
          <div className="chat-day chat-thread-count">{threadLine([...replies, ...sending.map((s) => ({ at: s.at, who: 'you' as const, text: s.text }))]).count}</div>
        )}
        {replies.map((r) => said(r))}
        {sending.map((s) => said({ at: s.at, who: 'you', text: s.text }, true))}
      </div>
      <div className="chat-thread-foot">
        <div className="chat-thread-box">
          <textarea
            ref={box}
            rows={1}
            value={draft}
            placeholder="Reply in thread…"
            aria-label="Reply in thread"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
          />
          <button type="button" className="chat-thread-send" disabled={!draft.trim()} onClick={send}>Send</button>
        </div>
      </div>
    </aside>
  );
}

/**
 * THE LINE UNDER A MESSAGE WITH REPLIES, which opens its thread. `fresh` is how
 * many replies came after your own newest word in a thread you are in
 * (w-920461cbe6): the line then says "2 new replies" and stands out, so a thread
 * waiting on you is not one more quiet line in a busy chat.
 */
export function ThreadLine({ replies, open, onOpen, fresh = 0 }: { replies: AgentTurn[]; open: boolean; onOpen: () => void; fresh?: number }) {
  const team = useContext(TeamContext);
  const line = threadLine(replies);
  return (
    <button type="button" className={`chat-thread-line${fresh ? ' fresh' : ''}${open ? ' open' : ''}`} onClick={onOpen} aria-expanded={open}>
      <span className="chat-thread-faces" aria-hidden="true">
        {line.faces.map((id) => <Face key={id} person={team?.byId.get(id) ?? null} me={id === team?.me} />)}
      </span>
      <span className="chat-thread-n">{fresh ? `${fresh} new ${fresh === 1 ? 'reply' : 'replies'}` : line.count}</span>
      <span className="chat-thread-last">{line.last}</span>
    </button>
  );
}
