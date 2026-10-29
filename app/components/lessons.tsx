'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, Clock, RefreshCw } from 'lucide-react';
import LessonMarkdown, { LessonInline } from './lesson-markdown';
import {
  expectedLessonAnswer,
  isExercise,
  type Exercise,
  type LessonAction,
  type LessonBlock,
  type LessonRecord,
  type LessonSummary,
  type ProgramRecord,
} from '../../lib/lessons';

async function request<T>(url: string, action?: LessonAction): Promise<T> {
  const r = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
    ...(action
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(action),
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
    [pending, setPending] = useState<LessonAction | null>(null);
  const sequence = useRef(0),
    locked = useRef(false),
    heading = useRef<HTMLHeadingElement>(null);
  const [history, setHistory] = useState<
    | { id: string; lesson_version: number; completed: string; correct: number; total: number }[]
    | null
  >(null);
  const lessonId = lesson?.id;
  useEffect(() => {
    if (!visible) return;
    let active = true;
    const refresh = () => {
      void Promise.all([
        request<ProgramRecord[]>('/api/programs'),
        request<LessonSummary[]>('/api/lessons'),
      ])
        .then(([p, l]) => {
          if (active) {
            setPrograms(p);
            setLessons(l);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, [visible, lesson?.progress?.completed]);
  useEffect(() => {
    if (visible && lessonId) heading.current?.focus();
  }, [visible, lessonId, lesson?.progress?.index, lesson?.progress?.runId]);
  async function open(id: string) {
    const seq = ++sequence.current;
    setLoading(true);
    setError('');
    setHistory(null);
    try {
      const value = await request<LessonRecord>('/api/lessons?id=' + encodeURIComponent(id));
      if (sequence.current === seq) {
        setLesson(value);
        setPending(null);
        setConflict(false);
      }
    } catch (e) {
      if (sequence.current === seq) setError((e as Error).message);
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
      const value = await request<LessonRecord>('/api/lessons', a);
      setLesson(value);
      setPending(null);
      setConflict(false);
      setHistory(null);
    } catch (e) {
      setError((e as Error).message);
      setConflict((e as { status?: number }).status === 409);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  function send(action: LessonAction['action'], fields: Partial<LessonAction> = {}) {
    if (!lesson || pending || locked.current) return;
    void submit({
      ...fields,
      action,
      lessonId: lesson.id,
      revision: lesson.revision,
      eventId: crypto.randomUUID(),
    });
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
          {pending ? (
            conflict ? (
              <button
                className="secondary"
                disabled={busy || loading}
                onClick={() => lesson && void open(lesson.id)}
              >
                Reload saved progress
              </button>
            ) : (
              <button className="secondary" disabled={busy} onClick={() => void submit(pending)}>
                Retry saving
              </button>
            )
          ) : (
            <button className="secondary" onClick={() => window.location.reload()}>
              Reload
            </button>
          )}
          <p className="lesson-muted">
            Only saved steps can be resumed on another device.
            {pending && ' Keep this page open to retry your pending action.'}
          </p>
        </div>
      )}
      {loading && <p role="status">Loading lesson…</p>}
      {lesson ? (
        <>
          <button
            className="lesson-text-button"
            disabled={busy || !!pending || loading}
            onClick={() => {
              sequence.current++;
              setLesson(null);
              setHistory(null);
              setError('');
            }}
          >
            <ArrowLeft size={16} aria-hidden="true" /> All lessons
          </button>
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
                disabled={busy || !!pending || loading || lesson.archived}
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
                  disabled={busy || !!pending || !p.results.some((r) => !r.correct || r.helped)}
                  onClick={() => send('retry')}
                >
                  Practise mistakes
                </button>
                <button
                  className="primary"
                  disabled={busy || !!pending}
                  onClick={() => send('restart')}
                >
                  Start latest lesson again
                </button>
                <button
                  className="lesson-text-button"
                  disabled={busy || !!pending || loading}
                  onClick={() => {
                    const seq = sequence.current;
                    void request<typeof history>('/api/lessons?id=' + lesson.id + '&history=true')
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
              </div>
              {history && (
                <ul className="lesson-history">
                  {history.map((run) => (
                    <li key={run.id}>
                      Version {run.lesson_version} · {new Date(run.completed).toLocaleDateString()}{' '}
                      · {run.correct}/{run.total} independently correct
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ) : (
            block && (
              <article className="lesson-card" aria-busy={busy}>
                <div className="lesson-step">
                  <span>
                    Step {p.index + 1} of {p.content.blocks.length}
                  </span>
                  <span>{busy ? 'Saving…' : pending ? 'Not saved' : 'Progress saved'}</span>
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
                    busy={busy || !!pending || loading}
                    send={send}
                  />
                ) : (
                  <Content block={block} />
                )}
                {(!isExercise(block) || p.feedback) && (
                  <button
                    className="primary lesson-continue"
                    disabled={busy || !!pending || loading}
                    onClick={() => send('continue')}
                  >
                    {p.index === p.content.blocks.length - 1 ? 'Finish lesson' : 'Continue'}
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                )}
              </article>
            )
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
                  : 'Ask ChatGPT to create a Dutch lesson or a complete program, then save it to MijnTaal.'}
              </p>
              {!lessons.length && (
                <blockquote>
                  “Create a short A1 lesson about Dutch word order, with examples and interactive
                  exercises, and save it to MijnTaal.”
                </blockquote>
              )}
            </div>
          )}
          <div className="lesson-library">
            {filtered.map((l) => (
              <button
                className="lesson-library-card"
                key={l.id}
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
