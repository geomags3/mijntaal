import { AppError, body, fail, json, mutation, owner } from '../../../lib/server/common';
import { getSentences, startSentences, syncSentences } from '../../../lib/server/sentences';
export async function GET(r: Request) {
  try {
    return json(await getSentences(owner(r)));
  } catch (e) {
    return fail(e);
  }
}
export async function POST(r: Request) {
  try {
    mutation(r);
    const user = owner(r),
      b = await body(r);
    if (b.action === 'start') return json(await startSentences(user, b));
    if (b.action === 'batch') return json(await syncSentences(user, b));
    throw new AppError('Unknown sentence action.');
  } catch (e) {
    return fail(e);
  }
}
