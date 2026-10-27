import { learningProgress } from '../word-progress';
import { initialWordState, learningDay, wordContent, wordStateSchema } from '../words';
import { db, hash } from './common';
export async function attachLearningProgress(user: string, items: any[]) {
  const rows = await db()
      .prepare('SELECT material_id,body FROM words_state WHERE owner=?')
      .bind(user)
      .all(),
    states = new Map((rows.results as any[]).map((r) => [r.material_id, r.body])),
    today = learningDay();
  return Promise.all(
    items.map(async (item) => {
      if (item.kind !== 'phrase') return item;
      const key = await hash(wordContent(item));
      let state;
      try {
        state = wordStateSchema.parse(JSON.parse(states.get(item.id) || 'null'));
      } catch {}
      if (!state || state.contentKey !== key)
        state = initialWordState(key, today, !!item.last_seen);
      return { ...item, learning: learningProgress(state, today) };
    }),
  );
}
