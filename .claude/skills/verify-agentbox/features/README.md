# Agentbox verification map

The maintained list of what a person does in Agentbox and how to prove each
one still works. Read this before driving the app; use the matching file as
the recipe. A proof that drives one convenient entry point is incomplete when
a file lists others.

## Baseline

- `live.mjs up` from this checkout, then `live.mjs doctor` reports nothing.
- The copy is the single-person app (fresh-user flag), on an empty store with
  one project, `Sandbox`, backed by a git repo with one commit.
- The worker is the stand-in unless `up --real-claude` was used.
- Never drive an instance this run did not start.

## Driving conventions

- Keys first: N new thread, ⌘↵ send, R reply, esc back, ↵ open. They are the
  app's own handles and outlive layout changes. Visible text second. Never
  coordinates.
- Wait for a fact (`tab.until`, or polling the ledger), not a fixed sleep.
- Every visible claim gets a disk claim beside it: the ledger, the session
  logs, or the stand-in's receipt.

## Feature file shape

An H1 and one paragraph of user-visible behaviour, then four H2s in order:
`Sub-features`, `How to get to it (user POV)`, `Driving it with live.mjs`,
`Gotchas`. No implementation detail beyond the handles and files a proof reads.

## Features

- [Finding Claude Code and Codex](./finding-the-tools.md): the app finds the
  tools however they were installed, and a worker can start them.
- [The inbox](./inbox.md): opens with no sign-in wall or setup walk on a used
  store, and says what to do next when empty.
- [A new thread](./new-thread.md): N, type, ⌘↵ files it, a worker takes it,
  its answer shows in the thread.
- [Replying](./reply.md): R on an answered thread reaches a worker and its
  answer comes back.

## Not yet in the map

Electron-only behaviour, Codex as the worker, the signed-in team version,
shipping, approvals, scheduling, Linux. See SKILL.md, "Not covered yet".
