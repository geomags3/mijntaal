'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Clock,
  RefreshCw,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import LessonMarkdown, { LessonInline } from './lesson-markdown';
import { advanceSampleLesson, createSampleLesson } from '../../lib/sample-lesson';
import {
  expectedLessonAnswer,
  isExercise,
  type Exercise,
  type LessonAction,
  type DeleteLessonInput,
  type LessonBlock,
  type LessonRecord,
  type LessonRunSummary,
  type LessonSummary,
  type ProgramRecord,
} from '../../lib/lessons';

async function request<T>(
  url: string,
  input?: LessonAction | DeleteLessonInput,
  method: 'POST' | 'DELETE' = 'POST',
): Promise<T> {
  const r = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
    ...(input
      ? {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }
      : {}),
  });
  const value = (await r.json()) as T & { error?: string };
  if (!r.ok)
    throw Object.assign(Error(value.error || 'Could not load lessons.'), { status: r.status });
  return value;
}
// Seeded order stays stable across reloads, with individual indices for repeated tokens.
function order(length: number, seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    const j = (h >>> 0) % (i + 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}
function Content({ block: b }: { block: LessonBlock }) {
  if (b.type === 'explanation')
    return (
      <div className="lesson-prose">
        {b.heading && (
          <h2>
            <LessonInline text={b.heading} />
          </h2>
        )}
        <LessonMarkdown text={b.text} />
      </div>
    );
  if (b.type === 'table')
    return (
      <figure className="lesson-table">
        <table>
          {b.caption && (
            <caption>
              <LessonInline text={b.caption} />
            </caption>
          )}
          <thead>
            <tr>
              {b.columns.map((c, i) => (
                <th scope="col" key={i}>
                  <LessonInline text={c} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>
                    <LessonInline text={c} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </figure>
    );
  if (b.type === 'diagram')
    return (
      <figure>
        {b.caption && (
          <figcaption>
            <LessonInline text={b.caption} />
          </figcaption>
        )}
        <ol className="lesson-diagram">
          {b.steps.map((s, i) => (
            <li key={i}>
              <span>{i + 1}</span>
              <LessonInline text={s} />
            </li>
          ))}
        </ol>
      </figure>
    );
  if (b.type === 'image')
    return (
      <figure className="lesson-image">
        {/* Authored images use external HTTPS URLs without sending referrers. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={b.url}
          alt={b.alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(e) => {
            e.currentTarget.alt = `Image unavailable: ${b.alt}`;
          }}
        />
        {b.caption && (
          <figcaption>
            <LessonInline text={b.caption} />
          </figcaption>
        )}
      </figure>
    );
  return null;
}
function ExerciseView({
  block: b,
  lesson,
  busy,
  send,
}: {
  block: Exercise;
  lesson: LessonRecord;
  busy: boolean;
  send: (action: LessonAction['action'], fields?: Partial<LessonAction>) => void;
}) {
  const p = lesson.progress!,
    feedback = p.feedback;
  const [text, setText] = useState(''),
    [tokens, setTokens] = useState<number[]>([]),
    [pairs, setPairs] = useState<number[]>(b.type === 'match' ? b.pairs.map(() => -1) : []),
    [left, setLeft] = useState<number | null>(null);
  const disabled = busy || !!feedback;
  const seed = p.runId + b.id;
  const check = () =>
    send('check', {
      answer:
        b.type === 'match' ? pairs : b.type === 'words' || b.type === 'letters' ? tokens : text,
    });
  const ready =
    b.type === 'match'
      ? pairs.every((n) => n >= 0)
      : b.type === 'words' || b.type === 'letters'
        ? tokens.length === b.tokens.length
        : !!text.trim();
  return (
    <div className="lesson-exercise">
      <span className="eyebrow">
        {b.type === 'flashcard'
          ? 'FLASHCARD · SELF-ASSESSMENT'
          : b.type === 'match'
            ? 'MATCH THE PAIRS'
            : b.type === 'gap'
              ? 'FILL THE GAP'
              : b.type === 'words'
                ? 'BUILD A SENTENCE'
                : b.type === 'letters'
                  ? 'BUILD THE WORD'
                  : 'CHOOSE AN ANSWER'}
      </span>
      <h2>
        <LessonInline text={b.prompt} />
      </h2>
      {b.type === 'gap' && (
        <p className="lesson-gap" lang="nl">
          {b.sentence.split('___')[0]}
          <span className="lesson-gap-blank" role="img" aria-label="missing word">
            …
          </span>
          {b.sentence.split('___')[1]}
        </p>
      )}
      {b.type === 'flashcard' ? (
        <div className="lesson-flashcard">
          {p.revealed ? (
            <>
              <p lang="nl">{b.answer}</p>
              {!feedback && (
                <div className="lesson-actions">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => send('rate', { recalled: true })}
                  >
                    I recalled it
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => send('rate', { recalled: false })}
                  >
                    Not yet
                  </button>
                </div>
              )}
            </>
          ) : (
            <button className="primary" disabled={busy} onClick={() => send('reveal')}>
              Show answer
            </button>
          )}
        </div>
      ) : !feedback ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && !disabled) check();
          }}
        >
          {(b.type === 'choice' || (b.type === 'gap' && b.options)) && (
            <fieldset
              className={'lesson-options' + (b.type === 'gap' ? ' lesson-gap-options' : '')}
              disabled={disabled}
            >
              <legend className="sr-only">
                {b.type === 'gap' ? 'Choose the missing word' : 'Choose your answer'}
              </legend>
              {order(b.type === 'choice' ? b.options.length : b.options!.length, seed).map((i) => {
                const label = b.options![i],
                  value = b.type === 'choice' ? String(i) : label;
                return (
                  <label className={text === value ? 'selected' : ''} key={i}>
                    <input
                      type="radio"
                      name={b.id}
                      value={value}
                      checked={text === value}
                      onChange={() => setText(value)}
                    />
                    <span>{label}</span>
                  </label>
                );
              })}
            </fieldset>
          )}
          {b.type === 'gap' && !b.options && (
            <label className="lesson-input">
              Missing Dutch word or phrase
              <input
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                lang="nl"
                value={text}
                disabled={disabled}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
          )}
          {(b.type === 'words' || b.type === 'letters') && (
            <>
              <div
                className={'lesson-built ' + (b.type === 'letters' ? 'letters' : '')}
                aria-label="Your answer"
              >
                {tokens.length ? (
                  tokens.map((n, i) => (
                    <button
                      type="button"
                      key={n}
                      disabled={disabled}
                      aria-label={`Remove ${b.tokens[n] === ' ' ? 'space' : b.tokens[n]}`}
                      onClick={() => setTokens((v) => v.filter((_, j) => j !== i))}
                    >
                      {b.tokens[n] === ' ' ? '␣' : b.tokens[n]}
                    </button>
                  ))
                ) : (
                  <span className="lesson-muted">Tap the blocks in order</span>
                )}
              </div>
              <div className="lesson-tokens" aria-label="Available blocks">
                {order(b.tokens.length, seed).map((n) => (
                  <button
                    type="button"
                    key={n}
                    disabled={disabled || tokens.includes(n)}
                    aria-label={b.tokens[n] === ' ' ? 'Space' : b.tokens[n]}
                    onClick={() => setTokens((v) => [...v, n])}
                  >
                    {b.tokens[n] === ' ' ? '␣' : b.tokens[n]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="lesson-text-button"
                disabled={disabled || !tokens.length}
                onClick={() => setTokens([])}
              >
                Clear answer
              </button>
            </>
          )}
          {b.type === 'match' && (
            <>
              <p className="lesson-muted">
                Choose an item on the left, then its match on the right.
              </p>
              <div className="lesson-matching">
                <div aria-label="Left items">
                  {b.pairs.map((pair, i) => (
                    <button
                      type="button"
                      key={i}
                      disabled={disabled}
                      aria-label={`Item ${i + 1}: ${pair.left}`}
                      aria-pressed={left === i}
                      className={(left === i ? 'selected ' : '') + (pairs[i] >= 0 ? 'paired' : '')}
                      onClick={() => setLeft(i)}
                    >
                      <span className="lesson-pair-number">{i + 1}</span>
                      {pair.left}
                      {pairs[i] >= 0 && (
                        <span className="lesson-pair-number" aria-label="Paired">
                          ✓
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <div aria-label="Right items">
                  {order(b.pairs.length, seed).map((i) => (
                    <button
                      type="button"
                      key={i}
                      disabled={disabled || left === null}
                      aria-label={
                        pairs.includes(i)
                          ? `${b.pairs[i].right}, paired with item ${pairs.indexOf(i) + 1}`
                          : b.pairs[i].right
                      }
                      className={pairs.includes(i) ? 'paired' : ''}
                      onClick={() => {
                        setPairs((v) => v.map((n, j) => (j === left ? i : n === i ? -1 : n)));
                        setLeft(null);
                      }}
                    >
                      {pairs.includes(i) && (
                        <span className="lesson-pair-number">{pairs.indexOf(i) + 1}</span>
                      )}
                      {b.pairs[i].right}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="lesson-text-button"
                disabled={disabled}
                onClick={() => {
                  setPairs(b.pairs.map(() => -1));
                  setLeft(null);
                }}
              >
                Clear pairs
              </button>
            </>
          )}
          {!feedback && (
            <button type="submit" className="primary" disabled={disabled || !ready}>
              Check answer
            </button>
          )}
        </form>
      ) : null}
      {b.hint &&
        !feedback &&
        (p.hinted ? (
          <p className="lesson-hint" role="status">
            <LessonInline text={b.hint} />
          </p>
        ) : (
          <button className="lesson-text-button" disabled={busy} onClick={() => send('hint')}>
            Show hint
          </button>
        ))}
      {feedback && (
        <div
          className={'lesson-feedback ' + (feedback.correct ? 'correct' : 'incorrect')}
          role="status"
        >
          <h3>
            {feedback.selfAssessed
              ? feedback.correct
                ? 'Recalled · self-assessed'
                : 'To revisit · self-assessed'
              : feedback.correct
                ? feedback.helped
                  ? 'Correct · with help'
                  : 'Correct'
                : 'To revisit'}
          </h3>
          {!feedback.selfAssessed && (
            <p>
              <strong>Your answer:</strong> {feedback.answer}
            </p>
          )}
          {!feedback.correct && (
            <>
              <p>
                <strong>Expected:</strong> {expectedLessonAnswer(b)}
              </p>
            </>
          )}
          <LessonMarkdown text={b.explanation} />
        </div>
      )}
    </div>
  );
}
function LessonConfirmation({
  kind,
  title,
  onCancel,
  onConfirm,
  cancelRef,
  sample = false,
}: {
  kind: 'restart' | 'delete';
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
  cancelRef: RefObject<HTMLButtonElement | null>;
  sample?: boolean;
}) {
  return (
    <div
      className={'lesson-confirmation ' + (kind === 'delete' ? 'lesson-delete-confirm' : '')}
      role="group"
      aria-labelledby={'lesson-' + kind + '-title'}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <h2 id={'lesson-' + kind + '-title'}>
        {kind === 'delete' ? 'Permanently delete this lesson?' : 'Start this lesson over?'}
      </h2>
      {kind === 'delete' ? (
        <>
          <p>
            <strong>{title}</strong>
          </p>
          <p>
            This permanently removes the lesson, all saved progress and previous runs. It cannot be
            undone.
          </p>
        </>
      ) : sample ? (
        <p>
          You’ll start the sample again at step 1. Sample progress is not saved to your account.
        </p>
      ) : (
        <p>
          You’ll start at step 1 of the latest lesson. Your current run and checked answers will
          stay in Previous runs.
        </p>
      )}
      <div className="lesson-actions">
        <button className="secondary" ref={cancelRef} onClick={onCancel}>
          {kind === 'delete' ? 'Keep lesson' : 'Keep learning'}
        </button>
        <button
          className={'primary' + (kind === 'delete' ? ' danger-button' : '')}
          onClick={onConfirm}
        >
          {kind === 'delete' ? (
            <Trash2 size={16} aria-hidden="true" />
          ) : (
            <RotateCcw size={16} aria-hidden="true" />
          )}{' '}
          {kind === 'delete' ? 'Delete permanently' : 'Start over'}
        </button>
      </div>
    </div>
  );
}
export default function Lessons({ visible }: { visible: boolean }) {
  const [programs, setPrograms] = useState<ProgramRecord[]>([]),
    [lessons, setLessons] = useState<LessonSummary[]>([]),
    [programId, setProgramId] = useState('all'),
    [topicId, setTopicId] = useState('all'),
    [query, setQuery] = useState('');
  const [lesson, setLesson] = useState<LessonRecord | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [conflict, setConflict] = useState(false),
    [pending, setPending] = useState<LessonAction | null>(null),
    [restartConfirm, setRestartConfirm] = useState(false),
    [deleteConfirm, setDeleteConfirm] = useState(false),
    [pendingDelete, setPendingDelete] = useState<DeleteLessonInput | null>(null);
  const [sample, setSample] = useState(false);
  const sequence = useRef(0),
    locked = useRef(false),
    heading = useRef<HTMLHeadingElement>(null),
    restartButton = useRef<HTMLButtonElement>(null),
    deleteButton = useRef<HTMLButtonElement>(null),
    restartCancel = useRef<HTMLButtonElement>(null);
  const [history, setHistory] = useState<LessonRunSummary[] | null>(null);
  const lessonId = lesson?.id;
  useEffect(() => {
    if (!visible || sample) return;
    let active = true;
    const refresh = () => {
      const seq = sequence.current;
      void Promise.all([
        request<ProgramRecord[]>('/api/programs'),
        request<LessonSummary[]>('/api/lessons'),
      ])
        .then(([p, l]) => {
          if (active && sequence.current === seq) {
            setPrograms(p);
            setLessons(l);
          }
        })
        .catch((e) => {
          if (active && sequence.current === seq) setError(e.message);
        });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, [visible, lesson?.progress?.completed, sample]);
  useEffect(() => {
    if (visible) heading.current?.focus();
  }, [visible, lessonId, lesson?.progress?.index, lesson?.progress?.runId]);
  useEffect(() => {
    if (visible && (restartConfirm || deleteConfirm)) restartCancel.current?.focus();
  }, [visible, restartConfirm, deleteConfirm]);
  async function open(id: string) {
    setSample(false);
    const seq = ++sequence.current;
    setLoading(true);
    setError('');
    setHistory(null);
    setRestartConfirm(false);
    setDeleteConfirm(false);
    try {
      const value = await request<LessonRecord>('/api/lessons?id=' + encodeURIComponent(id));
      if (sequence.current === seq) {
        setLesson(value);
        setPending(null);
        setPendingDelete(null);
        setConflict(false);
      }
    } catch (e) {
      if (sequence.current === seq) {
        if ((e as { status?: number }).status === 404) {
          setLesson(null);
          setPending(null);
          setPendingDelete(null);
          setConflict(false);
          setLessons((items) => items.filter((item) => item.id !== id));
          setError('This lesson has already been deleted.');
        } else setError((e as Error).message);
      }
    } finally {
      if (sequence.current === seq) setLoading(false);
    }
  }
  async function submit(a: LessonAction) {
    if (locked.current) return;
    sequence.current++;
    locked.current = true;
    setBusy(true);
    setError('');
    setPending(a);
    try {
      const value =
        sample && lesson
          ? advanceSampleLesson(lesson, a)
          : await request<LessonRecord>('/api/lessons', a);
      setLesson(value);
      setPending(null);
      setConflict(false);
      setHistory(null);
      const progress = value.progress;
      if (!sample)
        setLessons((items) =>
          items.map((item) =>
            item.id === value.id
              ? {
                  ...item,
                  version: value.version,
                  progress: progress
                    ? {
                        completed: progress.completed,
                        index: progress.index,
                        total: progress.content.blocks.length,
                        lessonVersion: progress.lessonVersion,
                      }
                    : null,
                }
              : item,
          ),
        );
    } catch (e) {
      if (sample) setPending(null);
      setError((e as Error).message);
      setConflict((e as { status?: number }).status === 409);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  function send(action: LessonAction['action'], fields: Partial<LessonAction> = {}) {
    if (!lesson || pending || pendingDelete || locked.current) return;
    void submit({
      ...fields,
      action,
      lessonId: lesson.id,
      revision: lesson.revision,
      eventId: crypto.randomUUID(),
    });
  }
  async function remove(input: DeleteLessonInput) {
    if (locked.current || sample) return;
    sequence.current++;
    locked.current = true;
    setBusy(true);
    setError('');
    setPendingDelete(input);
    try {
      await request('/api/lessons', input, 'DELETE');
      setLesson(null);
      setHistory(null);
      setRestartConfirm(false);
      setDeleteConfirm(false);
      setPendingDelete(null);
      setConflict(false);
      setLessons((items) => items.filter((item) => item.id !== input.id));
    } catch (e) {
      setError((e as Error).message);
      setConflict((e as { status?: number }).status === 409);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const blocked = busy || !!pending || !!pendingDelete || loading;
  function exploreSample() {
    if (blocked) return;
    sequence.current++;
    const initial = createSampleLesson();
    setSample(true);
    setLesson(
      advanceSampleLesson(initial, {
        action: 'start',
        lessonId: initial.id,
        revision: 0,
        eventId: crypto.randomUUID(),
      }),
    );
    setError('');
    setHistory(null);
    setRestartConfirm(false);
    setDeleteConfirm(false);
  }
  const p = lesson?.progress,
    block = p?.content.blocks[p.index],
    selectedProgram = programs.find((x) => x.id === programId);
  const filtered = lessons.filter(
    (l) =>
      (programId === 'all'
        ? !l.programId || programs.some((p) => p.id === l.programId)
        : programId === 'standalone'
          ? !l.programId
          : l.programId === programId) &&
      (topicId === 'all' || l.topicId === topicId) &&
      (l.title + ' ' + l.description).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  if (selectedProgram) {
    const topicOrder = (id: string | null) => {
      const index = selectedProgram.content.topics.findIndex((t) => t.id === id);
      return index < 0 ? selectedProgram.content.topics.length : index;
    };
    filtered.sort((a, b) => topicOrder(a.topicId) - topicOrder(b.topicId) || a.order - b.order);
  }
  return (
    <section className="lessons-view" aria-label="Lessons">
      <div className="section-heading">
        <div>
          <span className="eyebrow">LEARN STEP BY STEP</span>
          <h1 ref={heading} tabIndex={-1}>
            {lesson ? p?.content.title || lesson.content.title : 'Lessons'}
          </h1>
          <p>
            <LessonInline
              text={
                lesson
                  ? p?.content.goal || lesson.content.goal
                  : 'Small lessons. Clear explanations. A little more Dutch.'
              }
            />
          </p>
        </div>
      </div>
      {error && (
        <div className="alert" role="alert">
          <p>{error}</p>
          {pending || pendingDelete ? (
            conflict ? (
              <button
                className="secondary"
                disabled={busy || loading}
                onClick={() => lesson && void open(lesson.id)}
              >
                {pendingDelete ? 'Reload latest lesson' : 'Reload saved progress'}
              </button>
            ) : (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  if (pendingDelete) void remove(pendingDelete);
                  else if (pending) void submit(pending);
                }}
              >
                {pendingDelete ? 'Retry deletion' : 'Retry saving'}
              </button>
            )
          ) : (
            <button className="secondary" onClick={() => window.location.reload()}>
              Reload
            </button>
          )}
          <p className="lesson-muted">
            {pendingDelete ? (
              conflict ? (
                'Reload the lesson, then confirm deletion again.'
              ) : (
                'Deletion could not be confirmed. Keep this page open to retry.'
              )
            ) : (
              <>
                Only saved steps can be resumed on another device.
                {pending && ' Keep this page open to retry your pending action.'}
              </>
            )}
          </p>
        </div>
      )}
      {loading && <p role="status">Loading lesson…</p>}
      {busy && pendingDelete && <p role="status">Deleting lesson…</p>}
      {lesson ? (
        <>
          <div className="lesson-navigation">
            <button
              className="lesson-text-button"
              disabled={blocked}
              onClick={() => {
                sequence.current++;
                setLesson(null);
                setSample(false);
                setHistory(null);
                setError('');
                setRestartConfirm(false);
                setDeleteConfirm(false);
              }}
            >
              <ArrowLeft size={16} aria-hidden="true" /> All lessons
            </button>
            <div className="lesson-management-actions">
              {p && !p.completed && !lesson.archived && (
                <button
                  className="lesson-text-button"
                  ref={restartButton}
                  disabled={blocked || deleteConfirm}
                  onClick={() => setRestartConfirm(true)}
                >
                  <RotateCcw size={16} aria-hidden="true" /> Start over
                </button>
              )}
              {!sample && (
                <button
                  className="lesson-text-button lesson-delete-button"
                  ref={deleteButton}
                  disabled={blocked || restartConfirm}
                  onClick={() => setDeleteConfirm(true)}
                >
                  <Trash2 size={16} aria-hidden="true" /> Delete lesson
                </button>
              )}
            </div>
          </div>
          {(deleteConfirm || (restartConfirm && p)) && !blocked && (
            <LessonConfirmation
              kind={deleteConfirm ? 'delete' : 'restart'}
              title={lesson.content.title}
              cancelRef={restartCancel}
              sample={sample}
              onCancel={() => {
                setRestartConfirm(false);
                setDeleteConfirm(false);
                (
                  (deleteConfirm ? deleteButton.current : restartButton.current) || heading.current
                )?.focus();
              }}
              onConfirm={() => {
                setRestartConfirm(false);
                if (deleteConfirm) {
                  setDeleteConfirm(false);
                  void remove({
                    id: lesson.id,
                    version: lesson.version,
                    revision: lesson.revision,
                    confirm: true,
                  });
                } else send('restart');
              }}
            />
          )}
          {sample && (
            <p className="lesson-hint" role="status">
              Sample lesson · Progress stays on this page and is not saved to your account. Nothing
              is added to your library.
            </p>
          )}
          {p && p.lessonVersion !== lesson.version && (
            <p className="lesson-hint">
              This run uses version {p.lessonVersion}. A newer lesson is available; your saved run
              keeps its original content.
            </p>
          )}
          {!p ? (
            <article className="lesson-card">
              <p>
                <LessonInline text={lesson.content.description} />
              </p>
              <p className="lesson-muted">
                <Clock size={16} aria-hidden="true" /> About {lesson.content.minutes} minutes ·{' '}
                {lesson.content.blocks.length} steps
                {lesson.content.level && ` · ${lesson.content.level}`}
              </p>
              <button
                className="primary"
                disabled={blocked || deleteConfirm || lesson.archived}
                onClick={() => send('start')}
              >
                Start lesson <ArrowRight size={16} aria-hidden="true" />
              </button>
            </article>
          ) : p.completed ? (
            <article className="lesson-card lesson-summary">
              <Check size={28} aria-hidden="true" />
              <h2>Lesson complete</h2>
              <p>Completion is a step forward. Keep practising to make it stick.</p>
              <div className="lesson-results">
                <p>
                  <strong>
                    {p.results.filter((r) => r.correct && !r.helped && !r.selfAssessed).length}
                  </strong>{' '}
                  independently correct
                </p>
                <p>
                  <strong>{p.results.filter((r) => r.selfAssessed && r.correct).length}</strong>{' '}
                  recalled · self-assessed
                </p>
                <p>
                  <strong>{p.results.filter((r) => !r.correct || r.helped).length}</strong> to
                  revisit or with help
                </p>
              </div>
              {p.results
                .filter((r) => !r.correct || r.helped)
                .map((r) => {
                  const b = p.content.blocks.find((b) => b.id === r.blockId);
                  return b && isExercise(b) ? (
                    <div className="lesson-review" key={r.blockId}>
                      <h3>
                        <LessonInline text={b.prompt} />
                      </h3>
                      <p>
                        <strong>Your answer:</strong> {r.answer}
                      </p>
                      <p>
                        <strong>Expected:</strong> {expectedLessonAnswer(b)}
                      </p>
                      <LessonMarkdown text={b.explanation} />
                    </div>
                  ) : null;
                })}
              <div className="lesson-actions">
                <button
                  className="secondary"
                  disabled={
                    blocked || deleteConfirm || !p.results.some((r) => !r.correct || r.helped)
                  }
                  onClick={() => send('retry')}
                >
                  Practise mistakes
                </button>
                <button
                  className="primary"
                  ref={restartButton}
                  disabled={blocked || deleteConfirm}
                  onClick={() => send('restart')}
                >
                  {sample ? 'Try sample again' : 'Start latest lesson again'}
                </button>
              </div>
            </article>
          ) : (
            block && (
              <article className="lesson-card" aria-busy={busy}>
                <div className="lesson-step">
                  <span>
                    Step {p.index + 1} of {p.content.blocks.length}
                  </span>
                  <span>
                    {sample
                      ? 'Sample · not saved'
                      : busy
                        ? 'Saving…'
                        : pending
                          ? 'Not saved'
                          : 'Progress saved'}
                  </span>
                </div>
                <progress
                  max={p.content.blocks.length}
                  value={p.index}
                  aria-label="Lesson progress"
                />
                {isExercise(block) ? (
                  <ExerciseView
                    key={p.runId + ':' + p.index}
                    block={block}
                    lesson={lesson}
                    busy={blocked || restartConfirm || deleteConfirm}
                    send={send}
                  />
                ) : (
                  <Content block={block} />
                )}
                {(!isExercise(block) || p.feedback) && (
                  <button
                    className="primary lesson-continue"
                    disabled={blocked || restartConfirm || deleteConfirm}
                    onClick={() => send('continue')}
                  >
                    {p.index === p.content.blocks.length - 1 ? 'Finish lesson' : 'Continue'}
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                )}
              </article>
            )
          )}
          {p && !sample && (
            <div className="lesson-run-history">
              <button
                className="lesson-text-button"
                disabled={blocked}
                onClick={() => {
                  const seq = sequence.current;
                  void request<LessonRunSummary[]>('/api/lessons?id=' + lesson.id + '&history=true')
                    .then((value) => {
                      if (seq === sequence.current) setHistory(value);
                    })
                    .catch((e) => {
                      if (seq === sequence.current) setError(e.message);
                    });
                }}
              >
                Previous runs
              </button>
              {history &&
                (history.length ? (
                  <ul className="lesson-history">
                    {history.map((run) => (
                      <li key={run.id}>
                        {run.finished ? 'Completed' : 'Restarted'} · Version {run.lesson_version} ·{' '}
                        {new Date(run.completed).toLocaleDateString()} · {run.correct}/{run.total}{' '}
                        independently correct
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="lesson-muted">No previous runs yet.</p>
                ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="lesson-filters">
            <label>
              Program
              <select
                value={programId}
                onChange={(e) => {
                  setProgramId(e.target.value);
                  setTopicId('all');
                }}
              >
                <option value="all">All programs and lessons</option>
                <option value="standalone">Standalone lessons</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.content.title}
                  </option>
                ))}
              </select>
            </label>
            {selectedProgram && (
              <label>
                Topic
                <select value={topicId} onChange={(e) => setTopicId(e.target.value)}>
                  <option value="all">All topics</option>
                  {selectedProgram.content.topics.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Find a lesson
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search lessons"
              />
            </label>
          </div>
          {selectedProgram && (
            <div className="lesson-program">
              <h2>{selectedProgram.content.title}</h2>
              <p>{selectedProgram.content.description}</p>
              <p className="lesson-muted">
                {
                  lessons.filter((l) => l.programId === selectedProgram.id && l.progress?.completed)
                    .length
                }{' '}
                of {lessons.filter((l) => l.programId === selectedProgram.id).length} lessons
                completed{selectedProgram.content.level && ` · ${selectedProgram.content.level}`}
              </p>
              {topicId !== 'all' && (
                <p>{selectedProgram.content.topics.find((t) => t.id === topicId)?.description}</p>
              )}
            </div>
          )}
          {!filtered.length && (
            <div className="lesson-empty">
              <BookOpen size={34} aria-hidden="true" />
              <h2>
                {lessons.length
                  ? 'No matching lessons'
                  : 'Your next lesson starts with a conversation'}
              </h2>
              <p>
                {lessons.length
                  ? 'Try another topic or search.'
                  : 'Ask ChatGPT to create a Dutch lesson or a complete program, then save it to @MijnTaal.'}
              </p>
              {!lessons.length && (
                <blockquote>
                  “Create a short A1 lesson about Dutch word order, with examples and interactive
                  exercises, and save it to @MijnTaal.”
                </blockquote>
              )}
              {!lessons.length && (
                <button
                  className="secondary lesson-sample-action"
                  disabled={blocked}
                  onClick={exploreSample}
                >
                  Explore a sample lesson
                </button>
              )}
            </div>
          )}
          <div className="lesson-library">
            {filtered.map((l) => (
              <article className="lesson-library-card" key={l.id}>
                <button
                  className="lesson-card-open"
                  disabled={loading}
                  onClick={() => void open(l.id)}
                >
                  <span className="eyebrow">
                    {l.programId
                      ? programs.find((p) => p.id === l.programId)?.content.title
                      : 'STANDALONE'}
                    {l.topicId &&
                      ` · ${programs.find((p) => p.id === l.programId)?.content.topics.find((t) => t.id === l.topicId)?.title || ''}`}
                  </span>
                  <h2>{l.title}</h2>
                  <p>{l.description}</p>
                  <span className="lesson-muted">
                    {l.level && `${l.level} · `}
                    {l.minutes} min
                  </span>
                  <span className="lesson-card-status">
                    {l.progress?.completed ? (
                      <>
                        <Check size={16} /> Completed
                      </>
                    ) : l.progress ? (
                      <>
                        Continue · {l.progress.index + 1}/{l.progress.total}
                      </>
                    ) : (
                      <>
                        Start lesson <ArrowRight size={16} />
                      </>
                    )}
                  </span>
                </button>
              </article>
            ))}
          </div>
          <button
            className="lesson-text-button"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              setError('');
              void Promise.all([
                request<ProgramRecord[]>('/api/programs'),
                request<LessonSummary[]>('/api/lessons'),
              ])
                .then(([p, l]) => {
                  setPrograms(p);
                  setLessons(l);
                })
                .catch((e) => setError(e.message))
                .finally(() => setLoading(false));
            }}
          >
            <RefreshCw size={16} aria-hidden="true" /> Refresh lessons
          </button>
        </>
      )}
    </section>
  );
}
