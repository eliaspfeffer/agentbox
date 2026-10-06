// THE PLAN QUESTION AND THE SETUP CARD (w-9f6975906c). What they say at every
// moment is decided in ../plan-setup.ts, where it is tested; this file draws it
// and talks to the main process. Both screens wear the walk's own card and row
// classes (`fr-card fr-folders`, `fr-folder`), so they are the folder screen's
// siblings rather than a new look, which is how they were drawn and picked.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  COPY, afterCheck, enginesFor, planName, setupLede, setupRows,
  type Engine, type EngineSetupState, type Plan, type StepRow,
} from '../plan-setup';
import { Cap } from './Onboarding';

const Mark = ({ letter }: { letter: string }) => <span className="ps-mark" aria-hidden="true">{letter}</span>;

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
 * WHICH AI PLAN DO YOU PAY FOR. Four rows, the same list the folder screen is:
 *  arrows move, Enter or a click answers, and there is no Submit.
 */
export function PlanQuestion({ onPick, onReady }: {
  onPick: (plan: Plan) => void;
  /** "Check this Mac" found something already set up. */
  onReady: () => void;
}) {
  const rows: Array<{ key: Plan | 'check'; mark?: string; name: string; sub?: string }> = [
    { key: 'claude', mark: 'C', name: COPY.claude, sub: COPY.claudePlans },
    { key: 'codex', mark: 'G', name: COPY.chatgpt, sub: COPY.chatgptPlans },
    { key: 'both', mark: '+', name: COPY.both, sub: COPY.bothPlans },
    { key: 'check', name: COPY.notSure },
  ];
  const [lit, setLit] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    setNote(COPY.checking);
    const found = await Promise.all((['claude', 'codex'] as Engine[]).map((e) => api.engineSetup('ready', e)));
    setChecking(false);
    const next = afterCheck(found.map((f) => ({ engine: f.engine, found: !!f.found, signedIn: !!f.signedIn })));
    if (next.t === 'ready') { setNote(null); onReady(); }
    else if (next.t === 'setup') { setNote(null); onPick(next.plan); }
    else setNote(COPY.nothingHere);
  }, [onPick, onReady]);

  const choose = useCallback((i: number) => {
    const row = rows[i];
    if (!row || checking) return;
    if (row.key === 'check') void check();
    else onPick(row.key);
    // rows is rebuilt each render from constants; its identity does not matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check, checking, onPick]);

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
    <div className="fr-stack fr-stack-folders">
      <h1 className="fr-page">{COPY.planHead}</h1>
      <p className="fr-lede">{COPY.planLede}</p>
      <div className="fr-card fr-folders" role="listbox" aria-label={COPY.planHead}>
        {rows.map((row, i) => (
          <button
            key={row.key}
            type="button"
            role="option"
            aria-selected={lit === i}
            className={`fr-folder${row.key === 'check' ? ' fr-folder-other' : ''}${lit === i ? ' lit' : ''}`}
            onMouseEnter={() => setLit(i)}
            onClick={() => choose(i)}
          >
            <span className="fr-fold">
              {row.mark ? <Mark letter={row.mark} /> : (
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8h9M8.5 4.5L12 8l-3.5 3.5" /></svg>
              )}
            </span>
            <span className="fr-folder-name">{row.name}</span>
            {row.sub && <span className="fr-folder-path">{row.sub}</span>}
            {row.sub && <span className="fr-folder-via" />}
            <span className="fr-folder-key">{lit === i && <Cap cap="↵" />}</span>
          </button>
        ))}
      </div>
      <p className={note && note !== COPY.checking ? 'fr-note fr-refused' : 'fr-note'}>{note ?? COPY.privacy}</p>
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
