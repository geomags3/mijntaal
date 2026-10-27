import { z } from 'zod';
import { practiceMode } from '../practice-mode';
import {
  applyWordAction,
  initialWordState,
  learningDay,
  makeUnit,
  nextWordQuestion,
  wordContent,
  WordSession,
  wordSessionSchema,
  wordStateSchema,
} from '../words';
import { AppError, db, hash } from './common';
import { listMaterials } from './materials';
import { getSettings } from './settings';
const actions = z.enum([
  'answer',
  'continue',
  'hint',
  'dontknow',
  'skip',
  'next',
  'finish',
  'accept',
  'mode',
  'known',
]);
const requestSchema = z
  .object({
    action: actions,
    sessionId: z.string().min(1).max(100),
    revision: z.number().int().min(1),
    attemptId: z.string().min(1).max(100),
    questionId: z.string().max(300).optional(),
    answer: z.string().max(2000).default(''),
    elapsed: z.number().int().min(0).max(86400).default(0),
  })
  .strict();
export async function wordsStatus(user: string, timeZone = 'Europe/Amsterdam') {
  try {
    learningDay(timeZone);
  } catch {
    throw new AppError('Choose a valid time zone.');
  }
  const preferences = (await getSettings(user)).preferences.words;
  const today = learningDay(timeZone),
    items = (await listMaterials(user, '', false, false, 'phrase', true)).filter(
      (x: any) =>
        x.kind === 'phrase' &&
        practiceMode(x) === 'words' &&
        typeof x.body.en === 'string' &&
        x.body.en.trim() &&
        x.body.en.length <= 2000,
    );
  const rows = await db()
      .prepare('SELECT material_id,body FROM words_state WHERE owner=?')
      .bind(user)
      .all(),
    saved = new Map((rows.results as any[]).map((r) => [r.material_id, r.body]));
  const units = await Promise.all(
    items.map(async (item: any) => {
      const key = await hash(wordContent(item));
      let state;
      try {
        state = wordStateSchema.parse(JSON.parse(saved.get(item.id) || 'null'));
      } catch {}
      if (!state || state.contentKey !== key)
        state = initialWordState(key, today, !!item.last_seen);
      return makeUnit(item, state);
    }),
  );
  const stored: any = await db()
    .prepare('SELECT * FROM words_sessions WHERE owner=?')
    .bind(user)
    .first();
  let session: WordSession | null = null;
  try {
    session = stored ? wordSessionSchema.parse(JSON.parse(stored.body)) : null;
  } catch {}
  const seenKeys = new Set(
    units.filter((u) => u.state.lastSeenDay === today).map((u) => u.state.contentKey),
  );
  const introduced = units.filter((u) => u.state.introducedDay === today).length,
    available = units.filter((u) => u.state.due <= today && !seenKeys.has(u.state.contentKey)),
    due = available.filter((u) => u.state.stage !== 'intro'),
    fresh = available.filter((u) => u.state.stage === 'intro'),
    newCount = Math.min(Math.max(0, preferences.newWordsPerDay - introduced), fresh.length);
  return {
    savedStates: saved,
    preferences,
    items,
    units,
    stored,
    session,
    today,
    timeZone,
    total: units.length,
    due: due.length,
    newCount,
    waitingNew: fresh.length - newCount,
    dueUnits: due.sort((a, b) => a.state.due.localeCompare(b.state.due)),
    freshUnits: fresh,
  };
}
export async function getWords(user: string, timeZone = 'Europe/Amsterdam') {
  const status = await wordsStatus(user, timeZone);
  return {
    total: status.total,
    due: status.due,
    newCount: status.newCount,
    waitingNew: status.waitingNew,
    preferences: status.preferences,
    today: status.today,
    session:
      status.session && !status.session.closed && status.session.day === status.today
        ? status.session
        : null,
    revision: status.stored?.revision || 0,
    scope: await hash('words-browser:' + user),
  };
}
function assertion(sql: string, args: any[]) {
  return db()
    .prepare(sql)
    .bind(...args);
}
export async function startWords(user: string, timeZone = 'Europe/Amsterdam') {
  const status = await wordsStatus(user, timeZone);
  if (
    status.session &&
    !status.session.closed &&
    status.session.day === status.today &&
    status.session.question
  )
    return { session: status.session, revision: status.stored.revision };
  const unique = new Set<string>();
  const selected = [
    ...status.dueUnits.slice(0, status.preferences.sessionSize),
    ...status.freshUnits.slice(
      0,
      Math.min(
        status.newCount,
        Math.max(0, status.preferences.sessionSize - status.dueUnits.length),
      ),
    ),
  ].filter((u) => {
    const key = wordContent(status.items.find((i: any) => i.id === u.id));
    if (unique.has(key)) return false;
    unique.add(key);
    return true;
  });
  if (!selected.length)
    throw new AppError('Nothing is due. Add translated words to practice, or come back tomorrow.');
  const session: WordSession = {
    algorithm: 2,
    preferences: status.preferences,
    choicePool: status.units
      .slice(0, 100)
      .map(({ id, nl, en, lemma, partOfSpeech, alternatives }) => ({
        id,
        nl,
        en,
        lemma,
        partOfSpeech,
        alternatives,
      })),
    id: crypto.randomUUID(),
    day: status.today,
    timeZone,
    units: selected,
    turn: 0,
    cardLimit: status.preferences.sessionSize,
    question: null,
    feedback: null,
    closed: false,
    elapsed: 0,
    correct: 0,
    wrong: 0,
    supported: 0,
  };
  nextWordQuestion(session);
  const serialized = JSON.stringify(session),
    now = new Date().toISOString(),
    revision = (status.stored?.revision || 0) + 1;
  const statement = status.stored
    ? db()
        .prepare(
          'UPDATE words_sessions SET id=?,body=?,revision=?,updated=? WHERE owner=? AND revision=?',
        )
        .bind(session.id, serialized, revision, now, user, status.stored.revision)
    : db()
        .prepare(
          'INSERT OR IGNORE INTO words_sessions(owner,id,revision,body,updated) VALUES(?,?,?,?,?)',
        )
        .bind(user, session.id, revision, serialized, now);
  try {
    await db().batch([
      statement,
      assertion(
        "SELECT json(CASE WHEN EXISTS(SELECT 1 FROM json_each(?) u LEFT JOIN words_state w ON w.material_id=json_extract(u.value,'$.id') AND w.owner=? WHERE w.body IS NOT json_extract(u.value,'$.state')) THEN 'progress_changed' ELSE '{}' END)",
        [
          JSON.stringify(
            selected.map((u) => ({ id: u.id, state: status.savedStates.get(u.id) || null })),
          ),
          user,
        ],
      ),
      assertion(
        "SELECT json(CASE WHEN EXISTS(SELECT 1 FROM words_sessions WHERE owner=? AND id=? AND revision=? AND body=?) THEN '{}' ELSE 'session_changed' END)",
        [user, session.id, revision, serialized],
      ),
    ]);
  } catch {
    throw new AppError('Another session started. Reload practice to continue.', 409);
  }
  return { session, revision };
}
const batchSchema = z
  .object({
    action: z.literal('batch'),
    sessionId: z.string().min(1).max(100),
    revision: z.number().int().min(1),
    events: z.array(requestSchema).min(1).max(80),
  })
  .strict();
export async function answerWords(user: string, input: unknown) {
  const single = requestSchema.safeParse(input);
  if (!single.success) throw new AppError('Check the practice request.');
  return commitWords(user, {
    action: 'batch',
    sessionId: single.data.sessionId,
    revision: single.data.revision,
    events: [single.data],
  });
}
export async function commitWords(user: string, input: unknown) {
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) throw new AppError('Check the practice batch.');
  const b = parsed.data;
  if (new Set(b.events.map((e) => e.attemptId)).size !== b.events.length)
    throw new AppError('Duplicate actions in practice batch.');
  const ids = b.events.map((e) => user + ':words:' + e.attemptId);
  const read = await db().batch([
    db().prepare('SELECT * FROM words_sessions WHERE owner=?').bind(user),
    db()
      .prepare(
        'SELECT id FROM words_attempts WHERE owner=? AND id IN (SELECT value FROM json_each(?))',
      )
      .bind(user, JSON.stringify(ids)),
    db()
      .prepare(
        "SELECT m.*,r.active FROM materials m JOIN review_state r ON r.material_id=m.id AND r.owner=m.owner JOIN words_sessions s ON s.owner=m.owner WHERE s.owner=? AND m.id IN (SELECT json_extract(value,'$.id') FROM json_each(s.body,'$.units'))",
      )
      .bind(user),
  ]);
  const stored: any = read[0].results[0];
  if (!stored) throw new AppError('Start a practice session first.', 409);
  if (read[1].results.length === ids.length)
    return { session: JSON.parse(stored.body), revision: stored.revision, duplicate: true };
  if (read[1].results.length)
    throw new AppError(
      'Some actions were already saved. Reload practice to reconcile this session.',
      409,
    );
  let session = wordSessionSchema.parse(JSON.parse(stored.body));
  if (stored.id !== b.sessionId || stored.revision !== b.revision || session.closed)
    throw new AppError(
      'This session changed on another page. Your local answers are retained.',
      409,
    );

  const materials = new Map<string, any>((read[2].results as any[]).map((m) => [m.id, m])),
    checked = new Map<string, any>(),
    changed = new Set<string>(),
    ranked = new Set<string>();
  const now = new Date().toISOString(),
    statements: any[] = [];
  for (const [i, e] of b.events.entries()) {
    if (
      e.sessionId !== b.sessionId ||
      e.revision !== b.revision + i ||
      (e.action !== 'finish' && e.questionId !== session.question?.id)
    )
      throw new AppError('The order of practice actions changed.', 409);
    const unit = session.units.find((u) => u.id === session.question?.unitId);
    if (unit && e.action !== 'finish' && !checked.has(unit.id)) {
      const m = materials.get(unit.id);
      if (
        !m ||
        !m.active ||
        JSON.parse(m.body)._archived ||
        m.kind !== 'phrase' ||
        practiceMode({ practice: !!m.active, body: JSON.parse(m.body) }) !== 'words'
      )
        throw new AppError(
          'This entry is no longer in practice. Your local answers are retained.',
          409,
        );
      if ((await hash(wordContent({ ...m, body: JSON.parse(m.body) }))) !== unit.state.contentKey)
        throw new AppError(
          'This word or translation changed. Your local answers are retained.',
          409,
        );
      checked.set(unit.id, m);
    }
    if (session.closed) throw new AppError('This session is complete.', 409);
    const previous = session;
    try {
      session = applyWordAction(session, e.action, e.answer, e.elapsed);
    } catch (err) {
      throw new AppError((err as Error).message);
    }
    statements.push(
      db()
        .prepare('INSERT INTO words_attempts(id,owner,material_id,body,created) VALUES(?,?,?,?,?)')
        .bind(
          ids[i],
          user,
          unit?.id || session.units[0].id,
          JSON.stringify({
            sessionId: session.id,
            questionId: previous.question?.id || '',
            action: e.action,
            answer: e.answer,
            contentKey: unit?.state.contentKey || '',
            outcome: session.feedback?.outcome || e.action,
            hinted: previous.question?.hinted || e.action === 'hint',
            kind: previous.question?.kind || '',
            direction: previous.question?.direction || '',
            day: session.day,
          }),
          now,
        ),
    );
    if (
      unit &&
      !['next', 'finish', 'hint', 'mode', 'known'].includes(e.action) &&
      (e.action !== 'skip' || session.algorithm === 2)
    )
      changed.add(unit.id);
    if (unit && ['answer', 'dontknow', 'accept'].includes(e.action)) ranked.add(unit.id);
  }
  for (const id of changed) {
    const u = session.units.find((u) => u.id === id)!;
    statements.push(
      db()
        .prepare(
          'INSERT INTO words_state(material_id,owner,body,updated) VALUES(?,?,?,?) ON CONFLICT(material_id) DO UPDATE SET body=excluded.body,updated=excluded.updated WHERE words_state.owner=excluded.owner',
        )
        .bind(id, user, JSON.stringify(u.state), now),
    );
    if (ranked.has(id))
      statements.push(
        db()
          .prepare(
            'UPDATE review_state SET rank=?,last_seen=?,updated=? WHERE material_id=? AND owner=?',
          )
          .bind(Math.max(0, Math.min(5, u.state.interval + 1)), now, now, id, user),
      );
  }
  const serialized = JSON.stringify(session),
    revision = stored.revision + b.events.length;
  statements.push(
    db()
      .prepare(
        'UPDATE words_sessions SET body=?,revision=?,updated=? WHERE owner=? AND id=? AND revision=?',
      )
      .bind(serialized, revision, now, user, session.id, stored.revision),
  );
  // Verify the final row directly rather than relying on a connection-local change count.
  statements.push(
    assertion(
      "SELECT json(CASE WHEN EXISTS(SELECT 1 FROM words_sessions WHERE owner=? AND id=? AND revision=? AND body=?) THEN '{}' ELSE 'session_changed' END)",
      [user, session.id, revision, serialized],
    ),
  );
  for (const [id, m] of checked)
    statements.push(
      assertion(
        "SELECT json(CASE WHEN EXISTS(SELECT 1 FROM materials m JOIN review_state r ON r.material_id=m.id AND r.owner=m.owner WHERE m.id=? AND m.owner=? AND m.title=? AND m.body=? AND r.active=1) THEN '{}' ELSE 'entry_changed' END)",
        [id, user, m.title, m.body],
      ),
    );
  try {
    await db().batch(statements);
  } catch {
    throw new AppError('Progress changed on another page. Your local answers are retained.', 409);
  }
  const status = session.closed ? await wordsStatus(user, session.timeZone) : null;
  return {
    session,
    revision,
    ...(status
      ? {
          total: status.total,
          due: status.due,
          newCount: status.newCount,
          waitingNew: status.waitingNew,
          today: status.today,
        }
      : {}),
  };
}

export async function resetWords(user: string, input: unknown) {
  const parsed = z
    .object({
      action: z.literal('reset'),
      id: z.string().min(1).max(240),
      version: z.number().int().min(0),
      attemptId: z.string().min(1).max(100),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) throw new AppError('Select an entry to reset.');
  const b = parsed.data,
    eventId = user + ':words-reset:' + b.attemptId;
  const result = await db().batch([
    db()
      .prepare(
        'SELECT m.*,r.rank,r.last_seen FROM materials m LEFT JOIN review_state r ON r.material_id=m.id AND r.owner=m.owner WHERE m.id=? AND m.owner=?',
      )
      .bind(b.id, user),
    db().prepare('SELECT body FROM words_state WHERE material_id=? AND owner=?').bind(b.id, user),
    db().prepare('SELECT * FROM words_sessions WHERE owner=?').bind(user),
    db().prepare('SELECT id FROM words_attempts WHERE id=? AND owner=?').bind(eventId, user),
  ]);
  if (result[3].results.length) return { ok: true, duplicate: true };
  const item: any = result[0].results[0];
  if (!item || item.kind !== 'phrase') throw new AppError('Entry not found.', 404);
  const materialBody = JSON.parse(item.body);
  if ((materialBody._version || 0) !== b.version)
    throw new AppError('This entry changed. Reload the collection before resetting.', 409);
  const existing: any = result[1].results[0],
    stored: any = result[2].results[0],
    key = await hash(wordContent({ ...item, body: materialBody })),
    state = initialWordState(key, learningDay()),
    body = JSON.stringify(state),
    now = new Date().toISOString();
  const statements: any[] = [
    db()
      .prepare(
        'INSERT INTO words_state(material_id,owner,body,updated) VALUES(?,?,?,?) ON CONFLICT(material_id) DO UPDATE SET body=excluded.body,updated=excluded.updated WHERE words_state.owner=excluded.owner AND words_state.body=?',
      )
      .bind(b.id, user, body, now, existing?.body || ''),
    assertion("SELECT json(CASE WHEN changes()=1 THEN '{}' ELSE 'progress_changed' END)", []),
    db()
      .prepare(
        'UPDATE review_state SET rank=0,last_seen=NULL,updated=? WHERE material_id=? AND owner=?',
      )
      .bind(now, b.id, user),
    db()
      .prepare('INSERT INTO words_attempts(id,owner,material_id,body,created) VALUES(?,?,?,?,?)')
      .bind(
        eventId,
        user,
        b.id,
        JSON.stringify({
          action: 'reset',
          contentKey: key,
          previousState: existing ? JSON.parse(existing.body) : null,
          previousRank: item.rank || 0,
          previousLastSeen: item.last_seen || null,
        }),
        now,
      ),
  ];
  if (stored) {
    const session = JSON.parse(stored.body);
    if (session.units?.some((u: any) => u.id === b.id)) session.closed = true;
    statements.push(
      db()
        .prepare(
          'UPDATE words_sessions SET body=?,revision=revision+1,updated=? WHERE owner=? AND revision=?',
        )
        .bind(JSON.stringify(session), now, user, stored.revision),
      assertion("SELECT json(CASE WHEN changes()=1 THEN '{}' ELSE 'session_changed' END)", []),
    );
  } else
    statements.push(
      assertion(
        "SELECT json(CASE WHEN EXISTS(SELECT 1 FROM words_sessions WHERE owner=?) THEN 'session_changed' ELSE '{}' END)",
        [user],
      ),
    );
  statements.push(
    assertion(
      "SELECT json(CASE WHEN EXISTS(SELECT 1 FROM materials WHERE id=? AND owner=? AND title=? AND body=?) THEN '{}' ELSE 'entry_changed' END)",
      [b.id, user, item.title, item.body],
    ),
  );
  try {
    await db().batch(statements);
  } catch {
    throw new AppError('Progress changed on another page. Reload the collection and retry.', 409);
  }
  return { ok: true };
}
