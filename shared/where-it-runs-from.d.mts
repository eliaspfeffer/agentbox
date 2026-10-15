// Types for shared/where-it-runs-from.mjs, which is plain ESM so that main
// (Node) and the screen (Vite) share one copy of the rule about whether this
// copy of the app can update itself from where it is, and one copy of the
// words that say so. The screen asks for the words and `sayWhere`; the places
// and the move are main's.

/** The place a copy of the app is in, as far as updating itself is concerned. */
export type AppPlace =
  | 'disk-image' | 'translocated' | 'applications' | 'elsewhere' | 'source' | 'not-mac';

export const PLACE: {
  diskImage: 'disk-image';
  translocated: 'translocated';
  applications: 'applications';
  elsewhere: 'elsewhere';
  source: 'source';
  notMac: 'not-mac';
};

export const MOVE_SAY: {
  cannotUpdateHere: string;
  button: string;
  title: string;
  where: Record<string, string>;
  shortWhere: Record<string, string>;
  fix: string;
  retry: string;
};

/** The sentence for a place, or null where there is nothing to say. */
export function sayWhere(place: string | null | undefined, how?: { short?: boolean }): string | null;

export function placeOfApp(facts?: {
  platform?: string;
  packaged?: boolean;
  exePath?: string | null;
  inApplications?: boolean;
}): { place: AppPlace; canUpdate: boolean; offerMove: boolean };

export function createPlace(host: { app: unknown; log?: unknown }): {
  state(): { place: AppPlace; canUpdate: boolean; offerMove: boolean };
  move(): { moved: boolean; error: string | null };
};
