import { practiceQueue } from '../../../lib/practice';
import { AppError, body, db, fail, json, mutation, owner } from '../../../lib/server/common';
import { listMaterials } from '../../../lib/server/materials';
export async function GET(r: Request) {
  try {
    const user = owner(r),
      items = await listMaterials(user);
    return json({
      items: practiceQueue(items, 30),
      total: items.filter((x: any) => x.practice && x.kind === 'phrase' && x.body.en?.trim())
        .length,
    });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(r: Request) {
  try {
    mutation(r);
    const user = owner(r),
      b = await body(r);
    if (
      typeof b.id !== 'string' ||
      typeof b.attemptId !== 'string' ||
      b.attemptId.length > 80 ||
      !['know', 'not_yet'].includes(b.rating)
    )
      throw new AppError('Choose Know or Not yet.');
    const state: any = await db()
      .prepare(
        "SELECT r.* FROM review_state r JOIN materials m ON m.id=r.material_id AND m.owner=r.owner WHERE r.material_id=? AND r.owner=? AND r.active=1 AND COALESCE(json_extract(m.body,'$._archived'),0)=0",
      )
      .bind(b.id, user)
      .first();
    if (!state) throw new AppError('This entry is no longer in practice.', 409);
    const now = new Date().toISOString();
    await db().batch([
      db()
        .prepare(
          'INSERT OR IGNORE INTO review_attempts(id,owner,material_id,rating,created) VALUES(?,?,?,?,?)',
        )
        .bind(user + ':' + b.attemptId, user, b.id, b.rating, now),
      db()
        .prepare(
          'UPDATE review_state SET rank=MIN(5,MAX(0,rank+?)),last_seen=?,updated=? WHERE material_id=? AND owner=? AND changes()=1',
        )
        .bind(b.rating === 'know' ? 1 : -2, now, now, b.id, user),
    ]);
    const updated: any = await db()
      .prepare('SELECT rank FROM review_state WHERE material_id=? AND owner=?')
      .bind(b.id, user)
      .first();
    return json({ ok: true, rank: updated.rank });
  } catch (e) {
    return fail(e);
  }
}
