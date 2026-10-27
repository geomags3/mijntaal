import { z } from 'zod';
export const sentencePreferencesSchema = z
  .object({ sessionSize: z.number().int().min(1).max(30).default(5) })
  .strict();
export const defaultSentencePreferences = sentencePreferencesSchema.parse({});
export type SentencePreferences = z.infer<typeof sentencePreferencesSchema>;
export const sentenceItemSchema = z
  .object({
    origin: z.enum(['text', 'phrase']).optional(),
    materialId: z.string().max(240).optional(),
    id: z.string().max(100),
    textId: z.string().max(240),
    title: z.string().max(500),
    nl: z.string().min(1).max(1000),
    en: z.string().min(1).max(5000),
    tokens: z.array(z.string()).max(150),
  })
  .strict();
export const sentenceResultSchema = z
  .object({
    given: z.string().max(2000),
    outcome: z.enum(['correct', 'wrong', 'supported', 'self', 'skipped']),
  })
  .strict();
export const sentenceSessionSchema = z
  .object({
    id: z.string().max(100),
    source: z.string().max(240),
    mode: z.enum(['blocks', 'typing']),
    items: z.array(sentenceItemSchema).min(1).max(30),
    index: z.number().int().min(0).max(30),
    hinted: z.boolean(),
    feedback: sentenceResultSchema.nullable(),
    results: z.array(sentenceResultSchema).max(30),
    closed: z.boolean(),
  })
  .strict();
export type SentenceSession = z.infer<typeof sentenceSessionSchema>;
export type SentenceItem = z.infer<typeof sentenceItemSchema>;
export const sentenceEventSchema = z
  .object({
    id: z.string().min(1).max(100),
    action: z.enum(['check', 'hint', 'reveal', 'accept', 'next', 'skip', 'finish']),
    index: z.number().int().min(0).max(30),
    answer: z.string().max(2000).default(''),
  })
  .strict();
export type SentenceEvent = z.infer<typeof sentenceEventSchema>;
export function normalizeSentence(s: string) {
  return s
    .normalize('NFC')
    .toLocaleLowerCase('nl')
    .replace(/[’‘]/g, "'")
    .replace(/[.,!?;:“”"«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function shuffledSentences<T>(items: T[], seed: string) {
  const out = [...items];
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
export function applySentenceEvent(input: SentenceSession, e: SentenceEvent) {
  const s = structuredClone(input);
  if (s.closed || e.index !== s.index) throw Error('This exercise changed.');
  if (e.action === 'finish') {
    if (s.feedback) {
      s.results.push(s.feedback);
      s.feedback = null;
    }
    s.closed = true;
    return s;
  }
  const item = s.items[s.index];
  if (!item) throw Error('Sentence not found.');
  if (e.action === 'next') {
    if (!s.feedback) throw Error('Check your answer first.');
    s.results.push(s.feedback);
    s.feedback = null;
    s.hinted = false;
    s.index++;
    if (s.index >= s.items.length) s.closed = true;
    return s;
  }
  if (e.action === 'accept') {
    if (s.feedback?.outcome !== 'wrong') throw Error('No answer to review.');
    s.feedback.outcome = 'self';
    return s;
  }
  if (s.feedback) throw Error('Continue to the next sentence.');
  if (e.action === 'hint') {
    s.hinted = true;
    return s;
  }
  if (e.action === 'skip') {
    s.feedback = { given: '', outcome: 'skipped' };
    return applySentenceEvent(s, { ...e, action: 'next' });
  }
  if (e.action === 'check' && !e.answer.trim()) throw Error('Add your Dutch answer.');
  s.feedback = {
    given: e.action === 'check' ? e.answer : '',
    outcome:
      e.action === 'reveal'
        ? 'wrong'
        : normalizeSentence(e.answer) === normalizeSentence(item.nl)
          ? s.hinted
            ? 'supported'
            : 'correct'
          : 'wrong',
  };
  return s;
}
export type SentenceBase = { session: SentenceSession | null; revision: number };
export type SentenceJournal = { base: SentenceBase; events: SentenceEvent[]; flight?: number };
export function sentenceView(j: SentenceJournal): SentenceBase {
  let s = j.base.session;
  for (const e of j.events) {
    if (!s) throw Error('Start a round first.');
    s = applySentenceEvent(s, e);
  }
  return { session: s, revision: j.base.revision + j.events.length };
}
export function appendSentence(j: SentenceJournal, e: SentenceEvent) {
  if (j.events.length >= 80) throw Error('Sync this round before continuing.');
  const next = { ...j, events: [...j.events, e] };
  sentenceView(next);
  return next;
}
export function ackSentences(j: SentenceJournal, sent: SentenceJournal, result: SentenceBase) {
  if (
    result.session?.id !== sent.base.session?.id ||
    result.revision !== sent.base.revision + sent.events.length ||
    j.base.session?.id !== sent.base.session?.id ||
    sent.events.some((e, i) => j.events[i]?.id !== e.id)
  )
    throw Object.assign(Error('Practice changed on another page. Local answers are retained.'), {
      status: 409,
    });
  const next = { base: result, events: j.events.slice(sent.events.length) };
  sentenceView(next);
  return next;
}
export function restoreSentences(raw: string): SentenceJournal {
  const j = JSON.parse(raw);
  if (
    !j ||
    !sentenceSessionSchema.nullable().safeParse(j.base?.session).success ||
    (j.base.session === null && j.events?.length)
  )
    throw Error('Local practice needs recovery.');
  if (
    !Number.isInteger(j.base?.revision) ||
    !Array.isArray(j.events) ||
    j.events.length > 80 ||
    j.events.some((e: unknown) => !sentenceEventSchema.safeParse(e).success) ||
    (j.flight !== undefined &&
      (!Number.isInteger(j.flight) || j.flight < 1 || j.flight > j.events.length))
  )
    throw Error('Local practice needs recovery.');
  sentenceView(j);
  return j;
}
export function sentenceScores(s: SentenceSession) {
  const results = [...s.results, ...(s.feedback ? [s.feedback] : [])];
  return {
    correct: results.filter((r) => r.outcome === 'correct').length,
    supported: results.filter((r) => r.outcome === 'supported' || r.outcome === 'self').length,
    wrong: results.filter((r) => r.outcome === 'wrong' || r.outcome === 'skipped').length,
  };
}
