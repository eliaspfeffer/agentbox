// REVIEWING PULL REQUESTS IS A SWITCH YOU TURN ON, PROJECT BY PROJECT.
//
// w-bde446f1aa, 2026-10-07. The watcher (main/pull-requests.mjs) files rows
// that spawn agents, and nothing in this app spawns work nobody asked for, so
// it watches only the projects listed in this Mac's own config. That list is
// written by one switch on the project's settings page, and the switch only
// appears on a project that has a code folder, because a project without one
// has no repository to ask GitHub about.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../main/config.mjs';
import { readSettings, setProjectSetting } from '../main/settings.mjs';
import { Supervisor } from '../main/supervisor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const settingsSrc = fs.readFileSync(path.join(root, 'renderer/src/components/Settings.tsx'), 'utf8');
const page = settingsSrc.slice(settingsSrc.indexOf('<div className="set-title-row">'));

let dir;
const store = {
  listItems: () => [],
  listProducts: () => [{ slug: 'acme', name: 'Acme', dir: '/tmp/acme', repoPath: '/tmp/acme-repo' }, { slug: 'notes', name: 'Notes', dir: '/tmp/notes' }],
  isDue: () => true,
  readInstructions: () => '',
};
const project = (config, slug) => readSettings({ config, supervisor: new Supervisor(config, store, dir), store })
  .projects.find((p) => p.slug === slug);
const flip = (config, value) => setProjectSetting({ config, supervisor: new Supervisor(config, store, dir) }, { product: 'acme', key: 'pullRequests', value });

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-switch-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('the switch', () => {
  it('is off until somebody turns it on', () => {
    const config = loadConfig(dir);
    expect(config.pullRequestProducts).toEqual([]);
    expect(project(config, 'acme').pullRequests).toBe(false);
  });

  it('turns on for that project alone, and stays on', () => {
    flip(loadConfig(dir), true);
    const config = loadConfig(dir);
    expect(config.pullRequestProducts).toEqual(['acme']);
    expect(project(config, 'acme').pullRequests).toBe(true);
    expect(project(config, 'notes').pullRequests).toBe(false);
  });

  it('turns off again', () => {
    flip(loadConfig(dir), true);
    flip(loadConfig(dir), false);
    expect(loadConfig(dir).pullRequestProducts).toEqual([]);
  });

  it('is what the watcher reads', () => {
    flip(loadConfig(dir), true);
    const config = loadConfig(dir);
    expect(new Supervisor(config, store, dir).pullRequests.watched()).toEqual(['acme']);
  });
});

describe('what the page says', () => {
  it('names it in words, beside the switch that is already there', () => {
    expect(page).toContain('Review pull requests from GitHub');
    expect(page).toContain("setProject(current.slug, 'pullRequests', v)");
  });

  it('draws it only on a project with a code folder', () => {
    const at = page.indexOf('Review pull requests from GitHub');
    const guard = page.lastIndexOf('current.repoPath &&', at);
    expect(guard).toBeGreaterThan(-1);
    expect(at - guard).toBeLessThan(200);
  });
});
