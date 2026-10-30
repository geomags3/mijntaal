import { fail, json, owner } from '../../../lib/server/common';
import { listCollectionIndex } from '../../../lib/server/materials';
export async function GET(r: Request) {
  try {
    return json(await listCollectionIndex(owner(r)));
  } catch (e) {
    return fail(e);
  }
}
