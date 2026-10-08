// WHAT THE AGENTS ARE RUNNING ON, IN WORDS.
//
// From a session with a new user, 2026-10-07: "He didn't realize it
// auto-connected to Claude/Codex; he wasn't sure how it was even running. Would
// be nice to have some small indication."
//
// He was right that nothing said. The app finds whichever coding agent is
// already signed in on the Mac and runs every worker on that subscription
// (main/claude-plan.mjs, main/codex-account.mjs), and the walk is SILENT about
// it by design: `needsPlan` in renderer/src/plan-setup.ts skips the plan
// question entirely when one tool is found and signed in, which is the right
// call and leaves nobody told. The only screen that has ever named the account
// is Settings, two clicks in, and you have to suspect there is something to
// look for before you go.
//
// THE PLAN'S VOCABULARY, NOT THE TOOL'S. "Claude" and "ChatGPT" here, never
// "Claude Code" and "Codex", which is the rule the walk already follows
// (renderer/src/plan-setup.ts: words people know, "never the names of the tools
// underneath"). The fact being shown is WHOSE SUBSCRIPTION IS BEING SPENT, and
// nobody pays for a CLI. The tool names stay where they belong: on a byline
// about which agent is working a row (`engineWordFor`, renderer/src/byline.ts),
// which is a different question with a different answer.
//
// NOTHING IS SAID UNTIL SOMETHING IS KNOWN. Every function here answers null on
// an engine it cannot name, and the screens draw nothing at all for null rather
// than "checking…" or a dash. A corner that says it does not know is worse than
// a corner that says nothing: it spends the glance and answers no question.

/** The word for the plan behind an engine. Null for an engine we cannot name. */
export function runsOnName(engine) {
  if (engine === 'claude') return 'Claude';
  if (engine === 'codex') return 'ChatGPT';
  return null;
}

/**
 * THE LINE ON A GLANCE SURFACE. "Claude · Max 20x", or just "Claude" where the
 *  plan cannot be read.
 *
 *  The plan is the raw label the tool itself reports, already turned into words
 *  by whoever read it (`planLabel` in main/claude-plan.mjs for Claude, the
 *  named-plan table in main/codex-account.mjs for ChatGPT). It is never
 *  invented here: a plan nobody measured, printed confidently, is the app
 *  lying about what somebody is paying for.
 */
export function runsOnLine({ engine = null, plan = null } = {}) {
  const name = runsOnName(engine);
  if (!name) return null;
  const words = String(plan ?? '').trim();
  return words ? `${name} · ${words}` : name;
}

/**
 * THE WHOLE SENTENCE, for a hover and for whatever reads the screen aloud. The
 *  glance surface carries two words and a plan; this is where the rest of the
 *  answer lives, and it is the half that tells a new person what they are
 *  looking at.
 */
export function runsOnTitle({ engine = null, plan = null } = {}) {
  const name = runsOnName(engine);
  if (!name) return null;
  const words = String(plan ?? '').trim();
  const plansentence = words ? ` Your ${words} plan.` : '';
  return `Your agents run on the ${name} account already signed in on this Mac.${plansentence}`;
}

/**
 * THE ONE LINE DURING THE WALK, on the Mac where there was nothing to ask.
 *
 *  It replaces silence, not a question: somebody with no coding agent set up
 *  still gets the plan question and the setup card, and never sees this.
 */
export function foundOnThisMac({ engine = null, plan = null } = {}) {
  const name = runsOnName(engine);
  if (!name) return null;
  const words = String(plan ?? '').trim();
  if (words) return `Your agents will run on the ${name} ${words} plan already signed in on this Mac.`;
  return `Your agents will run on the ${name} account already signed in on this Mac.`;
}
