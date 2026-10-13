import { createContext, useContext, type ReactNode } from 'react';
import { ticketPieces, TICKET_HREF } from '../ticket-references';
import type { WorkItem } from '../types';
import { Mention } from './Mention';

export const TicketItems = createContext<WorkItem[]>([]);

export const TicketNavigation = createContext<{
  open: (id: string) => void;
  name: (id: string) => string | null;
} | null>(null);

// A thread a message names is a mention like any file or folder: its icon and
// its name, never its id (Mention.tsx).
export function TicketLink({ id, children }: { id: string; children: ReactNode }) {
  const navigation = useContext(TicketNavigation);
  if (!navigation) return <>{children}</>;
  const name = navigation.name(id);
  if (!name) return <Mention kind="thread" title="This thread is not available.">Unavailable thread</Mention>;
  return <Mention kind="thread" href={TICKET_HREF + id} title={name} label={`Open thread: ${name}`} onClick={e => {
    e.preventDefault(); e.stopPropagation(); navigation.open(id);
  }} onKeyDown={e => e.stopPropagation()}>{name}</Mention>;
}

export function TicketText({ text }: { text: string }) {
  return <>{ticketPieces(text).map((p, i) => p.id
    ? <TicketLink key={i} id={p.id}>{p.text}</TicketLink> : p.text)}</>;
}
