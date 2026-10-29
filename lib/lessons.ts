import { z } from 'zod';

const short = z.string().trim().min(1).max(240);
const prose = z.string().trim().min(1).max(2400);
const richProse = prose.describe(
  'Compact lesson Markdown: paragraphs, **bold**, *italic*, `inline code`, flat lists, # headings and > quotes. No HTML or links. Keep graded answers, options, tokens and sentence/pair labels plain text.',
);
const inlineFormatting =
  'Inline lesson Markdown: **bold**, *italic* and `inline code`. No HTML or links.';
const richShort = short.describe(inlineFormatting);
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const base = { id: identifier };
const exercise = {
  ...base,
  prompt: prose.describe(inlineFormatting),
  explanation: richProse,
  hint: richShort.optional(),
};
const answers = z.array(short).min(1).max(12);
export const normalizeLessonAnswer = (s: string) =>
  s
    .normalize('NFC')
    .toLocaleLowerCase('nl')
    .replace(/[’‘]/g, "'")
    .trim()
    .replace(/^[.!?,;:]+|[.!?,;:]+$/g, '')
    .trim()
    .replace(/\s+/g, ' ');
const unique = (values: string[]) =>
  new Set(values.map(normalizeLessonAnswer)).size === values.length;

export const lessonBlockSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...base,
      type: z.literal('explanation'),
      heading: richShort.optional(),
      text: richProse,
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('table'),
      caption: richShort.optional(),
      columns: z.array(richShort).min(2).max(3),
      rows: z.array(z.array(richShort).min(2).max(3)).min(1).max(8),
    })
    .strict()
    .refine(
      (b) => b.rows.every((r) => r.length === b.columns.length),
      'Table rows must match the columns.',
    ),
  z
    .object({
      ...base,
      type: z.literal('diagram'),
      caption: richShort.optional(),
      steps: z.array(richShort).min(2).max(6),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('image'),
      url: z
        .string()
        .url()
        .max(2000)
        .refine((s) => {
          const u = new URL(s);
          return u.protocol === 'https:' && !u.username && !u.password;
        }, 'Use an HTTPS image URL without credentials.'),
      alt: short,
      caption: richShort.optional(),
    })
    .strict(),
  z.object({ ...exercise, type: z.literal('flashcard'), answer: short }).strict(),
  z
    .object({
      ...exercise,
      type: z.literal('choice'),
      options: z.array(short).length(4).refine(unique, 'Options must be distinct.'),
      correct: z.number().int().min(0).max(3),
    })
    .strict(),
  z
    .object({
      ...exercise,
      type: z.literal('letters'),
      tokens: z.array(z.string().min(1).max(2)).min(1).max(100),
      answers,
    })
    .strict()
    .refine(
      (b) => sameTokens(b.tokens, Array.from(b.answers[0])),
      'Letters must reconstruct the primary answer.',
    ),
  z
    .object({
      ...exercise,
      type: z.literal('words'),
      tokens: z.array(short).min(2).max(35),
      answers,
    })
    .strict()
    .refine(
      (b) => sameTokens(b.tokens, b.answers[0].split(/\s+/)),
      'Word blocks must reconstruct the primary answer.',
    ),
  z
    .object({
      ...exercise,
      type: z.literal('match'),
      pairs: z
        .array(z.object({ left: short, right: short }).strict())
        .min(2)
        .max(6),
    })
    .strict()
    .refine(
      (b) => unique(b.pairs.map((p) => p.left)) && unique(b.pairs.map((p) => p.right)),
      'Matching labels must be distinct in each column.',
    ),
  z
    .object({
      ...exercise,
      type: z.literal('gap'),
      sentence: prose.refine((s) => s.split('___').length === 2, 'Include exactly one ___ gap.'),
      answers,
      options: z.array(short).min(2).max(4).refine(unique).optional(),
    })
    .strict()
    .refine(
      (b) =>
        !b.options ||
        b.options.some((s) => normalizeLessonAnswer(s) === normalizeLessonAnswer(b.answers[0])),
      'Gap options must include the primary answer.',
    ),
]);
function sameTokens(a: string[], b: string[]) {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}
export const programContentSchema = z
  .object({
    title: short,
    description: prose,
    level: z.enum(['A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2']).optional(),
    topics: z
      .array(z.object({ id: identifier, title: short, description: prose.optional() }).strict())
      .max(40),
  })
  .strict()
  .refine(
    (p) => new Set(p.topics.map((t) => t.id)).size === p.topics.length,
    'Topic IDs must be unique.',
  );
export const lessonContentSchema = z
  .object({
    title: short,
    description: prose,
    goal: prose,
    level: z.enum(['A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2']).optional(),
    minutes: z.number().int().min(1).max(60),
    blocks: z.array(lessonBlockSchema).min(2).max(60),
  })
  .strict()
  .refine(
    (l) => new Set(l.blocks.map((b) => b.id)).size === l.blocks.length,
    'Block IDs must be unique.',
  )
  .refine((l) => l.blocks.some(isExercise), 'A lesson needs at least one exercise.')
  .refine((l) => JSON.stringify(l).length <= 70000, 'Keep each lesson under 70,000 characters.');
const versionFields = {
  id: identifier.optional(),
  version: z.number().int().min(1).optional(),
  archived: z.boolean().default(false),
};
const versionPair = (x: { id?: string; version?: number }) => Boolean(x.id) === Boolean(x.version);
export const saveProgramSchema = z
  .object({ ...versionFields, content: programContentSchema })
  .strict()
  .refine(versionPair, 'Updates require both id and version.');
export const saveLessonSchema = z
  .object({
    ...versionFields,
    programId: identifier.nullable().default(null),
    topicId: identifier.nullable().default(null),
    order: z.number().int().min(0).max(10000).default(0),
    content: lessonContentSchema,
  })
  .strict()
  .refine(versionPair, 'Updates require both id and version.')
  .refine((l) => !l.topicId || !!l.programId, 'A topic requires a program.');
export type LessonBlock = z.infer<typeof lessonBlockSchema>;
export type LessonContent = z.infer<typeof lessonContentSchema>;
export type ProgramContent = z.infer<typeof programContentSchema>;
export type Exercise = Exclude<
  LessonBlock,
  { type: 'explanation' | 'table' | 'diagram' | 'image' }
>;
export function isExercise(b: { type: string }): b is Exercise {
  return ['flashcard', 'choice', 'letters', 'words', 'match', 'gap'].includes(b.type);
}
export type LessonResult = {
  blockId: string;
  correct: boolean;
  helped: boolean;
  selfAssessed: boolean;
  answer: string;
};
export type LessonProgress = {
  runId: string;
  lessonVersion: number;
  content: LessonContent;
  index: number;
  results: LessonResult[];
  hinted: boolean;
  revealed: boolean;
  feedback: LessonResult | null;
  eventIds: string[];
  completed: boolean;
};
export const lessonActionSchema = z
  .object({
    lessonId: identifier,
    revision: z.number().int().min(0),
    eventId: identifier,
    action: z.enum(['start', 'check', 'continue', 'hint', 'reveal', 'rate', 'retry', 'restart']),
    answer: z
      .union([z.string().max(1000), z.array(z.number().int().min(0).max(100)).max(100)])
      .optional(),
    recalled: z.boolean().optional(),
  })
  .strict();
export type LessonAction = z.infer<typeof lessonActionSchema>;
export function expectedLessonAnswer(b: Exercise): string {
  if (b.type === 'choice') return b.options[b.correct];
  if (b.type === 'flashcard') return b.answer;
  if (b.type === 'match') return b.pairs.map((p) => `${p.left} → ${p.right}`).join('\n');
  return b.answers[0];
}
export function checkLessonAnswer(
  b: Exercise,
  answer: LessonAction['answer'],
): { correct: boolean; answer: string } {
  if (b.type === 'choice') {
    if (typeof answer !== 'string' || !/^[0-3]$/.test(answer))
      throw Error('Choose one of the four answers.');
    return {
      correct: answer === String(b.correct),
      answer: typeof answer === 'string' ? b.options[Number(answer)] || '' : '',
    };
  }
  if (b.type === 'match') {
    if (
      !Array.isArray(answer) ||
      answer.length !== b.pairs.length ||
      new Set(answer).size !== b.pairs.length ||
      answer.some((n) => n >= b.pairs.length)
    )
      throw Error('Match every item once.');
    return {
      correct: answer.every((n, i) => n === i),
      answer: b.pairs.map((p, i) => `${p.left} → ${b.pairs[answer[i]].right}`).join('\n'),
    };
  }
  let text = typeof answer === 'string' ? answer : '';
  if (b.type === 'letters' || b.type === 'words') {
    if (
      !Array.isArray(answer) ||
      answer.length !== b.tokens.length ||
      new Set(answer).size !== b.tokens.length ||
      answer.some((n) => n >= b.tokens.length)
    )
      throw Error('Use every block once.');
    text = answer.map((n) => b.tokens[n]).join(b.type === 'letters' ? '' : ' ');
  }
  if (b.type === 'flashcard') throw Error('Reveal the card and self-assess.');
  if (!text.trim()) throw Error('Enter an answer first.');
  return {
    correct: b.answers.some((s) => normalizeLessonAnswer(s) === normalizeLessonAnswer(text)),
    answer: text,
  };
}
export function applyLessonAction(previous: LessonProgress, action: LessonAction): LessonProgress {
  const s = structuredClone(previous),
    b = s.content.blocks[s.index];
  if (s.completed) throw Error('This run is complete.');
  if (action.action === 'continue') {
    if (isExercise(b) && !s.feedback) throw Error('Check your answer first.');
    s.index++;
    s.completed = s.index === s.content.blocks.length;
    s.feedback = null;
    s.hinted = false;
    s.revealed = false;
  } else {
    if (!isExercise(b) || s.feedback) throw Error('This action is unavailable on this block.');
    if (action.action === 'hint') {
      if (!b.hint) throw Error('No hint is available.');
      s.hinted = true;
    } else if (action.action === 'reveal') {
      if (b.type !== 'flashcard') throw Error('Reveal is available on flashcards.');
      s.revealed = true;
    } else if (action.action === 'check' || action.action === 'rate') {
      let result: LessonResult;
      if (action.action === 'rate') {
        if (b.type !== 'flashcard' || !s.revealed || typeof action.recalled !== 'boolean')
          throw Error('Reveal the card before self-assessment.');
        result = {
          blockId: b.id,
          correct: action.recalled,
          helped: s.hinted,
          selfAssessed: true,
          answer: b.answer,
        };
      } else {
        result = {
          blockId: b.id,
          ...checkLessonAnswer(b, action.answer),
          helped: s.hinted,
          selfAssessed: false,
        };
      }
      s.results.push(result);
      s.feedback = result;
    } else throw Error('Unsupported lesson action.');
  }
  s.eventIds.push(action.eventId);
  return s;
}
export type ProgramRecord = {
  id: string;
  version: number;
  archived: boolean;
  content: ProgramContent;
};
export type LessonSummary = {
  id: string;
  version: number;
  archived: boolean;
  programId: string | null;
  topicId: string | null;
  order: number;
  title: string;
  description: string;
  minutes: number;
  level?: string;
  progress: { completed: boolean; index: number; total: number; lessonVersion: number } | null;
};
export type LessonRecord = {
  id: string;
  version: number;
  archived: boolean;
  programId: string | null;
  topicId: string | null;
  order: number;
  content: LessonContent;
  progress: LessonProgress | null;
  revision: number;
};
