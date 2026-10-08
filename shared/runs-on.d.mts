export interface RunsOn {
  /** 'claude' or 'codex', or null on a Mac where nothing is signed in. */
  engine?: string | null;
  /**
   * The plan in words, as the tool itself reports it: 'Max 20x', 'Pro'. Null
   *  where the file could not be read, and then only the name is drawn. */
  plan?: string | null;
}

/** The word for the plan behind an engine, or null for one we cannot name. */
export declare function runsOnName(engine?: string | null): string | null;

/** The glance line: 'Claude · Max 20x', or 'Claude' with no plan. Null for null. */
export declare function runsOnLine(facts?: RunsOn): string | null;

/** The whole sentence, for a hover and for a screen reader. Null for null. */
export declare function runsOnTitle(facts?: RunsOn): string | null;

/** The one line the walk says on a Mac that was already set up. Null for null. */
export declare function foundOnThisMac(facts?: RunsOn): string | null;
