# The inbox

The first screen. On a store that has a project it opens straight to Threads,
with no sign-in wall and no setup walk, and when nothing needs the person it
says so and offers the next step.

## Sub-features

- `no-wall` no sign-in screen on the single-person app, even on a Mac that holds a team key.
- `no-walk` the first-run walk is skipped once a project exists.
- `empty-state` "Nothing needs you" with a New thread button and the N hint.
- `tabs` Needs you, In progress, Later, Done, All.

## How to get to it (user POV)

- Open the app. The inbox is where it lands.
- esc from a thread or a file goes back to it.

## Driving it with live.mjs

Preconditions: `live.mjs up` and a clean `live.mjs doctor`.

- **Open.** Run `live.mjs drive inbox-opens`. The tab passes the token check, shows no "Sign in to", and shows "Nothing needs you" and "New thread".
- **Proof.** `01-inbox.png` in the run folder, and `report.json`.

## Gotchas

- The project's name is not on the empty inbox; do not wait for "Sandbox" there.
- Without the fresh-user flag, a Mac with `~/.agentbox/team.config.json` opens the copy on the team sign-in screen. `live.mjs up` sets the flag; a hand-started copy may not.
- A store with no projects gets the first-run walk instead. `up` seeds `Sandbox` for that reason.
