import { AppError, body, fail, json, mutation, owner } from '../../../lib/server/common';
import { editText, prepareTextAudio, readText, translateText } from '../../../lib/server/texts';
export async function GET(r: Request) {
  try {
    return json(await readText(owner(r), new URL(r.url).searchParams.get('id') || ''));
  } catch (e) {
    return fail(e);
  }
}
export async function POST(r: Request) {
  try {
    mutation(r);
    const user = owner(r),
      b = await body(r);
    if (typeof b.id !== 'string') throw new AppError('Choose a text.');
    if (b.action === 'edit') return json(await editText(user, b.id, b));
    if (b.action === 'translate')
      return json(await translateText(user, b.id, b.segments, r.signal));
    if ((b.action === 'audio' || b.action === 'audio-fragment') && typeof b.segment === 'string')
      return await prepareTextAudio(user, b.id, b.segment, b.action === 'audio-fragment');
    throw new AppError('Unknown text action.');
  } catch (e) {
    return fail(e);
  }
}
