// THE CLOUD BUTTON CHOOSES WHERE THREADS RUN: ONLY THIS MAC, WHEN THIS MAC IS
// FULL, OR EVERYTHING.
//
// Until now the only way to change it was editing `cloudRuns` in the config
// file. The founder picked the design on 2026-10-13: a square cloud button
// beside the filters button, wearing how many run in the cloud when any do,
// opening a menu built like the filters menu with three choices, the picked
// one in orange, and this month's use under them. She is about to run most of
// her own work in the cloud for a few days, so the menu also says what that
// cost, from the runs' own measurements (main/cloud/usage.mjs).
// Here: the words and numbers the menu shows, the setting it writes, and the
// supervisor's answer the snapshot carries.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Supervisor } from '../main/supervisor.mjs';
import { setWorkspaceSetting } from '../main/settings.mjs';
import { appendCloudUsage } from '../main/cloud/usage.mjs';
import { CLOUD_MODES, cloudModeOf, cloudButtonCount, cloudMonthLine } from '../renderer/src/cloud-menu';

let dir; let config; let supervisor;
const savedConfigEnv = process.env.AGENTBOX_CLOUD_CONFIG;
beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cloudbutton-')));
  config = { home: dir, appDir: dir, storeRoot: dir, authProfiles: ['default'] };
  supervisor = new Supervisor(config, { listItems: () => [], listProducts: () => [], isDue: () => true, settleAnswer() {}, readItem: () => null }, dir);
  delete process.env.AGENTBOX_CLOUD_CONFIG;
});
afterEach(() => {
  if (savedConfigEnv === undefined) delete process.env.AGENTBOX_CLOUD_CONFIG; else process.env.AGENTBOX_CLOUD_CONFIG = savedConfigEnv;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the menu\'s words', () => {
  it('offers the three choices in order, each saying what it does in one line', () => {
    expect(CLOUD_MODES.map((m) => m.id)).toEqual(['mac', 'full', 'all']);
    expect(CLOUD_MODES.map((m) => m.label)).toEqual(['This Mac only', 'When this Mac is full', 'Everything']);
    for (const m of CLOUD_MODES) expect(m.note.length).toBeLessThan(60);
  });

  it('reads the setting the way the supervisor does', () => {
    expect(cloudModeOf(false)).toBe('mac');
    expect(cloudModeOf('all')).toBe('all');
    for (const v of [null, undefined, true]) expect(cloudModeOf(v)).toBe('full');
  });

  it('wears a number only while something runs in the cloud', () => {
    expect(cloudButtonCount({ running: 0 })).toBe(null);
    expect(cloudButtonCount({ running: 3 })).toBe(3);
    expect(cloudButtonCount(null)).toBe(null);
  });

  it('says this month\'s use in agent-hours, with the cost once runs have measured it', () => {
    expect(cloudMonthLine({ runs: 0, agentHours: 0, estimatedCost: 0, costPerAgentHour: null })).toBe('Nothing in the cloud yet this month');
    expect(cloudMonthLine({ runs: 4, agentHours: 12.4, estimatedCost: 1.372, costPerAgentHour: 0.11 })).toBe('12.4 agent-hours · about $1.37');
    expect(cloudMonthLine({ runs: 1, agentHours: 0.5, estimatedCost: 0, costPerAgentHour: null })).toBe('0.5 agent-hours');
  });
});

describe('the setting', () => {
  const choose = (value) => setWorkspaceSetting({ config, supervisor }, { key: 'cloudRuns', value });
  const onDisk = () => JSON.parse(fs.readFileSync(path.join(dir, 'zero.config.json'), 'utf8')).cloudRuns;

  it('writes what the supervisor reads, and takes effect without a restart', () => {
    choose('all');
    expect(config.cloudRuns).toBe('all');
    expect(onDisk()).toBe('all');
    expect(supervisor._cloudFirst()).toBe(true);
    choose('mac');
    expect(config.cloudRuns).toBe(false);
    choose('full');
    expect(config.cloudRuns).toBe(null);
    expect(supervisor._cloudFirst()).toBe(false);
  });

  it('refuses a value it does not know', () => {
    choose('all');
    expect(() => choose('sometimes')).toThrow();
    expect(config.cloudRuns).toBe('all');
  });
});

describe('what the snapshot carries', () => {
  it('says the cloud is not set up on a Mac without its setup, so no button is drawn', () => {
    expect(supervisor.cloudStatus()).toMatchObject({ setUp: false });
  });

  it('says the mode, how many run there now, and this month\'s use', () => {
    const cfg = path.join(dir, 'cloud.json');
    fs.writeFileSync(cfg, JSON.stringify({ region: 'us-east-1', bucket: 'b', runtimeArn: 'arn:aws:bedrock-agentcore:us-east-1:000000000000:runtime/x' }));
    process.env.AGENTBOX_CLOUD_CONFIG = cfg;
    config.cloudRuns = 'all';
    supervisor.sessions.set('w-c', { itemId: 'w-c', engine: 'claude', cloud: true, tail: [] });
    supervisor.sessions.set('w-l', { itemId: 'w-l', engine: 'claude', cloud: false, tail: [] });
    appendCloudUsage({ runId: 'r', item: 'w-1', engine: 'claude', exitCode: 0, usage: { wallSeconds: 7200, cpuSeconds: 600, peakMemoryBytes: 1024 ** 3 } }, { home: dir });
    const s = supervisor.cloudStatus();
    expect(s).toMatchObject({ setUp: true, mode: 'all', running: 1 });
    expect(s.month.agentHours).toBe(2);
    expect(s.month.runs).toBe(1);
  });
});
