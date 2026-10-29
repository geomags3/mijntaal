import { z } from 'zod';
import { AppError, db } from './common';
import {
  applyLessonAction,
  lessonActionSchema,
  saveLessonSchema,
  saveProgramSchema,
  type LessonProgress,
  type LessonRecord,
  type LessonSummary,
  type ProgramRecord,
} from '../lessons';

type Row = {
  id: string;
  owner: string;
  body: string;
  version: number;
  archived: number;
  program_id: string | null;
  topic_id: string | null;
  sort_order: number;
};
type ProgressRow = { body: string; revision: number };
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const p = schema.safeParse(input);
  if (!p.success)
    throw new AppError(
      p.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')
        .slice(0, 2000),
    );
  return p.data;
}
const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
async function row(table: 'lesson_programs' | 'lessons', user: string, id: string): Promise<Row> {
  parse(idSchema, id);
  const r = await db()
    .prepare(`SELECT * FROM ${table} WHERE id=? AND owner=?`)
    .bind(id, user)
    .first<Row>();
  if (!r) throw new AppError(table === 'lessons' ? 'Lesson not found.' : 'Program not found.', 404);
  return r;
}
const program = (r: Row): ProgramRecord => ({
  id: r.id,
  version: r.version,
  archived: !!r.archived,
  content: JSON.parse(r.body),
});
export async function listPrograms(user: string, archived = false): Promise<ProgramRecord[]> {
  const r = await db()
    .prepare('SELECT * FROM lesson_programs WHERE owner=? AND archived=? ORDER BY created,id')
    .bind(user, archived ? 1 : 0)
    .all<Row>();
  return r.results.map(program);
}
export async function getProgram(user: string, id: string) {
  return program(await row('lesson_programs', user, id));
}
// D1 batches roll back when a guard's JSON expression fails. A guard makes each
// optimistic write and its related-content checks one atomic operation.
function guard(sql: string, values: (string | number)[]) {
  return db()
    .prepare(`SELECT json(CASE WHEN ${sql} THEN '{}' ELSE 'lesson_conflict' END)`)
    .bind(...values);
}
async function commit(statements: D1PreparedStatement[]) {
  try {
    await db().batch(statements);
  } catch {
    throw new AppError('Lessons changed elsewhere. Reload before trying again.', 409);
  }
}
export async function saveProgram(user: string, input: unknown) {
  const b = parse(saveProgramSchema, input),
    id = b.id || crypto.randomUUID(),
    now = new Date().toISOString();
  const version = b.version ? b.version + 1 : 1;
  if (b.id) await row('lesson_programs', user, b.id);
  const serialized = JSON.stringify(b.content);
  const write = b.id
    ? db()
        .prepare(
          'UPDATE lesson_programs SET body=?,version=?,archived=?,updated=? WHERE id=? AND owner=? AND version=?',
        )
        .bind(serialized, version, +b.archived, now, id, user, b.version!)
    : db()
        .prepare(
          'INSERT INTO lesson_programs(id,owner,body,version,archived,created,updated) VALUES(?,?,?,?,?,?,?)',
        )
        .bind(id, user, serialized, version, +b.archived, now, now);
  const topics = b.content.topics.map((t) => t.id);
  // Includes archived lessons: restoring a lesson must retain its topic association.
  const topicCheck = topics.length
    ? `NOT EXISTS(SELECT 1 FROM lessons WHERE program_id=? AND owner=? AND topic_id IS NOT NULL AND topic_id NOT IN (${topics.map(() => '?').join(',')}))`
    : 'NOT EXISTS(SELECT 1 FROM lessons WHERE program_id=? AND owner=? AND topic_id IS NOT NULL)';
  await commit([
    ...(b.id
      ? [
          guard('EXISTS(SELECT 1 FROM lesson_programs WHERE id=? AND owner=? AND version=?)', [
            id,
            user,
            b.version!,
          ]),
        ]
      : []),
    guard(topicCheck, [id, user, ...topics]),
    write,
  ]);
  return getProgram(user, id);
}
async function storedProgress(user: string, id: string) {
  return db()
    .prepare('SELECT body,revision FROM lesson_progress WHERE lesson_id=? AND owner=?')
    .bind(id, user)
    .first<ProgressRow>();
}
export async function getLesson(user: string, id: string): Promise<LessonRecord> {
  const r = await row('lessons', user, id),
    p = await storedProgress(user, id);
  return {
    id: r.id,
    version: r.version,
    archived: !!r.archived,
    programId: r.program_id,
    topicId: r.topic_id,
    order: r.sort_order,
    content: JSON.parse(r.body),
    progress: p ? JSON.parse(p.body) : null,
    revision: p?.revision || 0,
  };
}
export async function listLessons(
  user: string,
  programId?: string,
  archived = false,
): Promise<LessonSummary[]> {
  if (programId) await row('lesson_programs', user, programId);
  const r = await db()
    .prepare(
      `SELECT l.id,l.version,l.archived,l.program_id,l.topic_id,l.sort_order,
    json_extract(l.body,'$.title') AS title,json_extract(l.body,'$.description') AS description,
    json_extract(l.body,'$.minutes') AS minutes,json_extract(l.body,'$.level') AS level,
    json_extract(p.body,'$.completed') AS completed,json_extract(p.body,'$.index') AS progress_index,
    json_array_length(p.body,'$.content.blocks') AS total,json_extract(p.body,'$.lessonVersion') AS lesson_version
    FROM lessons l LEFT JOIN lesson_progress p ON p.lesson_id=l.id AND p.owner=l.owner
    WHERE l.owner=? AND l.archived=? ${programId ? 'AND l.program_id=?' : ''} ORDER BY l.sort_order,l.created,l.id`,
    )
    .bind(user, archived ? 1 : 0, ...(programId ? [programId] : []))
    .all<
      Pick<Row, 'id' | 'version' | 'archived' | 'program_id' | 'topic_id' | 'sort_order'> & {
        title: string;
        description: string;
        minutes: number;
        level: string | null;
        completed: number | null;
        progress_index: number;
        total: number;
        lesson_version: number | null;
      }
    >();
  return r.results.map((x) => ({
    id: x.id,
    version: x.version,
    archived: !!x.archived,
    programId: x.program_id,
    topicId: x.topic_id,
    order: x.sort_order,
    title: x.title,
    description: x.description,
    minutes: x.minutes,
    level: x.level || undefined,
    progress:
      x.lesson_version == null
        ? null
        : {
            completed: !!x.completed,
            index: x.progress_index,
            total: x.total,
            lessonVersion: x.lesson_version,
          },
  }));
}
export async function saveLesson(user: string, input: unknown) {
  const b = parse(saveLessonSchema, input),
    id = b.id || crypto.randomUUID(),
    now = new Date().toISOString();
  if (b.id) await row('lessons', user, b.id);
  const guards: D1PreparedStatement[] = [];
  if (b.programId) {
    const p = await row('lesson_programs', user, b.programId);
    if (p.archived && !b.archived)
      throw new AppError('Restore this program before adding active lessons.');
    if (b.topicId && !JSON.parse(p.body).topics.some((t: { id: string }) => t.id === b.topicId))
      throw new AppError('Topic not found in this program.');
    guards.push(
      guard('EXISTS(SELECT 1 FROM lesson_programs WHERE id=? AND owner=? AND version=?)', [
        p.id,
        user,
        p.version,
      ]),
    );
  }
  if (b.id)
    guards.push(
      guard('EXISTS(SELECT 1 FROM lessons WHERE id=? AND owner=? AND version=?)', [
        id,
        user,
        b.version!,
      ]),
    );
  const version = b.version ? b.version + 1 : 1;
  const write = b.id
    ? db()
        .prepare(
          'UPDATE lessons SET body=?,version=?,archived=?,program_id=?,topic_id=?,sort_order=?,updated=? WHERE id=? AND owner=? AND version=?',
        )
        .bind(
          JSON.stringify(b.content),
          version,
          +b.archived,
          b.programId,
          b.topicId,
          b.order,
          now,
          id,
          user,
          b.version!,
        )
    : db()
        .prepare(
          'INSERT INTO lessons(id,owner,body,version,archived,program_id,topic_id,sort_order,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          user,
          JSON.stringify(b.content),
          version,
          +b.archived,
          b.programId,
          b.topicId,
          b.order,
          now,
          now,
        );
  await commit([...guards, write]);
  return getLesson(user, id);
}
export async function lessonHistory(user: string, id: string) {
  await row('lessons', user, id);
  const r = await db()
    .prepare(
      'SELECT id,lesson_version,completed,correct,total FROM lesson_runs WHERE lesson_id=? AND owner=? ORDER BY completed DESC LIMIT 30',
    )
    .bind(id, user)
    .all();
  return r.results;
}
export async function actOnLesson(user: string, input: unknown) {
  const a = parse(lessonActionSchema, input),
    l = await row('lessons', user, a.lessonId),
    p = await storedProgress(user, a.lessonId);
  const previous: LessonProgress | null = p ? JSON.parse(p.body) : null;
  // Resolve a retry before checking the revision, including a lost start response.
  if (previous?.eventIds.includes(a.eventId)) return getLesson(user, a.lessonId);
  if ((p?.revision || 0) !== a.revision)
    throw new AppError('Progress changed on another page. Reload saved progress.', 409);
  let next: LessonProgress;
  const starting = ['start', 'restart', 'retry'].includes(a.action);
  if (starting) {
    if (previous && !previous.completed)
      throw new AppError('Resume the unfinished lesson first.', 409);
    if (l.archived) throw new AppError('This lesson is archived.');
    if (l.program_id && (await row('lesson_programs', user, l.program_id)).archived)
      throw new AppError('This program is archived.');
    if ((a.action === 'restart' || a.action === 'retry') && !previous?.completed)
      throw new AppError('Finish the lesson first.');
    let content = JSON.parse(l.body),
      lessonVersion = l.version;
    if (a.action === 'retry') {
      const missed = new Set(
        previous!.results.filter((r) => !r.correct || r.helped).map((r) => r.blockId),
      );
      content = {
        ...previous!.content,
        blocks: previous!.content.blocks.filter((b) => missed.has(b.id)),
      };
      lessonVersion = previous!.lessonVersion;
      if (!content.blocks.length) throw new AppError('No mistakes or hinted answers to repeat.');
    }
    next = {
      runId: crypto.randomUUID(),
      lessonVersion,
      content,
      index: 0,
      results: [],
      hinted: false,
      revealed: false,
      feedback: null,
      eventIds: [a.eventId],
      completed: false,
    };
  } else {
    if (!previous) throw new AppError('Start the lesson first.');
    try {
      next = applyLessonAction(previous, a);
    } catch (e) {
      throw new AppError((e as Error).message);
    }
  }
  const now = new Date().toISOString(),
    revision = a.revision + 1;
  const statements = [
    guard('EXISTS(SELECT 1 FROM lessons WHERE id=? AND owner=? AND version=?)', [
      l.id,
      user,
      l.version,
    ]),
  ];
  if (starting && l.program_id)
    statements.push(
      guard('EXISTS(SELECT 1 FROM lesson_programs WHERE id=? AND owner=? AND archived=0)', [
        l.program_id,
        user,
      ]),
    );
  if (p)
    statements.push(
      guard('EXISTS(SELECT 1 FROM lesson_progress WHERE lesson_id=? AND owner=? AND revision=?)', [
        l.id,
        user,
        a.revision,
      ]),
    );
  else
    statements.push(
      guard('NOT EXISTS(SELECT 1 FROM lesson_progress WHERE lesson_id=? AND owner=?)', [
        l.id,
        user,
      ]),
    );
  statements.push(
    db()
      .prepare(
        'INSERT INTO lesson_progress(lesson_id,owner,revision,body,updated) VALUES(?,?,?,?,?) ON CONFLICT(lesson_id,owner) DO UPDATE SET revision=excluded.revision,body=excluded.body,updated=excluded.updated',
      )
      .bind(l.id, user, revision, JSON.stringify(next), now),
  );
  if (next.completed)
    statements.push(
      db()
        .prepare(
          'INSERT OR IGNORE INTO lesson_runs(id,lesson_id,owner,lesson_version,body,completed,correct,total) VALUES(?,?,?,?,?,?,?,?)',
        )
        .bind(
          next.runId,
          l.id,
          user,
          next.lessonVersion,
          JSON.stringify(next),
          now,
          next.results.filter((r) => r.correct && !r.helped && !r.selfAssessed).length,
          next.results.length,
        ),
    );
  await commit(statements);
  return getLesson(user, l.id);
}
