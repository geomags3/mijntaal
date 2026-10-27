import { body, fail, json, mutation, owner } from '../../../lib/server/common';
import { elevenStatus, manageEleven } from '../../../lib/server/eleven-speech';
export async function GET(r: Request) {
  try {
    return json(await elevenStatus(owner(r)));
  } catch (e) {
    return fail(e);
  }
}
export async function POST(r: Request) {
  try {
    mutation(r);
    return json(await manageEleven(owner(r), await body(r)));
  } catch (e) {
    return fail(e);
  }
}
