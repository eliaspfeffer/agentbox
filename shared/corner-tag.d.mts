// Types for shared/corner-tag.mjs, the corner tag's rules, which main (Node)
// and the tag's page (Vite) share one copy of. Only what the page calls is
// declared; the window placement is main's half.

export type HideChoice = { key: '5m' | '30m' | 'today'; label: string };
export const HIDE_CHOICES: HideChoice[];

export function tagSays(counts: { ready?: number; working?: number }): { kind: 'ready' | 'working'; text: string } | null;

export type ReadyLine = { id: string; title: string; says: string; since?: number; open?: string | null };
export function cardLines<T extends ReadyLine>(ready: T[], now: number, max?: number): {
  lines: (T & { waited: string })[];
  more: number;
};

/** The four corners that resize it, and the arrow each one draws. */
export const GRIPS: readonly ['tl', 'tr', 'bl', 'br'];
export type Grip = 'tl' | 'tr' | 'bl' | 'br';

/** The nine dots, in whole pixels, for a tag this tall. */
export function latticeCell(height: number): { dot: number; gap: number };

/** How much of the tag's size the list takes; it is read, not glanced at. */
export function cardScale(scale: number): number;
