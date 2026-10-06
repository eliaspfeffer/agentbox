// Types for shared/codex-modes.mjs, for the window side.
//
// The three ids are `CodexModeId` in renderer/src/types.ts, which is where that
// union already lives; this file states the shape around them rather than a
// second copy of the list. renderer/src/codex-modes.ts is the screen's own
// narrowed view of the same table and reads these through it.
import type { CodexModeId } from '../renderer/src/types';

/**
 * THE PAIR A MODE REALLY IS. `sandbox` and `approvalPolicy` go straight into
 *  Codex's `thread/start`; `approvalsReviewer` is set on `auto` alone, which is
 *  the only row with asks left to answer. They are plain strings rather than
 *  unions on purpose: the authority for what Codex accepts is Codex's own
 *  schema, quoted in the .mjs, and a union here would be a third copy of it
 *  that nothing checks.
 */
export interface CodexMode {
  label: string;
  sandbox: string;
  approvalPolicy: string;
  approvalsReviewer?: string;
  what: string;
}

export declare const CODEX_MODE_ORDER: CodexModeId[];
export declare const CODEX_DEFAULT_MODE: CodexModeId;
export declare const CODEX_MODES: Record<CodexModeId, CodexMode>;
export declare const CODEX_MODE_COMMAND: Record<CodexModeId, string>;
export declare const CODEX_MODE_HINT: Record<CodexModeId, string>;
export declare const CODEX_MODE_STATUS: Record<CodexModeId, string>;

export declare function isCodexMode(word: unknown): boolean;
/** The pair, falling back to the default's pair when the word is not one of ours. */
export declare function codexPosture(mode: string | null | undefined): {
  sandbox: string;
  approvalPolicy: string;
  approvalsReviewer?: string;
};
export declare function codexModeWords(mode: string | null | undefined): string;
/**
 * The rows the menu draws for what has been typed. `null` is the way back to
 *  the project's own setting and is a row like the others.
 */
export declare function codexMenuRowsFor(
  query: string | null,
  set?: unknown,
): (CodexModeId | null)[];
export declare function nextCodexMode(mode: CodexModeId): CodexModeId;
/** The mode a typed `/word ` means, or null when it means nothing. */
export declare function exactCodexMode(word: string | null | undefined): CodexModeId | null;
