// REPEAT IT TAKES A RULE IN WORDS, NOT ONLY THREE PRESETS.
//
// Reported 2026-10-07 with a screenshot of the composer's Send later > Repeat
// it page: three fixed rows (every morning at 8, weekdays at 9, this weekday
// at 9) and nothing else, while the page before it already takes a time in
// words. A task that opened "Every day at 5 PM" could not be set to repeat at
// 5 PM from this menu at all. So the page grew the same box, read by the same
// `parseRepeat` the rest of the app reads rules with.
//
// The box is the whole phrase, never prose, so "every day 5pm" without the
// "at" is a time, where at the start of a message it would be the task.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ruleFromWords } from '../renderer/src/threads/composer-rules.ts';

describe('a rule typed into Repeat it', () => {
  it('reads the rhythms the app already keeps', () => {
    expect(ruleFromWords('every day at 5pm')).toMatchObject({ rule: { every: 'day', at: '17:00' } });
    expect(ruleFromWords('Every day at 5 PM')).toMatchObject({ rule: { every: 'day', at: '17:00' } });
    expect(ruleFromWords('weekdays at 9:30am')).toMatchObject({ rule: { every: 'weekday', at: '09:30' } });
    expect(ruleFromWords('every friday at 4pm')).toMatchObject({ rule: { every: 'week', on: 5, at: '16:00' } });
    expect(ruleFromWords('mondays at 7am')).toMatchObject({ rule: { every: 'week', on: 1, at: '07:00' } });
  });

  it('takes the time without "at", because the box holds nothing but the rule', () => {
    expect(ruleFromWords('every day 5pm')).toMatchObject({ rule: { every: 'day', at: '17:00' } });
    expect(ruleFromWords('daily 6:15pm')).toMatchObject({ rule: { every: 'day', at: '18:15' } });
    expect(ruleFromWords('fridays 4pm')).toMatchObject({ rule: { every: 'week', on: 5, at: '16:00' } });
  });

  it('lands a rule with no time on eight, as every other rule does', () => {
    expect(ruleFromWords('every tuesday')).toMatchObject({ rule: { every: 'week', on: 2, at: '08:00' } });
    expect(ruleFromWords('daily')).toMatchObject({ rule: { every: 'day', at: '08:00' } });
  });

  it('carries the words the rule reads back in', () => {
    expect(ruleFromWords('every day at 5pm')?.label).toBe('daily at 5:00pm');
  });

  it('is nothing at all while the box is empty', () => {
    expect(ruleFromWords('')).toBeNull();
    expect(ruleFromWords('   ')).toBeNull();
  });

  it('refuses a single moment, which is Send later and not a repeat', () => {
    expect(ruleFromWords('5pm')).toBeNull();
    expect(ruleFromWords('tomorrow at 9am')).toBeNull();
    expect(ruleFromWords('friday at 4pm')).toBeNull();
  });

  it('says so when it reads a rhythm it cannot keep, rather than guessing one', () => {
    expect(ruleFromWords('every other day')).toEqual({ unreadable: true });
    expect(ruleFromWords('every evening')).toEqual({ unreadable: true });
    expect(ruleFromWords('every day at half past nine')).toEqual({ unreadable: true });
  });

  it('refuses words that are not a rule', () => {
    expect(ruleFromWords('whenever')).toBeNull();
    expect(ruleFromWords('satisfy the customer 5pm')).toBeNull();
  });
});

describe('the composer', () => {
  const src = readFileSync(new URL('../renderer/src/threads/ThreadComposer.tsx', import.meta.url), 'utf8');

  it('reads the typed rule with ruleFromWords on the Repeat it page', () => {
    expect(src).toContain('ruleFromWords(');
  });
});
