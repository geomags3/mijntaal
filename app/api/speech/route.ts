import { body, fail, mutation, owner } from '../../../lib/server/common';
import { elevenSpeech } from '../../../lib/server/eleven-speech';
export async function POST(r: Request) {
  try {
    mutation(r);
    return await elevenSpeech(owner(r), String((await body(r)).text || ''));
  } catch (e) {
    return fail(e);
  }
}
