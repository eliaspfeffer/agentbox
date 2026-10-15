# Replying

The person answers an agent in its thread and the conversation carries on: the
reply is kept, a worker takes it, and its answer comes back to the thread.

## Sub-features

- `reply-box` R puts the cursor in the reply box of an open thread.
- `stored` ⌘↵ writes the reply to the thread.
- `taken` a new worker session starts for the reply.
- `answered` the answer to the reply replaces the thread's result.
- `remembers` the agent knows what was said before (real Claude Code only).

## How to get to it (user POV)

- Open a thread (↵ or click), press R, type, ⌘↵.
- Click the Reply box at the foot of a thread.

## Driving it with live.mjs

Preconditions: a clean `live.mjs doctor`, and an answered thread (run the `new-thread` drive first).

- **Reply.** Run `live.mjs drive reply`. It opens the newest answered thread from the All tab, presses R, types a stamped reply and sends it.
- **Stored.** A ledger line on that thread contains the stamp.
- **Taken.** The thread's session logs go up by one.
- **Answered.** The row's `result` is rewritten after the send.
- **Remembers.** With `up --real-claude`, the reply asks which word was given before, and the answer contains PINEAPPLE.
- **Proof.** `01-reply-typed.png`, `02-after-reply.png`, `report.json`.

## Gotchas

- The stand-in writes no Claude Code transcript, so the app cannot resume its session and starts the reply cold with a fresh brief. That is the app being right, not a bug; prove resuming with `--real-claude`.
- Run `new-thread` first in the same instance; `down` deletes every thread.
