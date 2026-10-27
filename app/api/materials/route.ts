import { body, fail, json, mutation, owner } from '../../../lib/server/common';
import {
  addMaterial,
  getMaterial,
  listMaterials,
  updateMaterial,
} from '../../../lib/server/materials';
export { owner } from '../../../lib/server/common';
export async function GET(r: Request) {
  try {
    const u = new URL(r.url);
    const id = u.searchParams.get('id');
    if (id) return json(await getMaterial(owner(r), id));
    const kind = u.searchParams.get('kind');
    return json(
      await listMaterials(
        owner(r),
        u.searchParams.get('q') || '',
        u.searchParams.get('archived') === 'true',
        true,
        kind === 'phrase' || kind === 'text' || kind === 'note' ? kind : undefined,
        u.searchParams.get('summary') === 'true',
      ),
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(r: Request) {
  try {
    mutation(r);
    return json(await addMaterial(owner(r), await body(r)));
  } catch (e) {
    return fail(e);
  }
}
export async function PATCH(r: Request) {
  try {
    mutation(r);
    return json(await updateMaterial(owner(r), await body(r)));
  } catch (e) {
    return fail(e);
  }
}
