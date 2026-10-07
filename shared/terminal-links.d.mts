export type TerminalLink = { url: string; range: { start: { x: number; y: number }; end: { x: number; y: number } } };
export function linksAtRow(at: (y: number) => { text: string; wrapped: boolean } | undefined, row: number): TerminalLink[];
