import { waitUntil } from 'cloudflare:workers';
import { body, fail, json, mutation, owner } from '../../../lib/server/common';
import { entrySchema, lookup } from '../../../lib/server/dictionary';
import { translate, translateSelectedForm } from '../../../lib/server/translation';
export async function POST(r: Request) {
  const started = Date.now();
  const timing: Record<string, number> = {};
  const timed = (response: Response) => {
    response.headers.set(
      'Server-Timing',
      [...Object.entries(timing), ['total', Date.now() - started]]
        .map(([name, duration]) => `${name};dur=${duration}`)
        .join(', '),
    );
    return response;
  };
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
      return timed(
        json(
          await translate(
            user,
            typeof b.query === 'string' ? b.query : '',
            typeof b.context === 'string' ? b.context : '',
            r.signal,
            b.sourceLanguage === undefined ? 'nl' : b.sourceLanguage,
            b.targetLanguage,
            {
              live: b.live === true,
              timing,
              ...(typeof waitUntil === 'function' ? { defer: waitUntil } : {}),
            },
          ),
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
    return timed(fail(e));
  }
}
