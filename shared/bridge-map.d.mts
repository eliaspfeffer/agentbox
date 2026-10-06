// Types for shared/bridge-map.mjs, for the window side.
//
// EVERY ONE OF THESE IS A PHONE BOOK AND IS TYPED AS ONE. Naming the hundred
// and thirty keys over again here would be a second copy of the list the file
// exists to be the only copy of, and the first one to fall behind it. What the
// screen needs from a type is that a channel is a string and a wrap is a list
// of argument names; which names exist is checked against preload.cjs at test
// time instead (tests/both-front-doors-offer-the-same-bridge.test.mjs).
export declare const REQUEST_CHANNELS: Readonly<Record<string, string>>;
export declare const PUSH_CHANNELS: Readonly<Record<string, string>>;
export declare const WRAPPED_ARGS: Readonly<Record<string, string[]>>;
export declare const DESKTOP_ONLY: readonly string[];
