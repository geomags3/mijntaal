import { getProgram, listPrograms, saveProgram } from '../../../lib/server/lessons';
import { body, fail, json, mutation, owner } from '../../../lib/server/common';
export async function GET(r: Request) {
  try {
    const u = new URL(r.url),
      user = owner(r),
      id = u.searchParams.get('id');
    return json(
      id
        ? await getProgram(user, id)
        : await listPrograms(user, u.searchParams.get('archived') === 'true'),
    );
  } catch (e) {
    return fail(e);
  }
}
export async function PUT(r: Request) {
  try {
    mutation(r);
    return json(await saveProgram(owner(r), await body(r)));
  } catch (e) {
    return fail(e);
  }
}
