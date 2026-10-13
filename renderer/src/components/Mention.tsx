import type { MouseEvent, KeyboardEvent, ReactNode } from 'react';
import type { MentionKind } from '../mentions';
import './mention.css';

// One outline icon per kind, drawn on the same 24-unit grid and stroke as the
// thread icon the tags already carried.
const PATHS: Record<MentionKind, ReactNode> = {
  thread: <><path d="M5 3v14a3 3 0 0 0 3 3h3M5 7h6" /><rect x="11" y="3" width="10" height="7" rx="2" /><rect x="11" y="16" width="10" height="6" rx="2" /></>,
  folder: <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.2h7.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />,
  page: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M3 9h18M6.5 6.6h.01M9.3 6.6h.01" /></>,
  doc: <><path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z" /><path d="M14 3v5h5M9 13h6M9 16.5h4" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="1.7" /><path d="m21 15.5-4.5-4.5L7 20.5" /></>,
  code: <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />,
  media: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m10 9.5 4.5 2.5-4.5 2.5z" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></>,
  file: <><path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z" /><path d="M14 3v5h5" /></>,
};

export function MentionIcon({ kind }: { kind: MentionKind }) {
  return <svg className="mention-icon" viewBox="0 0 24 24" aria-hidden="true" strokeLinecap="round" strokeLinejoin="round">{PATHS[kind]}</svg>;
}

// A thing a message names, drawn in the sentence it sits in: its icon, then its
// name, softly underlined. No box, so a paragraph naming five files still
// reads as a paragraph.
export function Mention({ kind, href, title, label, className, onClick, onKeyDown, children }: {
  kind: MentionKind;
  href?: string;
  title?: string;
  label?: string;
  className?: string;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLAnchorElement>) => void;
  children: ReactNode;
}) {
  const classes = `mention mention-${kind}${className ? ` ${className}` : ''}`;
  if (!href && !onClick) {
    return <span className={`${classes} mention-unavailable`} title={title}><MentionIcon kind={kind} /><span className="mention-name">{children}</span></span>;
  }
  return (
    <a className={classes} href={href} title={title} aria-label={label} rel="noreferrer" onClick={onClick} onKeyDown={onKeyDown}>
      <MentionIcon kind={kind} /><span className="mention-name">{children}</span>
    </a>
  );
}
