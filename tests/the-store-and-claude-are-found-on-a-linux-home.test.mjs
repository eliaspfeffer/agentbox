// THE STORE AND CLAUDE CODE ON A LINUX HOME.
//
// The lookup was written on a Mac: /Users, a login zsh, and a keychain at
// ~/Library/Keychains. A Linux home has none of those. The store is still
// ~/.agentbox, Claude Code is still the file on disk, and a fresh home
// still opens when the keychain directory is not there.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appHome } from '../main/store/home.mjs';
import { findClaudeBin } from '../main/claude-bin.mjs';
import { prepareHome } from '../shared/fresh-user-home.mjs';
import { envNames } from '../shared/product-name.mjs';

const HOME = '/home/ada';

function withoutStoreEnv(run) {
  const saved = {};
  for (const key of envNames('HOME')) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  try { return run(); }
  finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('a linux home needs no mac path', () => {
  it('keeps the store at ~/.agentbox under /home, with no /Users in the answer', () => {
    withoutStoreEnv(() => {
      const root = appHome(HOME);
      expect(root).toBe(`${HOME}/.agentbox`);
      expect(root.startsWith('/Users')).toBe(false);
    });
  });

  it('finds claude on disk and does not ask a shell or a keychain', () => {
    const bin = `${HOME}/.local/bin/claude`;
    const found = findClaudeBin({
      home: HOME,
      exists: (p) => p === bin,
      shellLookup: () => { throw new Error('no login shell'); },
      readdir: () => [],
      dangles: () => false,
    });
    expect(found).toMatchObject({ path: bin, found: true, from: 'disk' });
    expect(found.searched.some((p) => p.startsWith('/Users'))).toBe(false);

    const pnpm = `${HOME}/.local/share/pnpm/claude`;
    const viaPnpm = findClaudeBin({
      home: HOME,
      exists: (p) => p === pnpm,
      shellLookup: () => { throw new Error('no login shell'); },
      readdir: () => [],
      dangles: () => false,
    });
    expect(viaPnpm).toMatchObject({ path: pnpm, found: true, from: 'disk' });
  });

  it('opens a fresh home when there is no macOS keychain to link', () => {
    const realHome = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-real-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-fresh-'));
    fs.mkdirSync(path.join(realHome, '.local', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(realHome, '.local', 'bin', 'claude'), '#!/bin/sh\n');
    try {
      const made = prepareHome(home, { realHome, withTools: true });
      expect(made.keychain).toBe(false);
      expect(fs.existsSync(path.join(home, 'Library', 'Keychains'))).toBe(false);
      expect(made.claudeBin).toBe(true);
    } finally {
      fs.rmSync(realHome, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
