'use client';
import {
  ArrowRight,
  BookOpen,
  Check,
  Lightbulb,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Volume2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { clientData, dataChanged, readJson } from '../../lib/client-data';
import type { AnswerMode } from '../../lib/practice-input';
import { assembleBlocks } from '../../lib/practice-input';
import { learningProgress } from '../../lib/word-progress';
import type { WordAction, WordSession } from '../../lib/words';
import { defaultWordPreferences, wordBuildTokens } from '../../lib/words';
import type { Journal } from '../../lib/words-journal';
import {
  journalAck,
  journalAppend,
  journalBatch,
  journalView,
  restoreJournal,
} from '../../lib/words-journal';
import AnswerModeSwitch from './answer-mode';
import LearningProgress from './learning-progress';
import useWordAudio from './use-word-audio';
type Result = {
  session: WordSession | null;
  revision: number;
  scope?: string;
  total?: number;
  due?: number;
  newCount?: number;
  waitingNew?: number;
  preferences?: Partial<import('../../lib/words').WordPreferences>;
};
export async function wordsRequest(data?: any): Promise<Result> {
  if (!data)
    return readJson(
      '/api/words?timeZone=' +
        encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Amsterdam'),
      true,
    );
  const r = await fetch(
    '/api/words' +
      (data
        ? ''
        : '?timeZone=' +
          encodeURIComponent(
            Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Amsterdam',
          )),
    {
      method: data ? 'POST' : 'GET',
      headers: data ? { 'Content-Type': 'application/json' } : undefined,
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(20000),
    },
  );
  const result: any = await r.json();
  if (!r.ok) {
    const error: any = Error(result.error || 'Practice could not load.');
    error.status = r.status;
    throw error;
  }
  dataChanged('/api/words');
  return result;
}
export default function WordsPractice({
  onCollection,
  onChanged,
  onSpeak,
  audioReady = true,
  audioScope = '',
  visible = true,
  request = wordsRequest,
}: {
  onCollection: () => void;
  onChanged: () => void;
  onSpeak: (text: string) => void;
  audioReady?: boolean;
  audioScope?: string;
  visible?: boolean;
  request?: (data?: any) => Promise<Result>;
}) {
  const [validating, setValidating] = useState(true);
  const [data, setData] = useState<Result | null>(null),
    [active, setActive] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false),
    [syncing, setSyncing] = useState(false),
    [conflict, setConflict] = useState(false),
    [answer, setAnswer] = useState(''),
    [picked, setPicked] = useState<number[]>([]),
    [elapsed, setElapsed] = useState(0),
    [summary, setSummary] = useState<WordSession | null>(null);
  const journal = useRef<Journal | null>(null),
    syncLock = useRef(false),
    failed = useRef(false),
    mounted = useRef(true),
    scope = useRef(''),
    seconds = useRef(0),
    lock = useRef(false),
    input = useRef<HTMLInputElement>(null);
  const [buildMode, setBuildMode] = useState<AnswerMode>('blocks'),
    [audioError, setAudioError] = useState(''),
    [preparationWarning, setPreparationWarning] = useState('');
  const resumable = !!data?.session && !data.session.closed && !!data.session.question;
  const session = data?.session,
    q = session?.question,
    unit = session?.units.find((u) => u.id === q?.unitId),
    feedback = session?.feedback,
    tokens = q?.kind === 'build' && unit ? wordBuildTokens(unit.nl, q.id) : [];
  const pronunciation = useWordAudio(audioScope, q?.id || '', visible, setAudioError);
  useEffect(() => setAudioError(''), [q?.id]);
  const audioOptions = { ...defaultWordPreferences, ...data?.preferences, ...session?.preferences };
  const autoRead = !!q && (q.kind === 'intro' || q.direction === 'nl-en' || !!feedback);
  const spokenCard = useRef('');
  useEffect(() => {
    if (
      !visible ||
      !active ||
      busy ||
      conflict ||
      !audioReady ||
      !audioOptions.autoPlayAudio ||
      !autoRead ||
      !unit ||
      !q
    )
      return;
    const key = audioScope + ':' + q.id;
    if (spokenCard.current === key) return;
    spokenCard.current = key;
    if (document.visibilityState === 'visible') pronunciation.autoPlay?.(unit.nl);
  }, [
    visible,
    active,
    busy,
    conflict,
    audioReady,
    audioOptions.autoPlayAudio,
    autoRead,
    q,
    unit,
    pronunciation,
    audioScope,
  ]);
  function retain(j: Journal) {
    if (!scope.current) throw Error('Practice storage is not ready.');
    const key = 'words-journal:' + scope.current;
    if (journal.current && localStorage.getItem(key) !== JSON.stringify(journal.current))
      throw Object.assign(Error('Practice changed in another tab.'), { status: 409 });
    localStorage.setItem(key, JSON.stringify(j));
    journal.current = j;
    setData(journalView(j));
    setPending(j.events.length > 0);
  }
  async function load() {
    setValidating(true);
    const key =
      '/api/words?timeZone=' +
      encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Amsterdam');
    const cached = request === wordsRequest ? clientData.peek<Result>(key) : undefined;
    if (cached) {
      try {
        const saved = localStorage.getItem('words-journal:' + cached.scope);
        setData(saved ? journalView(restoreJournal(saved)) : cached);
        setLoading(false);
      } catch {}
    } else setLoading(true);
    setError('');
    try {
      const result = await request();
      scope.current = result.scope || scope.current;
      let j: Journal = { base: result, events: [] };
      const retained = localStorage.getItem('words-journal:' + scope.current);
      if (retained) j = restoreJournal(retained);
      else {
        const old = localStorage.getItem('words-pending:' + scope.current);
        if (old) {
          const e = JSON.parse(old);
          if (result.session?.id === e.sessionId && result.revision === e.revision) j.events = [e];
          else if (result.session?.id !== e.sessionId || result.revision !== e.revision + 1)
            throw Error(
              'An older unsaved answer needs recovery. It has been retained on this device.',
            ); /* Removed after the migrated journal is safely stored. */
        }
      }
      if (!j.events.length) j = { base: result, events: [] };
      retain(j);
      localStorage.removeItem('words-pending:' + scope.current);
      const view = journalView(j);
      seconds.current = view.session?.elapsed || 0;
      setElapsed(seconds.current);
      setConflict(false);
      failed.current = false;
      if (j.events.length) {
        setActive(!view.session?.closed);
        if (view.session?.closed) setSummary(view.session);
        void sync();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setValidating(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    const timer = setInterval(() => {
      if (journal.current?.events.length && !failed.current) void sync();
    }, 10000);
    const online = () => {
      failed.current = false;
      void sync();
    };
    window.addEventListener('online', online);
    const storage = (e: StorageEvent) => {
      if (
        e.key === 'words-journal:' + scope.current &&
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
        setError(
          'Practice changed in another tab. Continue there, or choose which progress to keep.',
        );
      }
    };
    window.addEventListener('storage', storage);
    const hide = () => {
      if (document.visibilityState === 'hidden') void sync();
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      window.removeEventListener('storage', storage);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);
  async function sync() {
    if (syncLock.current || !journal.current?.events.length) return;
    syncLock.current = true;
    setSyncing(true);
    try {
      if (!journal.current.flight)
        retain({ ...journal.current, flight: journal.current.events.length });
      const sent = structuredClone({
        base: journal.current!.base,
        events: journal.current!.events.slice(0, journal.current!.flight),
      });
      const result = await request(journalBatch(sent));
      const next = journalAck(journal.current!, sent, result);
      retain(next);
      failed.current = false;
      setError('');
      setConflict(false);
      if (!next.events.length) {
        onChanged();
        if (next.base.session?.closed) {
          setSummary(next.base.session);
          setActive(false);
        }
      }
    } catch (e) {
      failed.current = true;
      const err = e as Error & { status?: number };
      setConflict(!!err.status && err.status >= 400 && err.status < 500 && err.status !== 429);
      setError(err.message + ' Answers are saved on this device.');
    } finally {
      syncLock.current = false;
      if (mounted.current) {
        setSyncing(false);
        if (
          !failed.current &&
          journal.current?.events.length &&
          journalView(journal.current).session?.closed
        )
          queueMicrotask(() => void sync());
      }
    }
  }
  useEffect(() => {
    if (!visible) void sync();
  }, [visible]);
  useEffect(() => {
    const changed = (event: Event) => {
      const prefixes = (event as CustomEvent<string[]>).detail;
      if (prefixes?.includes('/api/materials') && !syncLock.current) void load();
    };
    window.addEventListener('dutch-external-data', changed);
    return () => window.removeEventListener('dutch-external-data', changed);
  }, []);
  useEffect(() => {
    if (!visible || !active || !session || session.closed || !session.question) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        seconds.current++;
        setElapsed(seconds.current);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [visible, active, session?.id, session?.closed, !!session?.question]);
  useEffect(() => {
    setAnswer('');
    setPicked([]);
    setBuildMode(session?.algorithm === 2 && q?.kind !== 'build' ? 'typing' : 'blocks');
    if (!q) return;
    try {
      const draft = JSON.parse(
        sessionStorage.getItem(
          'words-letters-v1-draft:' +
            scope.current +
            ':' +
            q.id +
            (session?.algorithm === 2 ? ':' + q.kind : ''),
        ) || 'null',
      );
      if (draft) {
        setBuildMode(draft.mode === 'typing' ? 'typing' : 'blocks');
        setAnswer(typeof draft.answer === 'string' ? draft.answer : '');
        setPicked(
          Array.isArray(draft.picked)
            ? draft.picked.filter((n: any) => Number.isInteger(n) && n >= 0 && n < tokens.length)
            : [],
        );
      }
    } catch {}
    if (q.kind === 'typing') input.current?.focus();
  }, [q?.id, q?.kind]);
  useEffect(() => {
    if (buildMode === 'typing' && !feedback) input.current?.focus();
  }, [buildMode]);
  function draft(text: string, indices: number[], mode: AnswerMode = buildMode) {
    setBuildMode(mode);
    setAnswer(text);
    setPicked(indices);
    if (q)
      try {
        sessionStorage.setItem(
          'words-letters-v1-draft:' +
            scope.current +
            ':' +
            q.id +
            (session?.algorithm === 2 ? ':' + q.kind : ''),
          JSON.stringify({ answer: text, picked: indices, mode }),
        );
      } catch {}
  }
  async function start() {
    if (validating || lock.current || pending) return;
    lock.current = true;
    if (audioReady && audioOptions.autoPlayAudio) pronunciation.unlock?.();
    if (audioOptions.soundEffects) pronunciation.sound?.('tap');
    setBusy(true);
    setError('');
    setPreparationWarning('');
    try {
      const result = await request({
        action: 'start',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Amsterdam',
      });
      const options = {
        ...defaultWordPreferences,
        ...result.preferences,
        ...result.session?.preferences,
      };
      if (audioReady && options.autoPlayAudio && result.session) {
        const missing = await pronunciation.prepare?.(result.session.units.map((u) => u.nl));
        if (missing)
          setPreparationWarning(
            'Some recordings could not be prepared. Use Listen to Dutch to retry.',
          );
      }
      if (!mounted.current) return;
      retain({ base: { ...data, ...result }, events: [] });
      seconds.current = result.session?.elapsed || 0;
      setElapsed(seconds.current);
      setSummary(null);
      setActive(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function send(action: WordAction, text = '') {
    if (validating || lock.current || conflict || !journal.current) return false;
    if (action === 'hint' && journalView(journal.current).session?.question?.hinted) return true;
    lock.current = true;
    try {
      const next = journalAppend(journal.current, action, text, seconds.current);
      retain(next);
      const view = journalView(next);
      if (audioOptions.soundEffects && action === 'answer' && view.session?.feedback) {
        const outcome = view.session.feedback.outcome;
        pronunciation.sound?.(
          outcome === 'correct' || outcome === 'supported' ? 'correct' : 'wrong',
        );
      }
      if (view.session?.closed) {
        setSummary(view.session);
        setActive(false);
        void sync();
      } else if (
        next.events.filter((e) => ['answer', 'continue', 'dontknow', 'skip'].includes(e.action))
          .length >= 5 &&
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
  function recover() {
    if (syncLock.current) return;
    const j = journal.current;
    if (j?.events.length) {
      const blob = new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' }),
        url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = 'dutch-practice-recovery.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
  async function restoreServerProgress() {
    if (
      !confirm(
        'Use the progress saved on the server? Unsynced answers will be kept as a recovery copy on this device.',
      )
    )
      return;
    try {
      if (journal.current?.events.length)
        localStorage.setItem(
          'words-recovery:' + scope.current + ':' + Date.now(),
          JSON.stringify(journal.current),
        );
      localStorage.removeItem('words-journal:' + scope.current);
      journal.current = null;
      setPending(false);
      setActive(false);
      setSummary(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function hear() {
    if (!unit || !audioReady) return;
    if (q?.direction === 'en-nl' && q.kind !== 'intro' && !feedback && !q.hinted && !send('hint'))
      return;
    setAudioError('');
    pronunciation.play(unit.nl);
  }
  function submit() {
    if (!q || busy || conflict) return;
    if (feedback) {
      void send('next');
      return;
    }
    const value =
      q.kind === 'build' && (session?.algorithm === 2 || buildMode === 'blocks')
        ? assembleBlocks(tokens, picked, '')
        : answer;
    if (value.trim()) void send('answer', value);
  }
  const message = error && (
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
            <RotateCcw size={14} />
            Retry sync
          </button>
          {conflict && (
            <>
              <button onClick={recover}>Download local answers</button>
              <button disabled={syncing} onClick={() => void restoreServerProgress()}>
                Use server progress
              </button>
            </>
          )}
        </>
      ) : (
        <button
          disabled={busy}
          onClick={() => {
            setActive(false);
            void load();
          }}
        >
          Reload practice
        </button>
      )}
    </div>
  );

  const emptyPractice = data?.total === 0 && !summary && !pending && !validating;

  if (loading)
    return (
      <div className="lookup-loading">
        <LoaderCircle className="spin" />
        <p>Loading your words…</p>
      </div>
    );
  if (!active)
    return (
      <>
        <div className="section-heading">
          <div>
            <h1>Words</h1>
          </div>
        </div>
        {message}
        <section className="words-start">
          {summary ? (
            <>
              <span className="words-symbol">
                <Check size={28} />
              </span>
              <h2>Session complete</h2>
              <div className="words-stats">
                <span>
                  <b>{summary.correct}</b>Correct
                </span>
                <span>
                  <b>{summary.wrong}</b>To revisit
                </span>
                <span>
                  <b>{summary.supported}</b>With hints
                </span>
              </div>
            </>
          ) : (
            <>
              <span className="words-symbol">
                <BookOpen size={28} />
              </span>
              <h2>{emptyPractice ? 'Your first words await' : 'Daily practice'}</h2>
              <p>
                {emptyPractice
                  ? 'Choose words from your collection to start practising.'
                  : `${data?.preferences?.sessionSize || 10} exercises per round.`}
              </p>
              <div className="words-stats">
                <span>
                  <b>{data?.due || 0}</b>Due today
                </span>
                <span>
                  <b>{data?.newCount || 0}</b>New today
                </span>
              </div>
            </>
          )}
          {emptyPractice ? (
            <button className="primary" onClick={onCollection}>
              <BookOpen size={17} /> Choose words
            </button>
          ) : (
            <button
              className="primary"
              disabled={
                validating ||
                busy ||
                !!pending ||
                !data?.total ||
                (!resumable && !((data?.due || 0) + (data?.newCount || 0)))
              }
              onClick={start}
            >
              {busy ? <LoaderCircle className="spin" size={17} /> : <Play size={17} />}{' '}
              {busy && audioReady && audioOptions.autoPlayAudio
                ? 'Preparing round and audio…'
                : data?.session && !data.session.closed && data.session.question
                  ? 'Resume session'
                  : 'Start Words'}
            </button>
          )}
          {!!data?.total &&
            !pending &&
            !resumable &&
            !((data?.due || 0) + (data?.newCount || 0)) && (
              <p className="words-small">All done for today.</p>
            )}
          {!!data?.waitingNew && <p className="words-small">{data.waitingNew} new words waiting</p>}
          <p className="words-small">
            {pending
              ? syncing
                ? 'Syncing progress…'
                : 'Saved on this device · sync pending'
              : summary
                ? 'Progress synced'
                : (data?.total || 0) + ' entries in practice.'}
          </p>
          {!emptyPractice && (
            <button className="text-action" onClick={onCollection}>
              Choose words from Collection
            </button>
          )}
        </section>
      </>
    );
  if (!session?.question || !unit || !q)
    return (
      <>
        {message}
        <section className="words-start">
          <span className="words-symbol">
            <Check size={28} />
          </span>
          <h2>Session complete</h2>
          <div className="words-stats">
            <span>
              <b>{session?.correct || 0}</b>Correct
            </span>
            <span>
              <b>{session?.wrong || 0}</b>To revisit
            </span>
          </div>
          <button
            className="primary"
            disabled={validating || busy || conflict}
            onClick={() => void send('finish')}
          >
            Finish session
          </button>
        </section>
      </>
    );
  const daily = session.algorithm === 2;
  const expected = q.direction === 'nl-en' ? unit.en : unit.nl;
  return (
    <>
      {message}
      {!daily && (
        <p className="words-small">
          Saved round · previous schedule. Finish this round to use daily reviews.
        </p>
      )}
      <section
        className="words-card"
        aria-label="Word exercise"
        onClickCapture={(event) => {
          if (
            audioOptions.soundEffects &&
            (event.target as HTMLElement).closest('button:not(:disabled)')
          )
            pronunciation.sound?.('tap');
        }}
      >
        <div className="words-top">
          <LearningProgress progress={learningProgress(unit.state, session.day)} />
          <span>
            {Math.min(session.cardLimit || 15, session.turn + (feedback ? 0 : 1))} /{' '}
            {session.cardLimit || 15}
          </span>
          <button disabled={validating || busy || conflict} onClick={() => void send('finish')}>
            Finish
          </button>
        </div>
        {q.kind !== 'intro' && (
          <span className="eyebrow words-direction">
            {q.direction === 'nl-en' ? 'DUTCH → ENGLISH' : 'ENGLISH → DUTCH'}
          </span>
        )}
        <div
          className="words-prompt"
          lang={q.kind === 'intro' || q.direction === 'nl-en' ? 'nl' : 'en'}
        >
          {q.kind === 'intro' ? unit.nl : q.direction === 'nl-en' ? unit.nl : unit.en}
          {(q.kind === 'intro' || q.direction === 'nl-en' || feedback) && (
            <button
              className="icon-button"
              disabled={!audioReady || busy || conflict}
              aria-label={
                pronunciation.state === 'loading'
                  ? 'Cancel audio loading'
                  : pronunciation.state === 'playing'
                    ? 'Pause Dutch audio'
                    : pronunciation.state === 'paused'
                      ? 'Resume Dutch audio'
                      : 'Listen to Dutch'
              }
              aria-busy={pronunciation.state === 'loading'}
              onClick={() => void hear()}
            >
              {pronunciation.state === 'loading' ? (
                <LoaderCircle size={21} className="spin" />
              ) : pronunciation.state === 'playing' ? (
                <Pause size={21} />
              ) : (
                <Volume2 size={21} />
              )}
            </button>
          )}
        </div>
        {(audioError || preparationWarning) && (
          <p className="words-audio-error" role="alert">
            {audioError || preparationWarning}
          </p>
        )}
        {q.kind === 'intro' && (
          <>
            <p className="words-meaning">{unit.en}</p>
            {unit.example && (
              <blockquote lang="nl">
                {unit.example}
                <small>{unit.exampleTranslation}</small>
              </blockquote>
            )}
            {!feedback && (
              <button
                className="primary words-main-action"
                disabled={validating || busy || conflict}
                onClick={() => void send('continue')}
              >
                Continue <ArrowRight size={17} />
              </button>
            )}
            {daily && !feedback && (
              <button
                className="text-action words-known"
                disabled={validating || busy || conflict}
                onClick={() => void send('known')}
              >
                Already know
              </button>
            )}
          </>
        )}
        {q.kind !== 'intro' && !feedback && (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              {daily && q.direction === 'en-nl' && (
                <div className="words-mode-switch" role="group" aria-label="Answer format">
                  {(['typing', 'letters', 'choices'] as const).map((mode) => (
                    <button
                      type="button"
                      key={mode}
                      disabled={validating || busy || conflict}
                      aria-pressed={
                        q.kind ===
                        (mode === 'typing' ? 'typing' : mode === 'letters' ? 'build' : 'choice')
                      }
                      onClick={() => {
                        if (
                          q.kind ===
                          (mode === 'typing' ? 'typing' : mode === 'letters' ? 'build' : 'choice')
                        )
                          return;
                        if (send('mode', mode)) {
                          setAnswer('');
                          setPicked([]);
                        }
                      }}
                    >
                      {mode === 'typing' ? 'Type' : mode === 'letters' ? 'Letters' : 'Choices'}
                    </button>
                  ))}
                </div>
              )}
              {q.kind === 'choice' && (
                <div className="words-options">
                  {q.options.map((option, i) => (
                    <button
                      key={i}
                      type="button"
                      disabled={validating || busy || conflict}
                      onClick={() => void send('answer', option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
              {!daily && q.kind === 'build' && (
                <AnswerModeSwitch
                  value={buildMode}
                  disabled={validating || busy || conflict}
                  onChange={(mode) => draft(answer, picked, mode)}
                />
              )}
              {q.kind === 'build' && (session?.algorithm === 2 || buildMode === 'blocks') && (
                <>
                  <div className="words-built" aria-label="Your Dutch answer">
                    {picked.length ? (
                      picked.map((idx, i) => (
                        <button
                          type="button"
                          key={idx}
                          disabled={validating || busy || conflict}
                          aria-label={
                            'Remove ' +
                            (tokens[idx] === ' ' ? 'space' : tokens[idx]) +
                            ' at position ' +
                            (i + 1)
                          }
                          onClick={() =>
                            draft(
                              answer,
                              picked.filter((_, j) => j !== i),
                            )
                          }
                        >
                          {tokens[idx] === ' ' ? '␣' : tokens[idx]}
                        </button>
                      ))
                    ) : (
                      <span>Tap the letters in order</span>
                    )}
                  </div>
                  <div className="words-bank">
                    {tokens.map((token, i) => (
                      <button
                        type="button"
                        key={i}
                        disabled={busy || conflict || picked.includes(i)}
                        aria-label={'Add ' + (token === ' ' ? 'space' : token) + ' ' + (i + 1)}
                        onClick={() => draft(answer, [...picked, i])}
                      >
                        {token === ' ' ? '␣' : token}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {(q.kind === 'typing' ||
                (q.kind === 'build' && !daily && buildMode === 'typing')) && (
                <label className="words-input">
                  Your Dutch answer
                  <input
                    ref={input}
                    lang="nl"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    value={answer}
                    disabled={validating || busy || conflict}
                    onChange={(e) => draft(e.target.value, picked)}
                    placeholder="Type in Dutch…"
                  />
                </label>
              )}
              {q.kind === 'self' && (
                <div className="words-recall">
                  {!q.hinted && (
                    <button
                      type="button"
                      className="primary words-reveal"
                      disabled={validating || busy || conflict}
                      onClick={() => void send('hint')}
                    >
                      Show meaning
                    </button>
                  )}
                  {q.hinted && (
                    <div className="words-hint">
                      <div className="words-recalled-meaning" lang="en">
                        {unit.en}
                      </div>
                      <div className="rating-buttons">
                        <button
                          type="button"
                          disabled={validating || busy || conflict}
                          onClick={() => void send('dontknow')}
                        >
                          Not yet
                        </button>
                        <button
                          type="button"
                          disabled={validating || busy || conflict}
                          onClick={() => void send('answer', 'yes')}
                        >
                          I recalled it
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {(q.kind === 'build' || q.kind === 'typing') && (
                <button
                  className="primary words-main-action"
                  disabled={
                    busy ||
                    conflict ||
                    (q.kind === 'build' && (session?.algorithm === 2 || buildMode === 'blocks')
                      ? !picked.length
                      : !answer.trim())
                  }
                >
                  Check answer <Check size={17} />
                </button>
              )}
            </form>
            {q.kind !== 'self' && (
              <div className="words-help">
                <button disabled={validating || busy || conflict} onClick={() => void send('hint')}>
                  <Lightbulb size={15} />
                  Hint
                </button>
                <button disabled={!audioReady || busy || conflict} onClick={() => void hear()}>
                  {pronunciation.state === 'loading' ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <Volume2 size={15} />
                  )}
                  Listen{q.direction === 'en-nl' ? ' · hint' : ''}
                </button>
                <button
                  disabled={validating || busy || conflict}
                  onClick={() => void send('dontknow')}
                >
                  I don’t know
                </button>
              </div>
            )}
            {q.hinted && q.kind !== 'self' && (
              <p className="words-hint">
                Starts with: {Array.from(expected).slice(0, 2).join('')}…
              </p>
            )}
            <button
              className="skip"
              disabled={validating || busy || conflict}
              onClick={() => void send('skip')}
            >
              Skip
            </button>
          </>
        )}
        {feedback && daily && <p className="words-next-review">Next review: {unit.state.due}</p>}
        {feedback && q.kind !== 'intro' && (
          <div
            className={'words-feedback ' + (feedback.outcome === 'wrong' ? 'needs-work' : '')}
            role="status"
          >
            <b>
              {feedback.outcome === 'wrong'
                ? 'Let’s compare'
                : feedback.outcome === 'supported'
                  ? 'Correct with help'
                  : feedback.outcome === 'self'
                    ? 'Accepted by you'
                    : 'Correct'}
            </b>
            {feedback.given && feedback.outcome === 'wrong' && <p>Your answer: {feedback.given}</p>}
            <p lang={q.direction === 'en-nl' ? 'nl' : 'en'} className="words-expected">
              {feedback.expected}
            </p>
            {unit.example && <small lang="nl">{unit.example}</small>}
            {feedback.outcome === 'wrong' && (
              <button
                className="text-action"
                disabled={validating || busy || conflict}
                onClick={() => void send('accept')}
              >
                My answer is also correct
              </button>
            )}
          </div>
        )}
        {feedback && (
          <button
            className="primary words-main-action"
            disabled={validating || busy || conflict}
            onClick={() => void send('next')}
          >
            Next <ArrowRight size={17} />
          </button>
        )}
      </section>
    </>
  );
}
