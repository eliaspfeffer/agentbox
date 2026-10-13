// Switching to an account whose organization has Claude Code turned off left
// the usage box at "No usage reading yet" and, after Refresh, "Could not
// refresh usage. Try again." Trying again can never work. Measured 2026-10-11
// with Claude Code 2.1.293: `claude -p /usage` on that login printed only the
// "What's contributing" breakdown and no limits, and any real prompt on it
// answered "Your organization has disabled Claude subscription access for
// Claude Code". The app already had that account filed as org-blocked; the
// usage box just never asked. Now it says the account's own sentence.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ClaudeUsageSection } from '../renderer/src/components/Settings';

const now = 1_000_000;
const blocked = 'Signed in, but its organization has turned Claude Code off. Only an admin of that workspace can turn it back on.';
const reading = { engine: 'claude', profile: 'default', at: now - 60_000, limits: [{ span: 'week', qualifier: 'all models', name: 'This week', percent: 40 }] };
const draw = (props = {}) => renderToStaticMarkup(React.createElement(ClaudeUsageSection, { reading: null, profile: 'default', email: 'one@example.test', now, ...props }));

it('says why there is no reading when the account in use cannot run', () => {
  const html = draw({ trouble: blocked });
  expect(html).toContain('its organization has turned Claude Code off');
  expect(html).not.toContain('No usage reading yet');
  expect(html).toContain('Refresh');
});

it('still says no reading yet when nothing is wrong with the account', () => {
  const html = draw({ trouble: null });
  expect(html).toContain('No usage reading yet');
  expect(html).not.toContain('organization');
});

it('keeps the meters of a reading it has, with the trouble beside them', () => {
  const html = draw({ reading, trouble: 'At its limit. It rejoins on its own when the limit resets.' });
  expect(html).toContain('40% used');
  expect(html).toContain('At its limit');
  expect(html).not.toContain('No usage reading yet');
});

it('never shows another account’s trouble once the reading belongs to this one', () => {
  const html = draw({ reading, trouble: null });
  expect(html).toContain('40% used');
  expect(html).not.toContain('organization');
});
