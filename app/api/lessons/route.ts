import {
  actOnLesson,
  deleteLesson,
  getLesson,
  lessonHistory,
  listLessons,
  saveLesson,
} from '../../../lib/server/lessons';
import { body, fail, json, mutation, owner } from '../../../lib/server/common';
export async function GET(r: Request) {
  try {
    const u = new URL(r.url),
      user = owner(r),
      id = u.searchParams.get('id');
    if (id)
      return json(
        u.searchParams.get('history') === 'true'
          ? await lessonHistory(user, id)
          : await getLesson(user, id),
      );
    return json(
      await listLessons(
        user,
        u.searchParams.get('programId') || undefined,
        u.searchParams.get('archived') === 'true',
      ),
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(r: Request) {
  try {
    mutation(r);
    return json(await actOnLesson(owner(r), await body(r)));
  } catch (e) {
    return fail(e);
  }
}
export async function PUT(r: Request) {
  try {
    mutation(r);
    return json(await saveLesson(owner(r), await body(r)));
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(r: Request) {
  try {
    mutation(r);
    return json(await deleteLesson(owner(r), await body(r)));
  } catch (e) {
    return fail(e);
  }
}
