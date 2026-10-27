import { body, fail, json, mutation, owner } from '../../../lib/server/common';
import { entrySchema, lookup } from '../../../lib/server/dictionary';
import { translate, translateSelectedForm } from '../../../lib/server/translation';
export async function POST(r: Request) {
  try {
    mutation(r);
    const user = owner(r),
      b = await body(r);
    if (b.mode === 'search-form')
      return json(
        await translateSelectedForm(
          user,
          typeof b.query === 'string' ? b.query : '',
          typeof b.context === 'string' ? b.context : '',
          typeof b.lemma === 'string' ? b.lemma : '',
          r.signal,
          true,
        ),
      );
    if (b.mode === 'selected-form')
      return json(
        await translateSelectedForm(
          user,
          typeof b.query === 'string' ? b.query : '',
          typeof b.context === 'string' ? b.context : '',
          typeof b.lemma === 'string' ? b.lemma : '',
          r.signal,
        ),
      );
    if (b.mode === 'translate')
      return json(
        await translate(
          user,
          typeof b.query === 'string' ? b.query : '',
          typeof b.context === 'string' ? b.context : '',
          r.signal,
        ),
      );
    return json(
      await lookup(
        user,
        typeof b.query === 'string' ? b.query : '',
        typeof b.context === 'string' ? b.context : '',
        b.evidence ? entrySchema.parse(b.evidence) : undefined,
        r.signal,
      ),
    );
  } catch (e) {
    return fail(e);
  }
}
