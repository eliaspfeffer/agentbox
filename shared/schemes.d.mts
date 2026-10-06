// Types for shared/schemes.mjs, for the window side.
//
// The lists are built from the app's past names at load, so their length is
// not a constant and nothing here pretends otherwise. `isScheme` takes the
// protocol as `URL` hands it over, with its colon on the end.
export declare const DOC_SCHEME: string;
export declare const IMG_SCHEME: string;
export declare const DOC_SCHEMES: readonly string[];
export declare const IMG_SCHEMES: readonly string[];
export declare const ALL_SCHEMES: readonly string[];
export declare function isScheme(schemes: readonly string[], protocol: string): boolean;
