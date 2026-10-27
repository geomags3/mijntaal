import { fail, json, owner } from '../../../lib/server/common';
import { listTextLibrary } from '../../../lib/server/materials';
export async function GET(r: Request) {
  try {
    return json(
      await listTextLibrary(owner(r), new URL(r.url).searchParams.get('archived') === 'true'),
    );
  } catch (e) {
    return fail(e);
  }
}
