import { z } from 'zod';
import { practiceMode } from '../practice-mode';
import type { SentenceSession } from '../sentences';
import {
  applySentenceEvent,
  normalizeSentence,
  sentenceEventSchema,
  sentenceSessionSchema,
  shuffledSentences,
} from '../sentences';
import { wordContent } from '../words';
import { AppError, db, hash } from './common';
import { listMaterials } from './materials';
import { getSettings } from './settings';
import { readText } from './texts';
const recordId = async (user: string) => 'sentences-session:' + (await hash(user));
async function stored(user: string) {
  return (await db()
    .prepare('SELECT body FROM lookup_cache WHERE id=? AND owner=?')
    .bind(await recordId(user), user)
    .first()) as { body: string } | null;
}
export async function sentenceSources(user: string) {
  const rows = await db()
    .prepare(
      "SELECT id,title FROM materials WHERE owner=? AND kind='text' AND COALESCE(json_extract(body,'$._archived'),0)=0 ORDER BY created DESC",
    )
    .bind(user)
    .all();
  const sources = [],
    items = [];
  for (const row of rows.results as any[]) {
    const text = await readText(user, row.id);
    const eligible = text.segments.filter(
      (s) => s.en.trim() && s.nl.trim() && s.nl.split(/\s+/).length <= 150,
    );
    sources.push({
      id: row.id,
      title: row.title,
      total: text.segments.length,
      ready: eligible.length,
    });
    items.push(
      ...eligible.map((s) => ({
        id: s.id,
        textId: row.id,
        title: row.title,
        nl: s.nl,
        en: s.en.trim(),
        tokens: [] as string[],
      })),
    );
  }
  const phrases = (await listMaterials(user, '', false, false, 'phrase', true)).filter(
    (m: any) =>
      practiceMode(m) === 'sentences' &&
      typeof m.body.en === 'string' &&
      m.body.en.trim() &&
      m.body.en.length <= 5000,
  );
  const phraseItems = phrases
    .map((m: any) => ({
      id: 'phrase:' + m.id,
      materialId: m.id,
      origin: 'phrase' as const,
      textId: 'saved-phrases',
      title: String(m.body.source || 'Saved phrases').slice(0, 500),
      nl: JSON.parse(wordContent(m)).nl as string,
      en: m.body.en.trim() as string,
      tokens: [] as string[],
    }))
    .filter((m) => m.nl.length <= 1000 && m.nl.split(/\s+/).length <= 150);
  if (phraseItems.length) {
    sources.push({
      id: 'saved-phrases',
      title: 'Saved phrases',
      total: phraseItems.length,
      ready: phraseItems.length,
    });
    items.push(...phraseItems);
  }
  return { sources, items };
}
export async function getSentences(user: string) {
  const [data, row, settings] = await Promise.all([
    sentenceSources(user),
    stored(user),
    getSettings(user),
  ]);
  const saved = row ? JSON.parse(row.body) : { session: null, revision: 0 };
  return {
    sessionSize: settings.preferences.sentences.sessionSize,
    sources: data.sources,
    session: saved.session,
    revision: saved.revision,
    scope: await hash('sentences-browser:' + user),
  };
}
async function commit(user: string, previous: string | null, value: any, guards: any[] = []) {
  const key = await recordId(user),
    serialized = JSON.stringify(value),
    now = new Date().toISOString();
  const change =
    previous === null
      ? db()
          .prepare('INSERT OR IGNORE INTO lookup_cache(id,owner,body,created) VALUES(?,?,?,?)')
          .bind(key, user, serialized, now)
      : db()
          .prepare('UPDATE lookup_cache SET body=?,created=? WHERE id=? AND owner=? AND body=?')
          .bind(serialized, now, key, user, previous);
  try {
    await db().batch([
      change,
      db()
        .prepare(
          "SELECT json(CASE WHEN EXISTS(SELECT 1 FROM lookup_cache WHERE id=? AND owner=? AND body=?) THEN '{}' ELSE 'session_changed' END)",
        )
        .bind(key, user, serialized),
      ...guards,
    ]);
  } catch {
    throw new AppError('Sentences changed on another page. Local answers are retained.', 409);
  }
}
export async function startSentences(user: string, input: unknown) {
  const parsed = z
    .object({
      action: z.literal('start'),
      source: z.string().max(240),
      mode: z.enum(['blocks', 'typing']),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) throw new AppError('Choose a text and an exercise format.');
  const b = parsed.data,
    row = await stored(user),
    previous = row ? JSON.parse(row.body) : { revision: 0 };
  if (previous.session && !previous.session.closed)
    return { session: previous.session, revision: previous.revision };
  const [data, settings] = await Promise.all([sentenceSources(user), getSettings(user)]);
  if (!['all', 'texts'].includes(b.source) && !data.sources.some((t) => t.id === b.source))
    throw new AppError('Text not found.', 404);
  const seen = new Set<string>(),
    id = crypto.randomUUID(),
    items = shuffledSentences(
      data.items.filter(
        (s) =>
          b.source === 'all' ||
          (b.source === 'texts' && s.textId !== 'saved-phrases') ||
          s.textId === b.source,
      ),
      id,
    )
      .filter((s) => {
        const key = normalizeSentence(s.nl);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, settings.preferences.sentences.sessionSize)
      .map((s) => ({ ...s, tokens: shuffledSentences(s.nl.split(/\s+/), id + s.id) }));
  if (!items.length)
    throw new AppError(
      'No sentences available. Prepare a text or add translated phrases to Sentences.',
    );
  const session: SentenceSession = {
    id,
    source: b.source,
    mode: b.mode,
    items,
    index: 0,
    hinted: false,
    feedback: null,
    results: [],
    closed: false,
  };
  const value = { session, revision: previous.revision + 1, eventIds: [] };
  await commit(user, row?.body ?? null, value);
  return { session, revision: value.revision };
}
export async function syncSentences(user: string, input: unknown) {
  const parsed = z
    .object({
      action: z.literal('batch'),
      sessionId: z.string().max(100),
      revision: z.number().int().min(1),
      events: z.array(sentenceEventSchema).min(1).max(80),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) throw new AppError('Check the sentence actions.');
  const b = parsed.data;
  if (new Set(b.events.map((e) => e.id)).size !== b.events.length)
    throw new AppError('Duplicate sentence actions.');
  const row = await stored(user);
  if (!row) throw new AppError('Start a round first.', 409);
  const value = JSON.parse(row.body);
  let s = sentenceSessionSchema.parse(value.session);
  if (s.id !== b.sessionId)
    throw new AppError('Another round has started. Local answers are retained.', 409);
  const ids = new Set<string>(value.eventIds || []);
  if (b.events.every((e) => ids.has(e.id)))
    return { session: s, revision: value.revision, duplicate: true };
  if (value.revision !== b.revision || b.events.some((e) => ids.has(e.id)))
    throw new AppError('Sentences changed on another page. Local answers are retained.', 409);
  const guards = [];
  for (const textId of new Set(
    b.events.some((e) => e.action !== 'finish')
      ? s.items.filter((i) => i.origin !== 'phrase').map((i) => i.textId)
      : [],
  )) {
    const material: any = await db()
      .prepare('SELECT body FROM materials WHERE id=? AND owner=?')
      .bind(textId, user)
      .first();
    if (!material) throw new AppError('Source text not found.', 409);
    const text = await readText(user, textId);
    for (const item of s.items.filter((i) => i.textId === textId)) {
      const segment = text.segments.find((x) => x.id === item.id);
      if (!segment || segment.nl !== item.nl || segment.en.trim() !== item.en)
        throw new AppError(
          'A source sentence changed. Finish recovery before starting a new round.',
          409,
        );
    }
    guards.push(
      db()
        .prepare(
          "SELECT json(CASE WHEN EXISTS(SELECT 1 FROM materials WHERE id=? AND owner=? AND body=?) THEN '{}' ELSE 'source_changed' END)",
        )
        .bind(textId, user, material.body),
    );
  }
  if (b.events.some((e) => e.action !== 'finish'))
    for (const item of s.items.filter((i) => i.origin === 'phrase')) {
      if (!item.materialId) throw new AppError('Saved phrase not found.', 409);
      const material: any = await db()
        .prepare(
          'SELECT m.*,r.active AS practice FROM materials m LEFT JOIN review_state r ON r.material_id=m.id AND r.owner=m.owner WHERE m.id=? AND m.owner=?',
        )
        .bind(item.materialId, user)
        .first();
      if (!material) throw new AppError('Saved phrase not found.', 409);
      const parsed = {
        ...material,
        body: JSON.parse(material.body),
        practice: !!material.practice,
      };
      if (
        parsed.kind !== 'phrase' ||
        parsed.body._archived ||
        practiceMode(parsed) !== 'sentences' ||
        JSON.parse(wordContent(parsed)).nl !== item.nl ||
        String(parsed.body.en || '').trim() !== item.en
      )
        throw new AppError(
          'A saved phrase changed or left Sentences. Local answers are retained.',
          409,
        );
      guards.push(
        db()
          .prepare(
            "SELECT json(CASE WHEN EXISTS(SELECT 1 FROM materials m JOIN review_state r ON r.material_id=m.id AND r.owner=m.owner WHERE m.id=? AND m.owner=? AND m.title=? AND m.body=? AND r.active=1) THEN '{}' ELSE 'source_changed' END)",
          )
          .bind(item.materialId, user, material.title, material.body),
      );
    }
  try {
    for (const e of b.events) s = applySentenceEvent(s, e);
  } catch (e) {
    throw new AppError((e as Error).message);
  }
  const next = {
    session: s,
    revision: value.revision + b.events.length,
    eventIds: [...(value.eventIds || []), ...b.events.map((e) => e.id)],
  };
  await commit(user, row.body, next, guards);
  return { session: s, revision: next.revision };
}
