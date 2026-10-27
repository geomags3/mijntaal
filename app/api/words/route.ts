import { body, fail, json, mutation, owner } from '../../../lib/server/common';
import {
  answerWords,
  commitWords,
  getWords,
  resetWords,
  startWords,
} from '../../../lib/server/words';
export async function GET(r: Request) {
  try {
    return json(
      await getWords(owner(r), new URL(r.url).searchParams.get('timeZone') || 'Europe/Amsterdam'),
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(r: Request) {
  try {
    mutation(r);
    const user = owner(r),
      b = await body(r);
    return json(
      b.action === 'batch'
        ? await commitWords(user, b)
        : b.action === 'reset'
          ? await resetWords(user, b)
          : b.action === 'start'
            ? await startWords(
                user,
                typeof b.timeZone === 'string' ? b.timeZone : 'Europe/Amsterdam',
              )
            : await answerWords(user, b),
    );
  } catch (e) {
    return fail(e);
  }
}
