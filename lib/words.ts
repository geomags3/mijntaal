import { z } from 'zod';
import { nounParts } from './noun-article';
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  short = z.string().max(2000);
export const wordStateSchema = z
  .object({
    contentKey: z.string().max(100),
    stage: z.enum(['intro', 'recognize', 'build', 'recall', 'review']),
    recognizedNL: z.boolean(),
    recognizedEN: z.boolean(),
    interval: z.number().int().min(-1).max(5),
    due: day,
    lastSuccessDay: day.nullable(),
    failedDay: day.nullable(),
    recovering: z.boolean(),
    intervalDays: z.number().int().min(1).max(60).optional(),
    lastSeenDay: day.optional(),
    introducedDay: day.optional(),
  })
  .strict();
export const wordUnitSchema = z
  .object({
    id: z.string().min(1).max(240),
    nl: short,
    en: short,
    example: short,
    exampleTranslation: short,
    partOfSpeech: z.string().max(100),
    lemma: z.string().max(500),
    alternatives: z.array(short).max(8),
    state: wordStateSchema,
    attempts: z.number().int().min(0).max(6),
    misses: z.number().int().min(0).max(3),
    availableAt: z.number().int().min(0),
    done: z.boolean(),
    skipped: z.boolean(),
    retryPending: z.boolean().optional(),
    introDelay: z.number().int().min(0).max(2).optional(),
  })
  .strict();
export const wordQuestionSchema = z
  .object({
    id: z.string().max(300),
    unitId: z.string().max(240),
    kind: z.enum(['intro', 'choice', 'build', 'typing', 'self']),
    direction: z.enum(['nl-en', 'en-nl']),
    options: z.array(short).max(4),
    tokens: z.array(short).max(120),
    hinted: z.boolean(),
    maxHelp: z.number().int().min(0).max(2).optional(),
    knownCheck: z.boolean().optional(),
  })
  .strict();
export const wordFeedbackSchema = z
  .object({
    outcome: z.enum(['correct', 'wrong', 'supported', 'seen', 'self']),
    expected: short,
    given: short,
    message: z.string().max(1000),
    previousState: wordStateSchema.optional(),
  })
  .strict();
export const wordPreferencesSchema = z
  .object({
    sessionSize: z.number().int().min(1).max(30).default(10),
    newWordsPerDay: z.number().int().min(0).max(100).default(10),
    answerMode: z.enum(['auto', 'typing', 'letters', 'choices']).default('auto'),
    repeatMistakes: z.boolean().default(true),
    autoPlayAudio: z.boolean().default(true),
    soundEffects: z.boolean().default(true),
  })
  .strict();
export const defaultWordPreferences = wordPreferencesSchema.parse({});
export type WordPreferences = z.infer<typeof wordPreferencesSchema>;
const distractorSchema = wordUnitSchema.pick({
  id: true,
  nl: true,
  en: true,
  lemma: true,
  partOfSpeech: true,
  alternatives: true,
});
export const wordSessionSchema = z
  .object({
    id: z.string().min(1).max(100),
    day,
    timeZone: z.string().max(100),
    units: z.array(wordUnitSchema).max(40),
    turn: z.number().int().min(0).max(500),
    cardLimit: z.number().int().min(1).max(30).optional(),
    question: wordQuestionSchema.nullable(),
    feedback: wordFeedbackSchema.nullable(),
    closed: z.boolean(),
    elapsed: z.number().int().min(0).max(86400),
    correct: z.number().int().min(0),
    wrong: z.number().int().min(0),
    supported: z.number().int().min(0),
    algorithm: z.literal(2).optional(),
    // Opt in per session so previously saved journals keep their original transitions.
    introPractice: z.literal(true).optional(),
    preferences: wordPreferencesSchema.optional(),
    choicePool: z.array(distractorSchema).max(100).optional(),
  })
  .strict();
export type WordState = z.infer<typeof wordStateSchema>;
export type WordUnit = z.infer<typeof wordUnitSchema>;
export type WordQuestion = z.infer<typeof wordQuestionSchema>;
export type WordSession = z.infer<typeof wordSessionSchema>;
export type WordAction =
  | 'answer'
  | 'continue'
  | 'hint'
  | 'dontknow'
  | 'skip'
  | 'next'
  | 'finish'
  | 'accept'
  | 'mode'
  | 'known';
export function newWordAttemptId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('');
}
export const INTERVALS = [1, 3, 7, 14, 30, 60];
export const normalAnswer = (s: string) =>
  s
    .normalize('NFC')
    .toLocaleLowerCase('nl')
    .trim()
    .replace(/^[\s.!?,;:"“”]+|[\s.!?,;:"“”]+$/gu, '')
    .replace(/\s+/g, ' ');
export function addDays(day: string, n: number) {
  return new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}
export function learningDay(timeZone = 'Europe/Amsterdam', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function wordContent(item: any) {
  const parts = nounParts(item.title, item.body);
  return JSON.stringify({
    nl: (parts.article ? parts.article + ' ' : '') + parts.word,
    en: String(item.body.en || '').trim(),
    alternatives: Array.isArray(item.body.acceptedDutch)
      ? item.body.acceptedDutch
          .filter((s: any) => typeof s === 'string' && s.length <= 2000)
          .slice(0, 8)
      : [],
  });
}
export function initialWordState(contentKey: string, today: string, legacy = false): WordState {
  return {
    contentKey,
    stage: legacy ? 'recall' : 'intro',
    recognizedNL: false,
    recognizedEN: false,
    interval: -1,
    due: today,
    lastSuccessDay: null,
    failedDay: null,
    recovering: false,
  };
}
export function makeUnit(item: any, state: WordState): WordUnit {
  const content = JSON.parse(wordContent(item));
  return {
    id: item.id,
    nl: content.nl,
    en: content.en,
    alternatives: content.alternatives,
    example: String(item.body.example || '').slice(0, 2000),
    exampleTranslation: String(item.body.exampleTranslation || '').slice(0, 2000),
    partOfSpeech: String(item.body.partOfSpeech || '').slice(0, 100),
    lemma: String(item.body.lemma || item.title).slice(0, 500),
    state,
    attempts: 0,
    misses: 0,
    availableAt: 0,
    done: false,
    skipped: false,
  };
}
function shuffled<T>(values: T[], seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
export function wordBuildTokens(nl: string, seed: string) {
  return shuffled(Array.from(nl), seed);
}
function distractors(
  unit: WordUnit,
  pool: Pick<WordUnit, 'id' | 'nl' | 'en' | 'lemma' | 'partOfSpeech' | 'alternatives'>[],
  direction: string,
  seed: string,
) {
  const target = direction === 'nl-en' ? unit.en : unit.nl;
  const used = new Set([normalAnswer(target)]);
  const choices: string[] = [];
  for (const other of shuffled(pool, seed)) {
    if (
      other.id === unit.id ||
      normalAnswer(other.lemma) === normalAnswer(unit.lemma) ||
      normalAnswer(other.nl) === normalAnswer(unit.nl) ||
      normalAnswer(other.en) === normalAnswer(unit.en)
    )
      continue;
    if (unit.partOfSpeech && other.partOfSpeech && unit.partOfSpeech !== other.partOfSpeech)
      continue;
    const answer = direction === 'nl-en' ? other.en : other.nl,
      key = normalAnswer(answer);
    if (
      !key ||
      used.has(key) ||
      unit.alternatives.some((s) => normalAnswer(s) === normalAnswer(other.nl))
    )
      continue;
    const words = (s: string) =>
      normalAnswer(s)
        .split(/[^\p{L}]+/u)
        .filter((x) => x.length > 3);
    if (words(unit.en).some((w) => words(other.en).includes(w))) continue;
    used.add(key);
    choices.push(answer);
    if (choices.length === 3) break;
  }
  return choices.length === 3 ? shuffled([target, ...choices], seed + 'options') : [];
}
export function nextWordQuestion(session: WordSession) {
  if (session.algorithm === 2) {
    nextDailyQuestion(session);
    return;
  }
  if (session.cardLimit && session.turn >= session.cardLimit) {
    session.question = null;
    session.feedback = null;
    session.closed = true;
    return;
  }
  const active = session.units.filter((u) => !u.done).slice(0, 8);
  const previous = session.question?.unitId;
  const ready = active.filter((u) => u.availableAt <= session.turn);
  const unit =
    [...ready].sort(
      (a, b) =>
        (a.id === previous ? 1 : 0) - (b.id === previous ? 1 : 0) || a.attempts - b.attempts,
    )[0] ||
    (['seen', 'correct', 'supported'].includes(session.feedback?.outcome || '')
      ? active.find((u) => u.id === previous && u.availableAt === session.turn + 1)
      : undefined);
  session.feedback = null;
  if (!unit) {
    session.question = null;
    return;
  }
  const seed = session.id + ':' + session.turn + ':' + unit.id;
  let kind: WordQuestion['kind'] = 'typing',
    direction: WordQuestion['direction'] = 'en-nl';
  let options: string[] = [],
    tokens: string[] = [];
  switch (unit.state.stage) {
    case 'intro':
      kind = 'intro';
      break;
    case 'recognize':
      direction = unit.state.recognizedNL ? 'en-nl' : 'nl-en';
      options = distractors(unit, session.units, direction, seed);
      kind = options.length === 4 ? 'choice' : direction === 'nl-en' ? 'self' : 'typing';
      break;
    case 'build':
      tokens = Array.from(unit.nl);
      kind = tokens.length > 120 ? 'typing' : 'build';
      tokens = kind === 'build' ? shuffled(tokens, seed) : [];
      break;
  }
  session.question = { id: seed, unitId: unit.id, kind, direction, options, tokens, hinted: false };
}
function scheduleSuccess(state: WordState, today: string) {
  if (state.failedDay === today) {
    state.due = addDays(today, 1);
    state.stage = 'recall';
    return;
  }
  if (state.lastSuccessDay !== today) {
    state.interval = state.recovering
      ? Math.max(0, state.interval)
      : Math.min(5, state.interval + 1);
    state.recovering = false;
    state.lastSuccessDay = today;
    state.due = addDays(today, INTERVALS[state.interval]);
    state.stage = 'review';
  }
}
export function applyWordAction(input: WordSession, action: WordAction, answer = '', elapsed = 0) {
  if (input.algorithm === 2) return applyDailyAction(input, action, answer, elapsed);
  if (action === 'mode' || action === 'known')
    throw Error('Finish this older round before changing answer formats.');
  const s = structuredClone(input);
  s.elapsed = Math.max(s.elapsed, Math.min(86400, Math.max(0, Math.floor(elapsed))));
  if (action === 'finish') {
    s.closed = true;
    return s;
  }
  if (!s.question) throw Error('This session is complete.');
  const q = s.question,
    u = s.units.find((u) => u.id === q.unitId);
  if (!u) throw Error('Entry not found.');
  if (action === 'next') {
    if (!s.feedback) throw Error('Check your answer first.');
    nextWordQuestion(s);
    return s;
  }
  if (action === 'accept') {
    if (!s.feedback || s.feedback.outcome !== 'wrong' || q.kind === 'intro')
      throw Error('No answer to review.');
    if (s.feedback.previousState) u.state = structuredClone(s.feedback.previousState);
    u.misses = Math.max(0, u.misses - 1);
    s.wrong = Math.max(0, s.wrong - 1);
    s.feedback = {
      outcome: 'self',
      expected: q.direction === 'nl-en' ? u.en : u.nl,
      given: s.feedback.given,
      message: 'Accepted by you. The next review stays tomorrow.',
    };
    u.state.stage = 'recall';
    u.state.due = addDays(s.day, 1);
    u.done = true;
    return s;
  }
  if (s.feedback) throw Error('Continue to the next question.');
  if (action === 'hint') {
    q.hinted = true;
    return s;
  }
  if (action === 'skip') {
    u.done = true;
    u.skipped = true;
    s.turn++;
    nextWordQuestion(s);
    return s;
  }
  if (action === 'continue' && q.kind !== 'intro') throw Error('Answer this question first.');
  if (action === 'answer' && q.kind === 'intro') throw Error('Continue after reading the card.');
  if (action === 'answer' && q.kind === 'choice' && !q.options.includes(answer))
    throw Error('Choose one of the answers.');
  const expected = q.direction === 'nl-en' ? u.en : u.nl,
    accepted = [expected, ...(q.direction === 'en-nl' ? u.alternatives : [])];
  const correct =
    action === 'continue' ||
    (action === 'answer' &&
      (q.kind === 'self'
        ? answer === 'yes'
        : accepted.some((a) => normalAnswer(a) === normalAnswer(answer))));
  let outcome: NonNullable<WordSession['feedback']>['outcome'] = 'wrong';
  s.turn++;
  u.attempts++;
  if (q.kind === 'intro' && action === 'continue') {
    u.state.stage = 'recognize';
    outcome = 'seen';
  } else if (correct && q.hinted && q.kind !== 'self') {
    outcome = 'supported';
    s.supported++;
  } else if (correct) {
    outcome = 'correct';
    s.correct++;
    if (u.state.stage === 'recognize') {
      if (q.direction === 'nl-en') u.state.recognizedNL = true;
      else u.state.recognizedEN = true;
      if (u.state.recognizedNL && u.state.recognizedEN) u.state.stage = 'build';
    } else if (u.state.stage === 'build') {
      u.state.stage = 'recall';
    } else {
      scheduleSuccess(u.state, s.day);
      u.done = true;
    }
  } else {
    s.wrong++;
    u.misses++;
    u.state.failedDay = s.day;
    u.state.due = addDays(s.day, 1);
    if (u.state.stage === 'review') {
      u.state.interval = Math.max(0, u.state.interval - 1);
      u.state.recovering = true;
      u.state.stage = 'build';
    } else if (u.state.stage === 'recall') u.state.stage = 'build';
    else if (u.state.stage === 'build') u.state.stage = 'recognize';
    u.availableAt = s.turn + 3;
  }
  if (outcome !== 'wrong') u.availableAt = s.turn + 1;
  if (u.attempts >= 6 || u.misses >= 2) {
    u.done = true;
    if (u.state.stage !== 'review') u.state.due = addDays(s.day, 1);
  }
  s.feedback = {
    outcome,
    ...(outcome === 'wrong'
      ? { previousState: structuredClone(input.units.find((v) => v.id === u.id)!.state) }
      : {}),
    expected: q.kind === 'intro' ? u.nl : expected,
    given: answer.slice(0, 2000),
    message:
      outcome === 'seen'
        ? 'You’ll see this again in a different exercise.'
        : outcome === 'correct'
          ? u.state.stage === 'review'
            ? 'Next review: ' + u.state.due
            : 'Correct. We’ll remove a little more help next time.'
          : outcome === 'supported'
            ? 'Correct with a hint. Try it without help next time.'
            : 'Compare with the saved answer. This word will return later.',
  };
  if (outcome === 'seen') nextWordQuestion(s);
  return s;
}

/** Daily scheduler v2: one successful encounter per date; bounded optional error retry. */
export function reviewDays(state: WordState) {
  return (
    state.intervalDays ??
    (state.stage === 'review'
      ? INTERVALS[Math.max(0, state.interval)]
      : state.stage === 'recall'
        ? 7
        : state.stage === 'build'
          ? 3
          : 1)
  );
}
function setDays(state: WordState, today: string, days: number) {
  state.intervalDays = Math.max(1, Math.min(60, Math.round(days)));
  state.due = addDays(today, state.intervalDays);
  state.interval = Math.max(
    0,
    INTERVALS.findLastIndex((n) => n <= state.intervalDays!),
  );
}
function dailyQuestion(session: WordSession, u: WordUnit, mode?: string): WordQuestion {
  const seed =
    session.id + ':' + session.turn + ':' + u.id + (u.introDelay !== undefined ? ':practice' : '');
  let kind: WordQuestion['kind'] = 'typing',
    direction: WordQuestion['direction'] = 'en-nl';
  let options: string[] = [],
    tokens: string[] = [];
  if (u.state.stage === 'intro') kind = 'intro';
  else if (u.state.stage === 'recognize' && !u.state.recognizedNL) {
    direction = 'nl-en';
    options = distractors(u, session.choicePool || session.units, direction, seed);
    kind = options.length === 4 ? 'choice' : 'self';
  } else {
    const requested = mode || (session.preferences || defaultWordPreferences).answerMode;
    const selected =
      requested === 'auto'
        ? u.state.stage === 'recognize'
          ? 'choices'
          : u.state.stage === 'build'
            ? 'letters'
            : 'typing'
        : requested;
    if (selected === 'choices') {
      options = distractors(u, session.choicePool || session.units, direction, seed);
      kind = options.length === 4 ? 'choice' : 'build';
    } else kind = selected === 'letters' ? 'build' : 'typing';
    if (kind === 'build') {
      tokens = wordBuildTokens(u.nl, seed);
      if (tokens.length > 120) {
        kind = 'typing';
        tokens = [];
      }
    }
  }
  return {
    id: seed,
    unitId: u.id,
    kind,
    direction,
    options,
    tokens,
    hinted: false,
    maxHelp: kind === 'choice' || kind === 'self' ? 2 : kind === 'build' ? 1 : 0,
  };
}
function nextDailyQuestion(s: WordSession) {
  s.feedback = null;
  if (s.turn >= (s.cardLimit || 15)) {
    s.question = null;
    s.closed = true;
    return;
  }
  const introductions = s.units.filter((u) => !u.done && u.introDelay !== undefined);
  const u =
    introductions.find((u) => u.introDelay === 0) ||
    s.units.find((u) => !u.done && !u.retryPending && u.introDelay === undefined) ||
    introductions.sort((a, b) => a.introDelay! - b.introDelay!)[0] ||
    s.units.find((u) => !u.done && u.retryPending && u.availableAt <= s.turn);
  s.question = u ? dailyQuestion(s, u) : null;
  if (!u) s.closed = true;
}
// Count other card presentations, not hints/mode changes, before the first exercise.
function advanceIntroductions(s: WordSession, current: WordUnit) {
  for (const u of s.units) {
    if (u.id !== current.id && u.introDelay !== undefined)
      u.introDelay = Math.max(0, u.introDelay - 1);
  }
}
function finishEncounter(s: WordSession, u: WordUnit, days: number) {
  setDays(u.state, s.day, days);
  u.done = true;
  u.retryPending = false;
}
function applyDailyAction(
  input: WordSession,
  action: WordAction,
  answer: string,
  elapsed: number,
): WordSession {
  const s = structuredClone(input);
  s.elapsed = Math.max(s.elapsed, Math.min(86400, Math.max(0, Math.floor(elapsed))));
  if (action === 'finish') {
    s.closed = true;
    return s;
  }
  if (!s.question) throw Error('This session is complete.');
  const q = s.question,
    u = s.units.find((u) => u.id === q.unitId);
  if (!u) throw Error('Entry not found.');
  const introducing = u.state.stage === 'intro' || !!q.knownCheck;
  if (action === 'next') {
    if (!s.feedback) throw Error('Check your answer first.');
    nextDailyQuestion(s);
    return s;
  }
  if (action === 'accept') {
    if (s.feedback?.outcome !== 'wrong') throw Error('No answer to review.');
    if (s.feedback.previousState) u.state = structuredClone(s.feedback.previousState);
    u.state.stage = u.state.stage === 'intro' ? 'recall' : u.state.stage;
    u.state.lastSeenDay = s.day;
    if (introducing) u.state.introducedDay ??= s.day;
    finishEncounter(s, u, 1);
    s.wrong = Math.max(0, s.wrong - 1);
    s.feedback = {
      outcome: 'self',
      expected: q.direction === 'nl-en' ? u.en : u.nl,
      given: s.feedback.given,
      message: 'Next review: ' + u.state.due,
    };
    return s;
  }
  if (s.feedback) throw Error('Continue to the next question.');
  if (action === 'mode') {
    if (
      q.direction !== 'en-nl' ||
      q.kind === 'intro' ||
      !['typing', 'letters', 'choices'].includes(answer)
    )
      throw Error('Choose an available answer format.');
    const changed = dailyQuestion(
      s,
      { ...u, state: { ...u.state, stage: q.knownCheck ? 'recall' : u.state.stage } },
      answer,
    );
    s.question = {
      ...changed,
      id: q.id,
      hinted: q.hinted,
      knownCheck: q.knownCheck,
      maxHelp: Math.max(q.maxHelp || 0, changed.maxHelp || 0),
    };
    return s;
  }
  if (action === 'known') {
    if (q.kind !== 'intro') throw Error('This word has already been introduced.');
    s.question = {
      ...q,
      id: q.id + ':known',
      kind: 'typing',
      direction: 'en-nl',
      knownCheck: true,
      maxHelp: 0,
    };
    return s;
  }
  if (action === 'hint') {
    q.hinted = true;
    return s;
  }
  if (action === 'skip') {
    u.state.lastSeenDay = s.day;
    if (introducing) u.state.introducedDay ??= s.day;
    finishEncounter(s, u, 1);
    u.skipped = true;
    delete u.introDelay;
    s.turn++;
    advanceIntroductions(s, u);
    nextDailyQuestion(s);
    return s;
  }
  if (s.introPractice && action === 'continue' && q.kind === 'intro') {
    // An introduction is persisted, but is neither an answer nor a scheduled review.
    u.state.stage = 'recognize';
    u.state.introducedDay ??= s.day;
    advanceIntroductions(s, u);
    u.introDelay = 2;
    nextDailyQuestion(s);
    return s;
  }
  if ((action === 'continue' && q.kind !== 'intro') || (action === 'answer' && q.kind === 'intro'))
    throw Error('Answer this question first.');
  if (!['answer', 'continue', 'dontknow'].includes(action)) throw Error('Unknown practice action.');
  if (action === 'answer' && q.kind === 'choice' && !q.options.includes(answer))
    throw Error('Choose one of the answers.');
  const previous = structuredClone(u.state),
    expected = q.direction === 'nl-en' ? u.en : u.nl,
    correct =
      action === 'continue' ||
      (action === 'answer' &&
        (q.kind === 'self'
          ? answer === 'yes'
          : [expected, ...(q.direction === 'en-nl' ? u.alternatives : [])].some(
              (a) => normalAnswer(a) === normalAnswer(answer),
            )));
  s.turn++;
  u.attempts++;
  u.state.lastSeenDay = s.day;
  if (introducing) u.state.introducedDay ??= s.day;
  delete u.introDelay;
  advanceIntroductions(s, u);
  let outcome: 'seen' | 'correct' | 'supported' | 'wrong' = 'wrong';
  if (correct) {
    if (q.kind === 'intro') {
      outcome = 'seen';
      u.state.stage = 'recognize';
      finishEncounter(s, u, 1);
    } else {
      outcome = q.hinted && q.kind !== 'self' ? 'supported' : 'correct';
      if (outcome === 'supported') s.supported++;
      else s.correct++;
      if (u.misses > 0) {
        finishEncounter(s, u, 1);
      } else if (outcome === 'supported') {
        finishEncounter(s, u, Math.min(3, Math.max(1, Math.floor(reviewDays(u.state) / 2))));
      } else if (q.knownCheck) {
        u.state.stage = 'review';
        finishEncounter(s, u, 3);
      } else if (u.state.stage === 'recognize') {
        u.state.recognizedNL = true;
        u.state.recognizedEN = q.direction === 'en-nl';
        u.state.stage = 'build';
        finishEncounter(s, u, 3);
      } else if (u.state.stage === 'build') {
        u.state.stage = 'recall';
        finishEncounter(s, u, 7);
      } else {
        const current = reviewDays(u.state),
          next = INTERVALS.find((n) => n > current) || 60,
          help = q.maxHelp || 0;
        u.state.stage = 'review';
        finishEncounter(
          s,
          u,
          help === 2
            ? current
            : help === 1
              ? Math.min(next, Math.max(current + 1, Math.round(current * 1.4)))
              : next,
        );
      }
      u.state.lastSuccessDay = s.day;
      u.state.recovering = false;
    }
  } else {
    s.wrong++;
    u.misses++;
    u.state.failedDay = s.day;
    u.state.stage = q.knownCheck
      ? 'recognize'
      : u.state.stage === 'review' || u.state.stage === 'recall'
        ? 'build'
        : u.state.stage === 'build'
          ? 'recognize'
          : u.state.stage;
    setDays(u.state, s.day, 1);
    u.retryPending = (s.preferences || defaultWordPreferences).repeatMistakes && u.misses === 1;
    u.done = !u.retryPending;
    u.availableAt = s.turn + 3;
  }
  s.feedback = {
    outcome,
    expected: q.kind === 'intro' ? u.nl : expected,
    given: answer.slice(0, 2000),
    message: 'Next review: ' + u.state.due,
    ...(!correct ? { previousState: previous } : {}),
  };
  if (outcome === 'seen') nextDailyQuestion(s);
  return s;
}
