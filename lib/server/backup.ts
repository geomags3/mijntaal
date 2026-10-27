import { z } from 'zod';
import { segmentText } from '../text-segments';
import { wordSessionSchema, wordStateSchema } from '../words';
import { AppError, db, hash } from './common';
const id = z.string().min(1).max(240),
  date = z.string().datetime({ offset: true });
const material = z
  .object({
    id,
    kind: z.enum(['phrase', 'text', 'note']),
    title: z.string().min(1).max(500),
    body: z.record(z.string(), z.unknown()),
    created: date,
  })
  .strict();
const state = z
  .object({
    materialId: id,
    rank: z.number().int().min(0).max(5),
    active: z.boolean(),
    lastSeen: date.nullable(),
    updated: date,
  })
  .strict();
const attempt = z
  .object({ id, materialId: id, rating: z.enum(['know', 'not_yet']), created: date })
  .strict();
const translation = z
  .object({
    materialId: id,
    nl: z.string().min(1).max(1000),
    occurrence: z.number().int().min(0).max(399),
    en: z.string().min(1).max(5000),
  })
  .strict();
export const backupSchema = z
  .object({
    format: z.literal('ultimately-dutch-backup'),
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    exportedAt: date,
    materials: z.array(material).max(5000),
    reviewState: z.array(state).max(5000),
    reviewAttempts: z.array(attempt).max(50000),
    textTranslations: z.array(translation).max(20000),
    wordsState: z
      .array(z.object({ materialId: id, body: wordStateSchema, updated: date }).strict())
      .max(5000)
      .default([]),
    wordsAttempts: z
      .array(
        z
          .object({ id, materialId: id, body: z.record(z.string(), z.unknown()), created: date })
          .strict(),
      )
      .max(50000)
      .default([]),
    wordsSession: z
      .object({ id, revision: z.number().int().min(1), body: wordSessionSchema, updated: date })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();
type Backup = z.infer<typeof backupSchema>;
function canonical(v: any): string {
  return JSON.stringify(v, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, value[k]]),
        )
      : value,
  );
}
function fingerprint(m: any) {
  const { _version, ...body } = m.body;
  return canonical({ kind: m.kind, title: m.title, body });
}
async function segments(materialId: string, body: any) {
  const out: { nl: string; occurrence: number; id: string; legacy: string; en: string }[] = [],
    counts = new Map<string, number>();
  for (const [i, s] of (body.segments || []).entries()) {
    if (typeof s.nl !== 'string') continue;
    const parts = segmentText(s.nl);
    for (const [j, nl] of parts.entries()) {
      const occurrence = counts.get(nl) || 0;
      counts.set(nl, occurrence + 1);
      out.push({
        nl,
        occurrence,
        id: await hash('text-segment-v2:' + materialId + ':' + occurrence + ':' + nl),
        legacy: await hash('text-segment-v1:' + materialId + ':' + i + ':' + j + ':' + nl),
        en: parts.length === 1 && typeof s.en === 'string' ? s.en : '',
      });
    }
  }
  return out;
}
function parse(input: unknown): Backup {
  const parsed = backupSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError('This is not a supported complete backup (format version 1 or 2).');
  const b = parsed.data,
    ids = new Set<string>();
  for (const m of b.materials) {
    if (ids.has(m.id)) throw new AppError('The backup contains repeated entry IDs.');
    ids.add(m.id);
    if (JSON.stringify(m.body).length > 60000)
      throw new AppError('An entry exceeds the supported size.');
    if (
      m.kind === 'text' &&
      (!Array.isArray(m.body.segments) ||
        m.body.segments.length > 400 ||
        m.body.segments.some((s: any) => !s || typeof s.nl !== 'string') ||
        m.body.segments.reduce((n: number, s: any) => n + segmentText(s.nl).length, 0) > 400)
    )
      throw new AppError('A text has invalid sentences.');
    if (
      m.body._version !== undefined &&
      (!Number.isInteger(m.body._version) || Number(m.body._version) < 0)
    )
      throw new AppError('An entry has an invalid version.');
    if (m.body._archived !== undefined && typeof m.body._archived !== 'boolean')
      throw new AppError('An entry has an invalid archive status.');
    for (const k of [
      'en',
      'example',
      'exampleTranslation',
      'notes',
      'lemma',
      'selectedForm',
      'source',
      'textId',
      'segmentId',
    ])
      if (m.body[k] !== undefined && typeof m.body[k] !== 'string')
        throw new AppError('An entry has invalid text fields.');
  }
  for (const [name, records, key] of [
    ['Words state', b.wordsState, 'materialId'],
    ['Words history', b.wordsAttempts, 'id'],
  ] as const) {
    const seen = new Set<string>();
    for (const record of records) {
      if (!ids.has(record.materialId) || seen.has((record as any)[key]))
        throw new AppError('The backup has invalid ' + name + ' references.');
      if (JSON.stringify(record.body).length > 30000)
        throw new AppError('A learning record exceeds the supported size.');
      seen.add((record as any)[key]);
    }
  }
  if (b.wordsSession) {
    const s = b.wordsSession.body;
    if (
      s.id !== b.wordsSession.id ||
      s.units.some((u) => !ids.has(u.id)) ||
      new Set(s.units.map((u) => u.id)).size !== s.units.length ||
      (s.question && !s.units.some((u) => u.id === s.question?.unitId))
    )
      throw new AppError('The backup has invalid Words session references.');
  }
  for (const m of b.materials) {
    const target = b.materials.find((t) => t.id === m.body.textId);
    if (target && target.kind !== 'text')
      throw new AppError('An entry has an invalid source text reference.');
  }
  for (const [name, rows, key] of [
    ['review state', b.reviewState, 'materialId'],
    ['review history', b.reviewAttempts, 'id'],
  ] as const) {
    const seen = new Set<string>();
    for (const row of rows) {
      if (!ids.has(row.materialId))
        throw new AppError('The backup has a broken learning reference.');
      if (seen.has((row as any)[key]))
        throw new AppError('The backup contains repeated ' + name + ' IDs.');
      seen.add((row as any)[key]);
    }
  }
  const translations = new Set<string>();
  for (const t of b.textTranslations) {
    const m = b.materials.find((m) => m.id === t.materialId);
    if (!m || m.kind !== 'text') throw new AppError('A translation refers to a missing text.');
    const key = canonical([t.materialId, t.nl, t.occurrence]);
    if (translations.has(key)) throw new AppError('The backup contains repeated translations.');
    translations.add(key);
  }
  return b;
}
export async function exportBackup(user: string): Promise<Backup> {
  const results = await db().batch([
    db()
      .prepare('SELECT id,kind,title,body,created FROM materials WHERE owner=? ORDER BY id')
      .bind(user),
    db().prepare('SELECT * FROM review_state WHERE owner=? ORDER BY material_id').bind(user),
    db().prepare('SELECT * FROM review_attempts WHERE owner=? ORDER BY id').bind(user),
    db()
      .prepare("SELECT id,body FROM lookup_cache WHERE owner=? AND id LIKE 'text-translation:%'")
      .bind(user),
    db().prepare('SELECT * FROM words_state WHERE owner=? ORDER BY material_id').bind(user),
    db().prepare('SELECT * FROM words_attempts WHERE owner=? ORDER BY id').bind(user),
    db().prepare('SELECT * FROM words_sessions WHERE owner=?').bind(user),
  ]);
  const materials = (results[0].results as any[]).map((m) => ({ ...m, body: JSON.parse(m.body) })),
    cache = new Map((results[3].results as any[]).map((c) => [c.id, JSON.parse(c.body)])),
    textTranslations: Backup['textTranslations'] = [];
  for (const m of materials.filter((m) => m.kind === 'text'))
    for (const s of await segments(m.id, m.body)) {
      const en =
        cache.get('text-translation:' + s.id)?.en ||
        cache.get('text-translation:' + s.legacy)?.en ||
        s.en;
      if (en) textTranslations.push({ materialId: m.id, nl: s.nl, occurrence: s.occurrence, en });
    }
  const result = parse({
    format: 'ultimately-dutch-backup',
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    materials,
    reviewState: (results[1].results as any[]).map((s) => ({
      materialId: s.material_id,
      rank: s.rank,
      active: !!s.active,
      lastSeen: s.last_seen,
      updated: s.updated,
    })),
    reviewAttempts: (results[2].results as any[]).map((a) => ({
      id: a.id,
      materialId: a.material_id,
      rating: a.rating,
      created: a.created,
    })),
    textTranslations,
    wordsState: (results[4].results as any[]).map((s) => ({
      materialId: s.material_id,
      body: JSON.parse(s.body),
      updated: s.updated,
    })),
    wordsAttempts: (results[5].results as any[]).map((a) => ({
      id: a.id,
      materialId: a.material_id,
      body: JSON.parse(a.body),
      created: a.created,
    })),
    wordsSession:
      (results[6].results as any[]).map((s) => ({
        id: s.id,
        revision: s.revision,
        body: JSON.parse(s.body),
        updated: s.updated,
      }))[0] || null,
  });
  if (new TextEncoder().encode(JSON.stringify(result)).length > 11000000)
    throw new AppError('This collection exceeds the current 11 MB backup limit.');
  return result;
}
async function current(user: string) {
  const r = await db()
    .prepare('SELECT id,kind,title,body,created FROM materials WHERE owner=? ORDER BY id')
    .bind(user)
    .all();
  return (r.results as any[]).map((m) => ({ ...m, body: JSON.parse(m.body) }));
}
function chunks<T>(rows: T[], maxRows = 100) {
  const result: T[][] = [];
  let part: T[] = [],
    size = 0;
  for (const row of rows) {
    const length = JSON.stringify(row).length;
    if (part.length && (part.length >= maxRows || size + length > 300000)) {
      result.push(part);
      part = [];
      size = 0;
    }
    part.push(row);
    size += length;
  }
  if (part.length) result.push(part);
  return result;
}
async function plan(user: string, b: Backup) {
  const existing = await current(user),
    byId = new Map(existing.map((m) => [m.id, m])),
    byFingerprint = new Map(existing.map((m) => [fingerprint(m), m])),
    global = new Set<string>();
  for (const part of chunks(
    b.materials.map((m) => m.id),
    1000,
  )) {
    const r = await db()
      .prepare('SELECT id FROM materials WHERE id IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(part))
      .all();
    for (const row of r.results as any[]) global.add(row.id);
  }
  const mapping = new Map<string, string>();
  for (const m of b.materials)
    mapping.set(
      m.id,
      !byId.has(m.id) && global.has(m.id)
        ? await hash('backup-material:' + user + ':' + m.id)
        : m.id,
    );
  const segmentMap = new Map<string, string>(),
    validTranslations = new Set<string>();
  for (const m of b.materials.filter((m) => m.kind === 'text'))
    for (const seg of await segments(m.id, m.body)) {
      const next = await hash(
        'text-segment-v2:' + mapping.get(m.id) + ':' + seg.occurrence + ':' + seg.nl,
      );
      segmentMap.set(m.id + '|' + seg.id, next);
      segmentMap.set(m.id + '|' + seg.legacy, next);
      validTranslations.add(canonical([m.id, seg.nl, seg.occurrence]));
    }
  for (const t of b.textTranslations)
    if (!validTranslations.has(canonical([t.materialId, t.nl, t.occurrence])))
      throw new AppError('A translation does not match its text.');
  const accepted: any[] = [],
    newEntries: any[] = [],
    rows: { id: string; title: string; status: string }[] = [];
  for (const m of b.materials) {
    const body = { ...m.body },
      sourceText = body.textId;
    if (typeof sourceText === 'string' && mapping.has(sourceText)) {
      if (typeof body.segmentId === 'string')
        body.segmentId = segmentMap.get(sourceText + '|' + body.segmentId) || body.segmentId;
      body.textId = mapping.get(sourceText);
    }
    const next = { ...m, id: mapping.get(m.id)!, body },
      target = byId.get(next.id);
    if (target) {
      const same = fingerprint(target) === fingerprint(next);
      rows.push({ id: m.id, title: m.title, status: same ? 'existing' : 'conflict' });
      if (same) accepted.push(target);
      continue;
    }
    const duplicate = m.kind === 'text' ? undefined : byFingerprint.get(fingerprint(next));
    if (duplicate) {
      mapping.set(m.id, duplicate.id);
      accepted.push(duplicate);
      rows.push({ id: m.id, title: m.title, status: 'existing' });
      continue;
    }
    newEntries.push(next);
    accepted.push(next);
    rows.push({ id: m.id, title: m.title, status: 'new' });
    byFingerprint.set(fingerprint(next), next);
  }
  for (const row of rows.filter((r) => r.status === 'conflict'))
    for (const m of b.materials.filter((m) => m.body.textId === row.id)) {
      const related = rows.find((r) => r.id === m.id);
      if (related) {
        related.status = 'conflict';
        const target = mapping.get(m.id);
        for (let i = newEntries.length - 1; i >= 0; i--)
          if (newEntries[i].id === target) newEntries.splice(i, 1);
        for (let i = accepted.length - 1; i >= 0; i--)
          if (accepted[i].id === target) accepted.splice(i, 1);
      }
    }
  const allowed = new Set(rows.filter((r) => r.status !== 'conflict').map((r) => r.id)),
    revision = await hash(canonical(existing));
  return {
    mapping,
    allowed,
    accepted,
    newEntries,
    rows,
    token: await hash(canonical(b) + '|' + revision),
    summary: {
      new: newEntries.length,
      existing: rows.filter((r) => r.status === 'existing').length,
      conflicts: rows.filter((r) => r.status === 'conflict').length,
      archived: b.materials.filter((m) => m.body._archived).length,
      attempts: b.reviewAttempts.length,
      translations: b.textTranslations.length,
    },
  };
}
export async function previewBackup(user: string, input: unknown) {
  const b = parse(input),
    p = await plan(user, b);
  return {
    token: p.token,
    summary: p.summary,
    rows: p.rows,
    limits:
      'Words, texts, notes, archive, learning history and text translations. Audio files and API keys are not included.',
  };
}
export async function importBackup(user: string, input: unknown, token: string) {
  const b = parse(input),
    p = await plan(user, b);
  if (typeof token !== 'string' || token !== p.token)
    throw new AppError('The collection or file changed. Preview the import again.', 409);
  const now = new Date().toISOString(),
    statements: any[] = [];
  // JSON row batches keep large collections below D1's parameter/query limits.
  const insert = (sql: string, rows: any[]) => {
    for (const part of chunks(rows))
      statements.push(db().prepare(sql).bind(user, JSON.stringify(part)));
  };
  insert(
    "INSERT OR IGNORE INTO materials(id,owner,kind,title,body,created) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.kind'),json_extract(value,'$.title'),json_extract(value,'$.body'),json_extract(value,'$.created') FROM json_each(?)",
    p.newEntries.map((m) => ({ ...m, body: JSON.stringify(m.body) })),
  );
  const states = b.reviewState
    .filter((s) => p.allowed.has(s.materialId))
    .map((s) => ({ ...s, materialId: p.mapping.get(s.materialId)! }));
  for (const m of p.newEntries)
    if (!states.some((s) => s.materialId === m.id))
      states.push({ materialId: m.id, rank: 0, active: false, lastSeen: null, updated: now });
  insert(
    "INSERT OR IGNORE INTO review_state(material_id,owner,rank,active,last_seen,updated) SELECT json_extract(value,'$.materialId'),?,json_extract(value,'$.rank'),json_extract(value,'$.active'),json_extract(value,'$.lastSeen'),json_extract(value,'$.updated') FROM json_each(?)",
    states,
  );
  const existingAttempts = new Map<string, any>();
  for (const part of chunks(
    b.reviewAttempts.map((a) => a.id),
    1000,
  )) {
    const r = await db()
      .prepare('SELECT id,owner FROM review_attempts WHERE id IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(part))
      .all();
    for (const row of r.results as any[]) existingAttempts.set(row.id, row);
  }
  const attempts = [];
  for (const a of b.reviewAttempts.filter((a) => p.allowed.has(a.materialId)))
    attempts.push({
      ...a,
      id:
        existingAttempts.has(a.id) && existingAttempts.get(a.id).owner !== user
          ? 'restored:' + (await hash(user + '|' + a.id))
          : a.id,
      materialId: p.mapping.get(a.materialId)!,
    });
  insert(
    "INSERT OR IGNORE INTO review_attempts(id,owner,material_id,rating,created) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.materialId'),json_extract(value,'$.rating'),json_extract(value,'$.created') FROM json_each(?)",
    attempts,
  );
  const translations = [];
  for (const t of b.textTranslations) {
    if (!p.allowed.has(t.materialId)) continue;
    const key =
      'text-translation:' +
      (await hash(
        'text-segment-v2:' + p.mapping.get(t.materialId) + ':' + t.occurrence + ':' + t.nl,
      ));
    translations.push({ id: key, body: JSON.stringify({ en: t.en }), created: now });
  }
  insert(
    "INSERT OR IGNORE INTO lookup_cache(id,owner,body,created) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.body'),json_extract(value,'$.created') FROM json_each(?)",
    translations,
  );
  const learningStates = b.wordsState
    .filter((s) => p.allowed.has(s.materialId))
    .map((s) => ({ ...s, materialId: p.mapping.get(s.materialId)!, body: JSON.stringify(s.body) }));
  insert(
    "INSERT OR IGNORE INTO words_state(material_id,owner,body,updated) SELECT json_extract(value,'$.materialId'),?,json_extract(value,'$.body'),json_extract(value,'$.updated') FROM json_each(?)",
    learningStates,
  );
  const globalWordAttempts = new Map<string, string>();
  for (const part of chunks(
    b.wordsAttempts.map((a) => a.id),
    1000,
  )) {
    const r = await db()
      .prepare('SELECT id,owner FROM words_attempts WHERE id IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(part))
      .all();
    for (const a of r.results as any[]) globalWordAttempts.set(a.id, a.owner);
  }
  const wordAttempts = [];
  for (const a of b.wordsAttempts.filter((a) => p.allowed.has(a.materialId)))
    wordAttempts.push({
      ...a,
      id:
        globalWordAttempts.has(a.id) && globalWordAttempts.get(a.id) !== user
          ? 'words-restored:' + (await hash(user + '|' + a.id))
          : a.id,
      materialId: p.mapping.get(a.materialId)!,
      body: JSON.stringify(a.body),
    });
  insert(
    "INSERT OR IGNORE INTO words_attempts(id,owner,material_id,body,created) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.materialId'),json_extract(value,'$.body'),json_extract(value,'$.created') FROM json_each(?)",
    wordAttempts,
  );
  if (b.wordsSession && b.wordsSession.body.units.every((u) => p.allowed.has(u.id))) {
    const session = structuredClone(b.wordsSession);
    session.body.units = session.body.units.map((u) => ({ ...u, id: p.mapping.get(u.id)! }));
    if (session.body.choicePool)
      session.body.choicePool = session.body.choicePool
        .filter((u) => p.allowed.has(u.id))
        .map((u) => ({ ...u, id: p.mapping.get(u.id)! }));
    if (session.body.question)
      session.body.question.unitId = p.mapping.get(session.body.question.unitId)!;
    insert(
      "INSERT OR IGNORE INTO words_sessions(owner,id,revision,body,updated) SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.revision'),json_extract(value,'$.body'),json_extract(value,'$.updated') FROM json_each(?)",
      [{ ...session, body: JSON.stringify(session.body) }],
    );
  }
  // This final assertion runs in the same atomic batch: a concurrent edit/collision rolls every insert back.
  for (const part of chunks(
    p.accepted.map((m) => ({
      id: m.id,
      title: m.title,
      kind: m.kind,
      body: JSON.stringify(m.body),
    })),
  ))
    statements.push(
      db()
        .prepare(
          "SELECT json(CASE WHEN EXISTS (SELECT 1 FROM json_each(?) e LEFT JOIN materials m ON m.id=json_extract(e.value,'$.id') AND m.owner=? WHERE m.id IS NULL OR m.title<>json_extract(e.value,'$.title') OR m.kind<>json_extract(e.value,'$.kind') OR m.body<>json_extract(e.value,'$.body')) THEN 'collection_changed' ELSE '{}' END)",
        )
        .bind(JSON.stringify(part), user),
    );
  try {
    if (statements.length) await db().batch(statements);
  } catch {
    throw new AppError(
      'Import could not be completed. Nothing was imported. Preview again and retry.',
      409,
    );
  }
  return { ...p.summary, imported: p.newEntries.length };
}
