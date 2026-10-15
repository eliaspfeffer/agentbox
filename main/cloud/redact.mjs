// PRINTS WHAT `claude setup-token` SAYS, EXCEPT THE TOKEN.
//
// scripts/cloud-signin.mjs shows the person the sign-in link and the prompt
// for the code as they arrive, and must never show the token Claude Code
// prints at the end: a terminal is recorded, piped and pasted. Text that is,
// or could be the start of, a token is held back until it is known, so a token
// split across two chunks is never written in part either.
const TOKEN = /sk-ant-oat\d*-[A-Za-z0-9_-]+/g;
// Down to a lone trailing "s": a chunk that ends on the token's first letter
// must not let the rest of it through in the next one.
const MAYBE_START = /s(?:k(?:-(?:a(?:n(?:t(?:-(?:o(?:a(?:t[A-Za-z0-9_-]*)?)?)?)?)?)?)?)?)?$/;
export const SHOWN_INSTEAD = '[saved, not shown]';

export function tokenHider(write) {
  let held = '';
  const out = (final) => {
    let text = held.replace(TOKEN, SHOWN_INSTEAD);
    let keep = '';
    if (!final) {
      const m = MAYBE_START.exec(text);
      if (m) { keep = text.slice(m.index); text = text.slice(0, m.index); }
    }
    if (text) write(text);
    held = keep;
  };
  return {
    push(chunk) { held += String(chunk); out(false); },
    end() { out(true); },
  };
}

export function tokenIn(text) {
  return (String(text).match(TOKEN) || [])[0] || null;
}
