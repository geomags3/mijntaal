'use client';
import { ArrowRight, BookOpen, Check, LoaderCircle, Play, Volume2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { clientData, dataChanged, readJson } from '../../lib/client-data';
import type { AnswerMode } from '../../lib/practice-input';
import { assembleBlocks } from '../../lib/practice-input';
import type { SentenceBase, SentenceEvent, SentenceJournal } from '../../lib/sentences';
import {
  ackSentences,
  appendSentence,
  restoreSentences,
  sentenceScores,
  sentenceView,
} from '../../lib/sentences';
import { newWordAttemptId } from '../../lib/words';
import AnswerModeSwitch from './answer-mode';
type Source = { id: string; title: string; total: number; ready: number };
type Result = SentenceBase & { scope?: string; sources?: Source[]; sessionSize?: number };
async function sentenceRequest(data?: any): Promise<Result> {
  if (!data) return readJson('/api/sentences', true);
  const r = await fetch('/api/sentences', {
    method: data ? 'POST' : 'GET',
    headers: data ? { 'Content-Type': 'application/json' } : undefined,
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const value: any = await r.json();
  if (!r.ok)
    throw Object.assign(Error(value.error || 'Sentences could not load.'), { status: r.status });
  dataChanged('/api/sentences');
  return value;
}
export default function SentencesPractice({
  onSpeak,
  audioReady,
  visible = true,
  request = sentenceRequest,
}: {
  onSpeak: (text: string) => void;
  audioReady: boolean;
  visible?: boolean;
  request?: (data?: any) => Promise<Result>;
}) {
  const [validating, setValidating] = useState(true);
  const [data, setData] = useState<SentenceBase>({ session: null, revision: 0 }),
    [sources, setSources] = useState<Source[]>([]),
    [source, setSource] = useState('all'),
    [mode, setMode] = useState<'blocks' | 'typing'>('blocks'),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [active, setActive] = useState(false),
    [error, setError] = useState(''),
    [syncing, setSyncing] = useState(false),
    [pending, setPending] = useState(false),
    [conflict, setConflict] = useState(false),
    [answer, setAnswer] = useState(''),
    [picked, setPicked] = useState<number[]>([]);
  const journal = useRef<SentenceJournal | null>(null),
    scope = useRef(''),
    saving = useRef(false),
    failed = useRef(false),
    lock = useRef(false),
    input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!visible) void sync();
  }, [visible]);
  useEffect(() => {
    const changed = (event: Event) => {
      const prefixes = (event as CustomEvent<string[]>).detail;
      if (prefixes?.includes('/api/materials') && !saving.current) void load();
    };
    window.addEventListener('dutch-external-data', changed);
    return () => window.removeEventListener('dutch-external-data', changed);
  }, []);
  const [sessionSize, setSessionSize] = useState(5);
  const [answerMode, setAnswerMode] = useState<AnswerMode>('blocks');
  const s = data.session,
    item = s?.items[s.index],
    feedback = s?.feedback;
  function retain(j: SentenceJournal) {
    if (!scope.current) throw Error('Practice storage is not ready.');
    const key = 'sentences-journal:' + scope.current;
    if (journal.current && localStorage.getItem(key) !== JSON.stringify(journal.current))
      throw Object.assign(Error('Sentences changed in another tab.'), { status: 409 });
    const view = sentenceView(j);
    localStorage.setItem(key, JSON.stringify(j));
    journal.current = j;
    setData(view);
    setPending(j.events.length > 0);
  }
  async function load() {
    setValidating(true);
    const cached =
      request === sentenceRequest ? clientData.peek<Result>('/api/sentences') : undefined;
    if (cached) {
      try {
        const saved = localStorage.getItem('sentences-journal:' + cached.scope);
        setData(saved ? sentenceView(restoreSentences(saved)) : cached);
        setSources(cached.sources || []);
        setSessionSize(cached.sessionSize || 5);
        setLoading(false);
      } catch {}
    } else setLoading(true);
    try {
      const result = await request();
      setSessionSize(result.sessionSize || 5);
      scope.current = result.scope || scope.current;
      setSources(result.sources || []);
      const raw = localStorage.getItem('sentences-journal:' + scope.current);
      let j = raw
        ? restoreSentences(raw)
        : { base: { session: result.session, revision: result.revision }, events: [] };
      if (!j.events.length)
        j = { base: { session: result.session, revision: result.revision }, events: [] };
      retain(j);
      setError('');
      setConflict(false);
      failed.current = false;
      if (j.events.length) {
        setActive(!sentenceView(j).session?.closed);
        void sync();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setValidating(false);
    }
  }
  async function sync() {
    if (saving.current || !journal.current?.events.length) return;
    saving.current = true;
    setSyncing(true);
    try {
      if (!journal.current.flight)
        retain({ ...journal.current, flight: journal.current.events.length });
      const sent = structuredClone({
        base: journal.current!.base,
        events: journal.current!.events.slice(0, journal.current!.flight),
      });
      const result = await request({
        action: 'batch',
        sessionId: sent.base.session!.id,
        revision: sent.base.revision,
        events: sent.events,
      });
      retain(ackSentences(journal.current!, sent, result));
      failed.current = false;
      setError('');
      setConflict(false);
    } catch (e) {
      failed.current = true;
      const err = e as Error & { status?: number };
      setConflict(!!err.status && err.status >= 400 && err.status < 500 && err.status !== 429);
      setError(err.message + ' Local answers are retained.');
    } finally {
      saving.current = false;
      setSyncing(false);
      if (
        !failed.current &&
        journal.current?.events.length &&
        sentenceView(journal.current).session?.closed
      )
        queueMicrotask(() => void sync());
    }
  }
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
        if (!failed.current) void sync();
      }, 10000),
      online = () => {
        failed.current = false;
        void sync();
      },
      hide = () => {
        if (document.visibilityState === 'hidden') void sync();
      },
      storage = (e: StorageEvent) => {
        if (
          e.key === 'sentences-journal:' + scope.current &&
          journal.current &&
          e.newValue !== JSON.stringify(journal.current)
        ) {
          if (!journal.current.events.length) {
            journal.current = null;
            setActive(false);
            void load();
            return;
          }
          failed.current = true;
          setConflict(true);
          setError('Sentences changed in another tab. Local answers are retained.');
        }
      };
    window.addEventListener('online', online);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', hide);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', online);
      window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);
  useEffect(() => {
    setAnswer('');
    setPicked([]);
    setAnswerMode(s?.mode || 'blocks');
    if (!s || !item) return;
    try {
      const d = JSON.parse(
        sessionStorage.getItem('sentences-draft:' + scope.current + ':' + s.id + ':' + s.index) ||
          'null',
      );
      if (d) {
        setAnswerMode(d.mode === 'typing' ? 'typing' : d.mode === 'blocks' ? 'blocks' : s.mode);
        setAnswer(d.answer || '');
        setPicked(
          (d.picked || []).filter(
            (i: number) => Number.isInteger(i) && i >= 0 && i < item.tokens.length,
          ),
        );
      }
    } catch {}
    if (active && s.mode === 'typing') input.current?.focus();
  }, [s?.id, s?.index, active]);
  useEffect(() => {
    if (answerMode === 'typing' && active && !feedback) input.current?.focus();
  }, [answerMode, active]);
  function draft(text: string, indices: number[], mode: AnswerMode = answerMode) {
    setAnswerMode(mode);
    setAnswer(text);
    setPicked(indices);
    if (s)
      try {
        sessionStorage.setItem(
          'sentences-draft:' + scope.current + ':' + s.id + ':' + s.index,
          JSON.stringify({ answer: text, picked: indices, mode }),
        );
      } catch {}
  }
  function send(action: SentenceEvent['action'], text = '') {
    if (validating || lock.current || conflict || !journal.current) return false;
    lock.current = true;
    try {
      const view = sentenceView(journal.current).session;
      if (!view) return false;
      if (action === 'hint' && view.hinted) return true;
      const next = appendSentence(journal.current, {
        id: newWordAttemptId(),
        action,
        index: view.index,
        answer: text,
      });
      retain(next);
      if (sentenceView(next).session?.closed) {
        setActive(false);
        void sync();
      } else if (
        next.events.filter((e) => e.action === 'next' || e.action === 'skip').length >= 5 &&
        !failed.current
      )
        void sync();
      return true;
    } catch (e) {
      setConflict(true);
      setError((e as Error).message);
      return false;
    } finally {
      lock.current = false;
    }
  }
  async function start() {
    if (validating || busy || pending) return;
    setBusy(true);
    try {
      const result = await request({ action: 'start', source, mode });
      retain({ base: { session: result.session, revision: result.revision }, events: [] });
      setError('');
      setActive(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function restoreServerProgress() {
    if (
      !confirm('Use server progress? Local answers will be kept as a recovery copy on this device.')
    )
      return;
    try {
      if (journal.current)
        localStorage.setItem(
          'sentences-recovery:' + scope.current + ':' + Date.now(),
          JSON.stringify(journal.current),
        );
      localStorage.removeItem('sentences-journal:' + scope.current);
      journal.current = null;
      setActive(false);
      setPending(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function download() {
    if (!journal.current) return;
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(journal.current, null, 2)], { type: 'application/json' }),
      ),
      a = document.createElement('a');
    a.href = url;
    a.download = 'dutch-sentences-recovery.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const alert = error && (
    <div className="alert" role="alert">
      <p>{error}</p>
      {pending ? (
        <>
          <button
            disabled={syncing}
            onClick={() => {
              failed.current = false;
              void sync();
            }}
          >
            Retry sync
          </button>
          {conflict && (
            <>
              <button onClick={download}>Download local answers</button>
              <button disabled={syncing} onClick={() => void restoreServerProgress()}>
                Use server progress
              </button>
            </>
          )}
        </>
      ) : (
        <button onClick={() => void load()}>Reload</button>
      )}
    </div>
  );
  if (loading)
    return (
      <div className="lookup-loading">
        <LoaderCircle className="spin" />
        <p>Loading your texts…</p>
      </div>
    );
  const selected = sources.filter(
      (t) =>
        source === 'all' || (source === 'texts' && t.id !== 'saved-phrases') || t.id === source,
    ),
    ready = selected.reduce((n, t) => n + t.ready, 0),
    total = selected.reduce((n, t) => n + t.total, 0),
    summary = s?.closed ? sentenceScores(s) : null;
  if (!active || !s || !item)
    return (
      <>
        {alert}
        <section className="words-start sentences-start">
          <span className="words-symbol">
            {summary ? <Check size={27} /> : <BookOpen size={27} />}
          </span>
          <h2>{summary ? 'Round complete' : 'Sentences'}</h2>
          {summary && (
            <div className="words-stats">
              <span>
                <b>{summary.correct}</b>Correct
              </span>
              <span>
                <b>{summary.supported}</b>With help
              </span>
              <span>
                <b>{summary.wrong}</b>To revisit
              </span>
            </div>
          )}
          {!s || s.closed ? (
            <>
              <p>English → Dutch · up to {sessionSize} sentences</p>
              <div className="sentences-options">
                <label>
                  Source
                  <select value={source} onChange={(e) => setSource(e.target.value)}>
                    <option value="all">All sources</option>
                    <option value="texts">All texts</option>
                    {sources.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title} · {t.ready} ready
                      </option>
                    ))}
                  </select>
                </label>
                <div className="practice-switch" role="group" aria-label="Answer format">
                  <button aria-pressed={mode === 'blocks'} onClick={() => setMode('blocks')}>
                    Word blocks
                  </button>
                  <button aria-pressed={mode === 'typing'} onClick={() => setMode('typing')}>
                    Typing
                  </button>
                </div>
                <small>{ready} translated sentences available</small>
              </div>
            </>
          ) : (
            <p>
              {s.items[0]?.title} · {s.mode === 'blocks' ? 'Word blocks' : 'Typing'}
            </p>
          )}
          <button
            className="primary"
            disabled={validating || busy || pending || (!s?.closed && !!s ? false : !ready)}
            onClick={() => void start()}
          >
            {busy ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}{' '}
            {s && !s.closed ? 'Resume round' : 'Start Sentences'}
          </button>
          {pending && (
            <p className="words-small" role="status">
              {syncing ? 'Syncing progress…' : 'Saved on this device · sync pending'}
            </p>
          )}
          {total > ready && (
            <p className="words-small">
              {total - ready} {total - ready === 1 ? 'sentence needs' : 'sentences need'} a
              translation.{' '}
              <Link
                href={
                  ['all', 'texts'].includes(source)
                    ? '/texts'
                    : '/texts?id=' + encodeURIComponent(source)
                }
              >
                Prepare Text ↗
              </Link>
            </p>
          )}
          {!sources.length && (
            <p className="words-small">
              Prepare a text in <Link href="/texts">Texts ↗</Link> or add phrases to Sentences in{' '}
              <Link href="/?tab=Collection">Collection ↗</Link>.
            </p>
          )}
          {summary && summary.wrong > 0 && (
            <details className="sentence-review">
              <summary>Review missed sentences</summary>
              {s!.items
                .filter((_, i) => ['wrong', 'skipped'].includes(s!.results[i]?.outcome || ''))
                .map((i) => (
                  <p key={i.id}>
                    <b lang="nl">{i.nl}</b>
                    <small>{i.en}</small>
                  </p>
                ))}
            </details>
          )}
        </section>
      </>
    );
  const given = answerMode === 'blocks' ? assembleBlocks(item.tokens, picked, ' ') : answer;
  return (
    <>
      {alert}
      <section className="words-card sentence-card">
        <div className="words-top">
          <span>{answerMode === 'blocks' ? 'Word blocks' : 'Typing'}</span>
          <span>
            {s.index + 1} / {s.items.length}
          </span>
          <button disabled={validating || conflict} onClick={() => send('finish')}>
            Finish
          </button>
        </div>
        <Link
          className="sentence-source"
          href={
            item.origin === 'phrase'
              ? '/?tab=Collection'
              : '/texts?id=' + encodeURIComponent(item.textId)
          }
        >
          {item.title} ↗
        </Link>
        <span className="eyebrow">ENGLISH → DUTCH</span>
        <h2>{answerMode === 'blocks' ? 'Build it in Dutch' : 'Write it in Dutch'}</h2>
        <div className="words-prompt" lang="en">
          {item.en}
        </div>
        {!feedback ? (
          <>
            <AnswerModeSwitch
              value={answerMode}
              disabled={validating || conflict}
              onChange={(mode) => draft(answer, picked, mode)}
            />
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (given.trim()) send('check', given);
              }}
            >
              {answerMode === 'blocks' ? (
                <>
                  <div className="words-built" aria-label="Your Dutch answer">
                    {picked.length ? (
                      picked.map((idx, i) => (
                        <button
                          key={idx}
                          type="button"
                          disabled={validating || conflict}
                          aria-label={'Remove ' + item.tokens[idx] + ' at position ' + (i + 1)}
                          onClick={() =>
                            draft(
                              answer,
                              picked.filter((_, j) => i !== j),
                            )
                          }
                        >
                          {item.tokens[idx]}
                        </button>
                      ))
                    ) : (
                      <span>Tap the words in order</span>
                    )}
                  </div>
                  <div className="words-bank">
                    {item.tokens.map((t, i) => (
                      <button
                        key={i}
                        type="button"
                        disabled={conflict || picked.includes(i)}
                        aria-label={'Add ' + t + ' ' + (i + 1)}
                        onClick={() => draft(answer, [...picked, i])}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <label className="words-input">
                  Your Dutch answer
                  <textarea
                    ref={input}
                    lang="nl"
                    value={answer}
                    disabled={validating || conflict}
                    maxLength={2000}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) => draft(e.target.value, picked)}
                    placeholder="Type in Dutch…"
                    rows={3}
                  />
                </label>
              )}
              <button className="primary words-main-action" disabled={conflict || !given.trim()}>
                Check answer <Check size={17} />
              </button>
            </form>
            <div className="words-help">
              <button disabled={validating || conflict} onClick={() => send('hint')}>
                Hint
              </button>
              <button
                disabled={!audioReady || conflict}
                onClick={() => {
                  if (send('hint')) onSpeak(item.nl);
                }}
              >
                <Volume2 size={15} />
                Listen · hint
              </button>
              <button disabled={validating || conflict} onClick={() => send('reveal')}>
                Show answer
              </button>
              <button disabled={validating || conflict} onClick={() => send('skip')}>
                Skip
              </button>
            </div>
            {s.hinted && <p className="words-hint">Starts with: {item.nl.split(/\s+/)[0]}…</p>}
          </>
        ) : (
          <>
            <div
              className={'words-feedback ' + (feedback.outcome === 'wrong' ? 'needs-work' : '')}
              role="status"
            >
              <b>
                {feedback.outcome === 'correct'
                  ? 'Correct'
                  : feedback.outcome === 'supported'
                    ? 'Correct with help'
                    : feedback.outcome === 'self'
                      ? 'Accepted by you'
                      : 'Compare with the text'}
              </b>
              {feedback.outcome === 'wrong' && feedback.given && (
                <p>
                  Your answer: <span lang="nl">{feedback.given}</span>
                </p>
              )}
              <p className="words-expected" lang="nl">
                {item.nl}
              </p>
              <button
                className="text-action"
                disabled={!audioReady}
                onClick={() => onSpeak(item.nl)}
              >
                <Volume2 size={15} /> Listen
              </button>
              {feedback.outcome === 'wrong' && !!feedback.given && answerMode === 'typing' && (
                <button
                  className="text-action"
                  disabled={validating || conflict}
                  onClick={() => send('accept')}
                >
                  My translation is also correct
                </button>
              )}
            </div>
            <button
              className="primary words-main-action"
              disabled={validating || conflict}
              onClick={() => send('next')}
            >
              {s.index === s.items.length - 1 ? 'Complete round' : 'Next'}
              <ArrowRight size={17} />
            </button>
          </>
        )}
      </section>
    </>
  );
}
