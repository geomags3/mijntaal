import type { WordAction, WordSession } from './words';
import { applyWordAction, newWordAttemptId, wordSessionSchema } from './words';
export type WordsResult = {
  session: WordSession | null;
  revision: number;
  scope?: string;
  total?: number;
  due?: number;
  newCount?: number;
};
export type WordEvent = {
  action: WordAction;
  sessionId: string;
  revision: number;
  attemptId: string;
  questionId?: string;
  answer: string;
  elapsed: number;
};
export type Journal = { base: WordsResult; events: WordEvent[]; flight?: number };
export function journalView(j: Journal): WordsResult {
  let s = j.base.session;
  for (const [i, e] of j.events.entries()) {
    if (
      !s ||
      s.closed ||
      s.id !== e.sessionId ||
      e.revision !== j.base.revision + i ||
      (e.action !== 'finish' && e.questionId !== s.question?.id)
    )
      throw Error('Local practice could not be restored.');
    s = applyWordAction(s, e.action, e.answer, e.elapsed);
  }
  return { ...j.base, session: s, revision: j.base.revision + j.events.length };
}
export function journalAppend(
  j: Journal,
  action: WordAction,
  answer: string,
  elapsed: number,
): Journal {
  const view = journalView(j),
    s = view.session;
  if (j.events.length >= 80) throw Error('Sync this round before continuing.');
  if (!s || s.closed) throw Error('Start a session first.');
  const e: WordEvent = {
    action,
    sessionId: s.id,
    revision: view.revision,
    attemptId: newWordAttemptId(),
    questionId: s.question?.id,
    answer,
    elapsed,
  };
  const next = { ...j, events: [...j.events, e] };
  journalView(next);
  return next;
}
export function journalBatch(j: Journal) {
  return {
    action: 'batch',
    sessionId: j.base.session!.id,
    revision: j.base.revision,
    events: [...j.events],
  };
}
export function journalAck(current: Journal, sent: Journal, result: WordsResult): Journal {
  if (
    result.session?.id !== sent.base.session?.id ||
    result.revision !== sent.base.revision + sent.events.length ||
    current.base.session?.id !== sent.base.session?.id ||
    sent.events.some((e, i) => current.events[i]?.attemptId !== e.attemptId)
  )
    throw Error('Practice changed on another page. Your local answers are retained.');
  const j = {
    base: { ...current.base, ...result },
    events: current.events.slice(sent.events.length),
  };
  journalView(j);
  return j;
}
export function restoreJournal(raw: string): Journal {
  const j = JSON.parse(raw);
  if (
    !j ||
    !j.base ||
    !Number.isInteger(j.base.revision) ||
    !Array.isArray(j.events) ||
    j.events.length > 80 ||
    (j.flight !== undefined &&
      (!Number.isInteger(j.flight) || j.flight < 1 || j.flight > j.events.length))
  )
    throw Error('Invalid local practice.');
  if (
    !wordSessionSchema.nullable().safeParse(j.base.session).success ||
    (j.base.session === null && j.events.length)
  )
    throw Error('Local practice needs recovery.');
  journalView(j);
  return j;
}
