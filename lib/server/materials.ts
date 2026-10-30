import { waitUntil } from 'cloudflare:workers';
import { wordContent } from '../words';
import { elevenSpeech } from './eleven-speech';
import { z } from 'zod';
import { AppError, db } from './common';
import { attachLearningProgress } from './word-progress';
export const materialSchema = z.object({
  kind: z.enum(['phrase', 'text', 'note']),
  title: z.string().trim().min(1).max(500),
  body: z.record(z.string(), z.unknown()).default({}),
  practice: z.boolean().optional(),
  practiceMode: z.enum(['words', 'sentences', 'off']).optional(),
});
export async function listMaterials(
  user: string,
  search = '',
  archived = false,
  withLearning = false,
  kind?: 'phrase' | 'text' | 'note',
  summary = false,
) {
  const r = await db()
    .prepare(
      'SELECT ' +
        (summary
          ? "m.id,m.owner,m.kind,m.title,json_remove(m.body,'$.dictionarySnapshot','$.forms') AS body,m.created"
          : 'm.*') +
        ',r.rank,r.active AS practice,r.last_seen FROM materials m LEFT JOIN review_state r ON r.material_id=m.id AND r.owner=m.owner WHERE m.owner=?' +
        (kind ? ' AND m.kind=?' : '') +
        ' ORDER BY m.created DESC',
    )
    .bind(...(kind ? [user, kind] : [user]))
    .all();
  const items = r.results
    .map((row: any) => ({
      ...row,
      body: JSON.parse(row.body),
      rank: row.rank || 0,
      practice: !!row.practice,
      version: JSON.parse(row.body)._version || 0,
    }))
    .filter((x: any) => !!x.body._archived === archived)
    .filter(
      (x: any) =>
        !search ||
        (x.title + ' ' + JSON.stringify(x.body))
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
    );
  return withLearning ? attachLearningProgress(user, items) : items;
}
function selectedPractice(input: any, body: any, previous: any = {}) {
  const explicit =
    input.practiceMode !== undefined ||
    Object.prototype.hasOwnProperty.call(input.body || {}, 'practiceMode');
  if (explicit) {
    const mode = input.practiceMode ?? body.practiceMode;
    if (!['words', 'sentences', 'off'].includes(mode))
      throw new AppError('Choose Words, Sentences or Off.');
    return mode;
  }
  if (typeof input.practice === 'boolean')
    return input.practice ? (previous.practiceMode === 'sentences' ? 'sentences' : 'words') : 'off';
  return undefined;
}
function checkPractice(mode: string | undefined, kind: string, body: any) {
  if (
    mode &&
    mode !== 'off' &&
    (kind !== 'phrase' || typeof body.en !== 'string' || !body.en.trim())
  )
    throw new AppError('Add an English meaning before practising this entry.');
  if (mode === 'sentences' && String(body.en).length > 5000)
    throw new AppError('Keep the English meaning under 5,000 characters.');
}
/** Collection writes finish even if optional provider preparation fails. */
function prepareMaterialAudio(
  user: string,
  item: { kind: string; title: string; body: Record<string, unknown> },
) {
  if (item.kind !== 'phrase' || item.body._archived || typeof waitUntil !== 'function') return;
  const text = JSON.parse(wordContent(item)).nl;
  if (!text || text.length > 1500) return;
  waitUntil(
    elevenSpeech(user, text)
      .then(() => {})
      .catch(() => {
        // Manual playback or the next round can retry; never discard a saved entry.
      }),
  );
}
export async function addMaterial(user: string, input: any) {
  const parsed = materialSchema.safeParse(input);
  if (!parsed.success) throw new AppError('Add a title and choose a valid material type.');
  const b = parsed.data;
  if (JSON.stringify(b.body).length > 60000) throw new AppError('This material is too large.');
  let mode = selectedPractice(b, b.body);
  if (b.practiceMode !== undefined || b.body.practiceMode !== undefined)
    checkPractice(mode, b.kind, b.body);
  else if (b.kind !== 'phrase' || typeof b.body.en !== 'string' || !b.body.en.trim()) mode = 'off';
  const existing: any = await db()
    .prepare(
      "SELECT id,body FROM materials WHERE owner=? AND kind=? AND lower(trim(title))=lower(trim(?)) AND COALESCE(json_extract(body,'$.en'),'')=? AND COALESCE(json_extract(body,'$._archived'),0)=0 LIMIT 1",
    )
    .bind(user, b.kind, b.title, typeof b.body.en === 'string' ? b.body.en : '')
    .first();
  if (existing) {
    prepareMaterialAudio(user, { ...b, body: JSON.parse(existing.body) });
    return { id: existing.id, duplicate: true, version: JSON.parse(existing.body)._version || 0 };
  }
  const id = crypto.randomUUID(),
    now = new Date().toISOString();
  const clean = {
    ...b.body,
    ...(b.kind === 'phrase' && mode ? { practiceMode: mode } : {}),
    _version: 1,
    _archived: false,
  };
  await db().batch([
    db()
      .prepare('INSERT INTO materials(id,owner,kind,title,body,created) VALUES(?,?,?,?,?,?)')
      .bind(id, user, b.kind, b.title, JSON.stringify(clean), now),
    db()
      .prepare('INSERT INTO review_state(material_id,owner,rank,active,updated) VALUES(?,?,?,?,?)')
      .bind(id, user, 0, mode && mode !== 'off' ? 1 : 0, now),
  ]);
  prepareMaterialAudio(user, { ...b, body: clean });
  return { id, version: 1 };
}
export async function updateMaterial(user: string, input: any) {
  if (typeof input.id !== 'string' || !Number.isInteger(input.version))
    throw new AppError('Select a saved entry and its version.');
  const row: any = await db()
    .prepare('SELECT * FROM materials WHERE id=? AND owner=?')
    .bind(input.id, user)
    .first();
  if (!row) throw new AppError('Entry not found.', 404);
  const previous = JSON.parse(row.body);
  if ((previous._version || 0) !== input.version)
    throw new AppError('This entry changed on another device. Reload it before saving.', 409);
  const parsed = materialSchema.safeParse({
    kind: input.kind ?? row.kind,
    title: input.title ?? row.title,
    body: { ...previous, ...(input.body || {}) },
    ...(input.practiceMode !== undefined ? { practiceMode: input.practiceMode } : {}),
  });
  if (!parsed.success) throw new AppError('Check the entry title and fields.');
  const b = parsed.data;
  if (JSON.stringify(b.body).length > 60000) throw new AppError('This material is too large.');
  const mode = selectedPractice(input, b.body, previous);
  checkPractice(mode, b.kind, b.body);
  const next = {
    ...b.body,
    ...(mode ? { practiceMode: mode } : {}),
    _version: input.version + 1,
    _archived: typeof input.archived === 'boolean' ? input.archived : !!previous._archived,
  };
  const statements = [
    db()
      .prepare(
        "UPDATE materials SET title=?,kind=?,body=? WHERE id=? AND owner=? AND COALESCE(json_extract(body,'$._version'),0)=?",
      )
      .bind(b.title, b.kind, JSON.stringify(next), input.id, user, input.version),
    db().prepare("SELECT json(CASE WHEN changes()=1 THEN '{}' ELSE 'entry_changed' END)"),
  ];
  if (mode)
    statements.push(
      db()
        .prepare(
          'INSERT INTO review_state(material_id,owner,rank,active,updated) VALUES(?,?,0,?,?) ON CONFLICT(material_id) DO UPDATE SET active=excluded.active,updated=excluded.updated',
        )
        .bind(input.id, user, mode !== 'off' ? 1 : 0, new Date().toISOString()),
    );
  try {
    await db().batch(statements);
  } catch {
    throw new AppError('This entry changed. Reload it before saving.', 409);
  }
  prepareMaterialAudio(user, { ...b, body: next });
  return { id: input.id, version: next._version };
}

/** Titles/source/counts only: listing a library never loads every text or word's learning state. */
export async function listTextLibrary(user: string, archived = false) {
  const r = await db()
    .prepare(
      "SELECT id,title,COALESCE(json_extract(body,'$.source'),'') AS source,COALESCE(json_array_length(body,'$.segments'),0) AS sentenceCount,COALESCE(json_extract(body,'$._version'),0) AS version FROM materials WHERE owner=? AND kind='text' AND COALESCE(json_extract(body,'$._archived'),0)=? ORDER BY created DESC",
    )
    .bind(user, archived ? 1 : 0)
    .all();
  return r.results;
}

export async function getMaterial(user: string, id: string) {
  const row: any = await db()
    .prepare(
      'SELECT m.*,r.rank,r.active AS practice,r.last_seen FROM materials m LEFT JOIN review_state r ON r.material_id=m.id AND r.owner=m.owner WHERE m.id=? AND m.owner=?',
    )
    .bind(id, user)
    .first();
  if (!row) throw new AppError('Entry not found.', 404);
  const body = JSON.parse(row.body);
  return {
    ...row,
    body,
    rank: row.rank || 0,
    practice: !!row.practice,
    version: body._version || 0,
  };
}
