// NOBODY NEW CAN SIGN UP TO THE TEAM CLOUD.
//
// Found before launch (w-db6f5e331e, 2026-10-05). The team cloud's settings
// had `enable_signup = true` under [auth] and under [auth.email], and the live
// project read the same (disable_signup: false, email and Google both on). Its
// access rules keep everyone out of everyone else's team, but anyone holding
// the address and public key could make an account and a team of their own.
// The founder: "open sign up should be off for everyone, since the version
// shipping will not include a multiplayer mode for new users and everybody who
// needs it already has access to it because they're on my team."
//
// So the settings in the repository say no, for every way in. Accounts that
// already exist still sign in; that is a different switch.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const toml = fs.readFileSync(new URL('../cloud/supabase/config.toml', import.meta.url), 'utf8');

/** The value of `key` inside `[section]`, read off the file as written. */
function setting(section, key) {
  const start = toml.indexOf(`\n[${section}]\n`);
  if (start < 0) return undefined;
  const rest = toml.slice(start + section.length + 4);
  const body = rest.slice(0, rest.search(/\n\[/) < 0 ? undefined : rest.search(/\n\[/));
  const m = body.match(new RegExp(`^${key}\\s*=\\s*(\\S+)`, 'm'));
  return m ? m[1] : undefined;
}

describe('the team cloud takes no new accounts', () => {
  it('turns sign-up off for the whole project', () => {
    expect(setting('auth', 'enable_signup')).toBe('false');
  });
  it('and for email sign-up on its own', () => {
    expect(setting('auth.email', 'enable_signup')).toBe('false');
  });
  it('still lets nobody in anonymously', () => {
    expect(setting('auth', 'enable_anonymous_sign_ins')).toBe('false');
  });
});
