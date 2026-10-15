// THE PLAN QUESTION AND THE SETUP CARD (w-9f6975906c). What they say at every
// moment is decided in ../plan-setup.ts, where it is tested; this file draws it
// and talks to the main process. Both screens wear the walk's own card and row
// classes (`fr-card fr-folders`, `fr-folder`), so they are the folder screen's
// siblings rather than a new look, which is how they were drawn and picked.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  COPY, afterCheck, enginesFor, planName, planNote, planRows, setupLede, setupRows,
  type AskRow, type Engine, type EngineSetupState, type Plan, type StepRow,
} from '../plan-setup';
import { Cap } from './Onboarding';

const Mark = ({ letter }: { letter: string }) => <span className="ps-mark" aria-hidden="true">{letter}</span>;

/**
 * A CARD OF ANSWERS: a mark, a name, a sentence, arrows and Enter, no Submit.
 *
 *  Lifted out of `PlanQuestion` on 2026-10-09 (w-ce8c1a9275) so the walk's last
 *  card can be the same thing. The founder, on a photograph of that card drawn
 *  as three buttons in a row: "In onboarding we already have a component for
 *  geting setup/selecting your harness I feel like that's a better design an
 *  dpossibly placement." It was a second vocabulary for one moment, on the one
 *  screen in the app that will not let anybody past it.
 *
 *  THE ROWS ARE DATA, from ../plan-setup, so what a card offers is read by a
 *  test rather than eyeballed. `other` is the separated group at the foot: the
 *  ways out, as opposed to the things somebody pays for.
 */
export function AskList({ rows, label, onPick, busy = false }: {
  rows: AskRow[];
  label: string;
  onPick: (key: string) => void;
  /** Something is already happening, so a second press would start a race. */
  busy?: boolean;
}) {
  const [lit, setLit] = useState(0);
  // A row that leaves the app is its own anchor, so a CLICK on one is the
  // browser's to handle and never reaches here; this is the keyboard's copy of
  // that, and the only place `href` is opened by hand.
  const choose = useCallback((i: number) => {
    const row = rows[i];
    if (!row || busy) return;
    if (row.href) window.open(row.href, '_blank', 'noreferrer');
    else onPick(row.key);
  }, [busy, onPick, rows]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setLit((n) => Math.min(rows.length - 1, n + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setLit((n) => Math.max(0, n - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(lit); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [choose, lit, rows.length]);

  return (
    <div className="fr-card fr-folders" role="listbox" aria-label={label}>
      {rows.map((row, i) => {
        const inside = (
          <>
            <span className="fr-fold">
              {row.mark ? <Mark letter={row.mark} /> : (
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8h9M8.5 4.5L12 8l-3.5 3.5" /></svg>
              )}
            </span>
            <span className="fr-folder-name">{row.name}</span>
            {row.sub && <span className="fr-folder-path">{row.sub}</span>}
            {row.sub && <span className="fr-folder-via" />}
            <span className="fr-folder-key">{lit === i && <Cap cap="↵" />}</span>
          </>
        );
        const className = `fr-folder${row.other ? ' fr-folder-other' : ''}${lit === i ? ' lit' : ''}`;
        // A ROW THAT LEAVES THE APP IS AN ANCHOR, so the address is in the page
        // and can be copied or opened in a new window. Everything else is a
        // button, because it does something here.
        return row.href ? (
          <a
            key={row.key}
            role="option"
            aria-selected={lit === i}
            className={className}
            href={row.href}
            target="_blank"
            rel="noreferrer"
            onMouseEnter={() => setLit(i)}
          >{inside}</a>
        ) : (
          <button
            key={row.key}
            type="button"
            role="option"
            aria-selected={lit === i}
            className={className}
            onMouseEnter={() => setLit(i)}
            onClick={() => choose(i)}
          >{inside}</button>
        );
      })}
    </div>
  );
}

const RowIcon = ({ state }: { state: StepRow['state'] }) => (
  state === 'done' ? (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
  ) : state === 'now' ? (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.5" fill="currentColor" /></svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><circle cx="8" cy="8" r="5" /></svg>
  )
);

/**
 * WHICH AI PLAN DO YOU PAY FOR. Five rows now, the same list the folder screen
 *  is: arrows move, Enter or a click answers, and there is no Submit.
 *
 *  THE FOURTH IS "I ALREADY HAVE ONE" (w-ce8c1a9275). It is an answer to this
 *  question and not a screen of its own: the search asks their own login shell
 *  first and then looks in sixteen places, and when it still misses, the only
 *  thing left is to be shown.
 *
 *  AND THE SCREEN LOOKS AT THE COMPUTER WHILE IT ASKS. The founder: "I would
 *  think this step is actually better fit also checking first at the same time.
 *  Otherwise they may select something we cant run. Best to figure it out now."
 *
 *  They are right, and the gap was in the data rather than the drawing. The
 *  walk probes both engines at the welcome step and then reduces the two
 *  readings to `needsPlan`, one boolean; `afterCheck` can tell three cases
 *  apart from the very same readings, and only one of them is a question worth
 *  asking. A machine with Codex on the disk signed out was being shown three
 *  plans, and somebody picking Claude there sent us off to install Claude Code
 *  -- which is the "select something we cant run" in their note.
 *
 *  So `look()` runs on arrival. It is the walk's own cached probe, so this
 *  costs nothing on top of what the welcome step already paid, and the three
 *  answers go to the three things that handle them: ready ends the step, a
 *  tool-on-the-disk goes straight to signing THAT one in, and only an empty
 *  computer leaves the question standing.
 */
export function PlanQuestion({ onPick, onReady, look }: {
  onPick: (plan: Plan) => void;
  /** Something already set up, so there is no question to ask. */
  onReady: () => void;
  /**
   * The two readings, from whoever has them. The walk hands in `askMac`, which
   * is cached, so the answer is usually here the instant this is drawn; a copy
   * opened straight onto this step takes its own.
   *
   * `fresh` THROWS THAT CACHE AWAY, and it is not optional. Pointing at a file
   * changes the very thing the cache is a reading of, so asking the cached
   * answer afterwards would report the machine as it was before the press.
   */
  look?: (fresh?: boolean) => Promise<Array<Pick<EngineSetupState, 'engine' | 'found' | 'signedIn'>>>;
}) {
  const rows = planRows();
  const [looking, setLooking] = useState(true);
  const [looked, setLooked] = useState(false);
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState(false);

  const readings = useCallback(async (fresh: boolean) => {
    if (look) return look(fresh);
    const found = await Promise.all((['claude', 'codex'] as Engine[]).map((e) => api.engineSetup('ready', e)));
    return found.map((f) => ({ engine: f.engine, found: !!f.found, signedIn: !!f.signedIn }));
  }, [look]);

  const check = useCallback(async (fresh = false) => {
    setLooking(true);
    setRefused(false);
    let next: ReturnType<typeof afterCheck>;
    try { next = afterCheck(await readings(fresh)); }
    // A probe that could not run is not a machine with something on it, and
    // this screen's question is the right one either way. Saying "nothing is
    // set up" is the honest summary of a look that came back with nothing.
    catch { next = { t: 'nothing' }; }
    setLooking(false);
    setLooked(true);
    if (next.t === 'ready') onReady();
    else if (next.t === 'setup') onPick(next.plan);
  }, [onPick, onReady, readings]);

  /*
   * ON ARRIVAL, beside the question rather than instead of it: the card is on
   * the screen and answerable from the first frame, and the look lands under it.
   *
   * ONCE, AND THE REF IS LOAD-BEARING. `onReady` is written inline at the call
   * site, so it is a new function on every render of the walk; without this the
   * effect would re-fire on each one and the step would probe the machine in a
   * loop for as long as somebody sat on it.
   */
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void check();
  }, [check]);

  /*
   * SHOW IT WHERE ONE IS. The panel opens in the main process and the choice is
   * applied there in the same call, so no path off anybody's disk crosses the
   * bridge (main/ipc.mjs, `zero:engine-bin`). A file that is not something
   * agents can run comes back as words, here, where the press was.
   *
   * Claude Code is what is asked for, because that is the one the app will not
   * open an inbox without; somebody whose only agent is Codex is answered by
   * the look on arrival, which finds it.
   */
  const mine = useCallback(async () => {
    setBusy(true);
    setRefused(false);
    try {
      const r = await api.engineBin('claude');
      if (r?.refused) { setRefused(true); return; }
      if (r?.canceled) return;
      // It landed, so the same look that opened this screen decides what
      // happens next rather than this press assuming it worked -- and it looks
      // AGAIN rather than reading back the answer it cached before the press,
      // which is the one thing this press has just changed.
      await check(true);
    } finally {
      setBusy(false);
    }
  }, [check]);

  const choose = useCallback((key: string) => {
    if (key === 'mine') void mine();
    else onPick(key as Plan);
  }, [mine, onPick]);

  const note = planNote({ looking, looked, refused });
  return (
    <div className="fr-stack fr-stack-folders">
      <h1 className="fr-page">{COPY.planHead}</h1>
      <p className="fr-lede">{COPY.planLede}</p>
      {/* ANSWERABLE WHILE THE LOOK RUNS. The card is not held back behind it:
          somebody who knows which plan they pay for should not wait on a probe
          about a machine they already know the answer for. */}
      <AskList rows={rows} label={COPY.planHead} onPick={choose} busy={busy} />
      <p className={note.bad ? 'fr-note fr-refused' : 'fr-note'}>{note.text}</p>
    </div>
  );
}

/**
 * SETTING UP CLAUDE. Installs and signs in each tool the plan needs, one after
 *  the other, and hands back when every one is ready. The only thing it ever
 *  asks of anybody is the approval in their browser.
 */
export function PlanSetupCard({ plan, onDone, onSkip }: {
  plan: Plan;
  onDone: () => void;
  onSkip: () => void;
}) {
  const engines = enginesFor(plan);
  const [at, setAt] = useState(0);
  const engine = engines[Math.min(at, engines.length - 1)];
  const [state, setState] = useState<EngineSetupState>({ engine, phase: 'installing', error: null, log: '' });
  const [showLog, setShowLog] = useState(false);
  // Bumped by Try again, which starts the same loop over on the same tool.
  const [round, setRound] = useState(0);
  const finished = useRef(false);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async (first: boolean) => {
      const s = await api.engineSetup(first ? 'start' : 'status', engine);
      if (!live) return;
      setState(s);
      if (s.phase === 'ready') {
        if (at + 1 < engines.length) {
          setState({ engine: engines[at + 1], phase: 'installing', error: null, log: '' });
          setAt(at + 1);
          return;
        }
        if (!finished.current) { finished.current = true; timer = setTimeout(onDone, 700); }
        return;
      }
      if (s.phase === 'failed') return;
      timer = setTimeout(() => tick(false), 1000);
    };
    void tick(true);
    return () => { live = false; if (timer) clearTimeout(timer); };
    // engines is derived from plan, which does not change under a mounted card
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, at, round]);

  const retry = () => { setState({ engine, phase: 'installing', error: null, log: '' }); setRound((n) => n + 1); };

  const name = planName(engine);
  const rows = setupRows(state);
  const head = COPY.setupHead(name);

  return (
    <div className="fr-stack fr-stack-folders">
      <h1 className="fr-page">{head}</h1>
      <p className="fr-lede">
        {setupLede(state.phase)}
        {engines.length > 1 && <span className="ps-of"> {COPY.setupOf(at + 1, engines.length)}</span>}
      </p>
      <div className="fr-card fr-folders ps-steps">
        {rows.map((row) => (
          <div key={row.title} className={`ps-step ${row.state}`}>
            <span className="ps-ic"><RowIcon state={row.state} /></span>
            <div>
              <div className="ps-t">{row.title}</div>
              {row.sub && <div className="ps-s">{row.sub}</div>}
            </div>
            <span className="ps-r">{row.right ?? ''}</span>
          </div>
        ))}
      </div>
      {state.phase === 'failed' && state.error && <p className="fr-note fr-refused">{state.error}</p>}
      <div className="ps-acts">
        {state.phase === 'signing-in' && (
          <button type="button" className="fr-gate-again" onClick={() => void api.engineSetup('again', engine)}>{COPY.openAgain}</button>
        )}
        {state.phase === 'failed' && (
          <>
            <button type="button" className="fr-finish-go" onClick={retry}>{COPY.tryAgain}</button>
            <button type="button" className="fr-gate-again" onClick={onSkip}>{COPY.skip}</button>
          </>
        )}
      </div>
      <div className="ps-acts ps-acts-quiet">
        <button type="button" className="ps-link" onClick={() => setShowLog((v) => !v)}>{showLog ? COPY.hideLog : COPY.showLog}</button>
      </div>
      {showLog && <pre className="ps-log">{state.log.trim().split('\n').slice(-14).join('\n') || '…'}</pre>}
    </div>
  );
}

/**
 * THE FALLBACK, ON THE INBOX. Only when the walk is over and still nothing can
 *  run an agent: somebody skipped, or signed out since. Her words: "if somebody
 *  somehow has an issue, maybe that bar at the top makes sense".
 */
export function PlanBar({ onSetup }: { onSetup: (plan: Plan) => void }) {
  return (
    <div className="ps-bar" role="status">
      <div className="ps-bar-say">{COPY.barSay} <span>{COPY.barSub}</span></div>
      <button type="button" onClick={() => onSetup('claude')}>{COPY.barClaude}</button>
      <button type="button" className="quiet" onClick={() => onSetup('codex')}>{COPY.barChatgpt}</button>
    </div>
  );
}
