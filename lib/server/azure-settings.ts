import { z } from 'zod';
import { AppError, db, hash, limit } from './common';
import { decryptKey, encryptKey } from './settings';

const savedSchema = z.object({
  cipher: z.string().min(1),
  region: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
});
const idFor = async (user: string) => 'azure-translator-v1:' + (await hash(user));

async function savedAzure(user: string) {
  const row = await db()
    .prepare('SELECT body FROM lookup_cache WHERE id=? AND owner=?')
    .bind(await idFor(user), user)
    .first<{ body: string }>();
  if (!row) return null;
  try {
    return savedSchema.parse(JSON.parse(row.body));
  } catch {
    throw new AppError(
      'The saved Azure connection could not be read. Save the key and region again.',
      503,
    );
  }
}

export async function getAzureSettings(user: string) {
  try {
    const saved = await savedAzure(user);
    return {
      configured: !!saved,
      region: saved?.region || '',
      scope: await hash('azure-translator-v1:' + user + JSON.stringify(saved)),
      error: '',
    };
  } catch {
    // A broken optional provider connection must not hide existing settings.
    return {
      configured: false,
      region: '',
      scope: await hash('azure-translator-v1:unavailable:' + user),
      error: 'The saved Azure connection could not be read. Save the key and region again.',
    };
  }
}

export async function azureCredentials(user: string) {
  const saved = await savedAzure(user);
  if (!saved) return null;
  return {
    key: await decryptKey(saved.cipher, user),
    region: saved.region,
    scope: await hash('azure-translator-v1:' + user + JSON.stringify(saved)),
  };
}

export async function configureAzure(
  user: string,
  input: { action: string; azureKey?: unknown; azureRegion?: unknown },
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw signal.reason || new DOMException('Cancelled', 'AbortError');
  if (input.action === 'removeAzureKey') {
    await db()
      .prepare('DELETE FROM lookup_cache WHERE id=? AND owner=?')
      .bind(await idFor(user), user)
      .run();
    return {
      ...(await getAzureSettings(user)),
      message: 'Azure key removed. The key itself is not revoked.',
    };
  }
  const region =
    typeof input.azureRegion === 'string' ? input.azureRegion.trim().toLowerCase() : '';
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(region))
    throw new AppError('Enter the Azure resource region, for example westeurope.');
  let key = typeof input.azureKey === 'string' ? input.azureKey.trim() : '';
  if (key && !/^[A-Za-z0-9_-]{20,1000}$/.test(key))
    throw new AppError('Enter a valid Azure Translator subscription key.');
  if (!key) key = (await azureCredentials(user))?.key || '';
  if (!key) throw new AppError('Enter your Azure Translator subscription key.');
  await limit(user, 'azure-key-test', 5);
  let response: Response;
  try {
    response = await fetch(
      'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=nl&to=en',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Ocp-Apim-Subscription-Key': key,
          'Ocp-Apim-Subscription-Region': region,
        },
        body: JSON.stringify([{ Text: 'Hallo' }]),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
          : AbortSignal.timeout(10000),
      },
    );
  } catch {
    if (signal?.aborted) throw signal.reason || new DOMException('Cancelled', 'AbortError');
    throw new AppError('Could not reach Azure Translator. Check the connection and retry.', 502);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new AppError(
        'Azure rejected this connection. Check the key, resource region and available quota.',
        response.status,
      );
    if (response.status === 429)
      throw new AppError('Azure request limit reached. Try again shortly.', 429);
    throw new AppError('Azure could not verify this connection. Please retry.', 502);
  }
  try {
    z.array(
      z.object({
        translations: z
          .array(z.object({ to: z.literal('en'), text: z.string().trim().min(1) }))
          .min(1),
      }),
    )
      .length(1)
      .parse(await response.json());
  } catch {
    throw new AppError('Azure returned an incomplete test translation. Please retry.', 502);
  }
  if (signal?.aborted) throw signal.reason || new DOMException('Cancelled', 'AbortError');
  if (input.action === 'saveAzureKey') {
    await db()
      .prepare(
        'INSERT INTO lookup_cache(id,owner,body,created) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,created=excluded.created',
      )
      .bind(
        await idFor(user),
        user,
        JSON.stringify({ cipher: await encryptKey(key, user), region }),
        new Date().toISOString(),
      )
      .run();
  }
  return {
    ...(await getAzureSettings(user)),
    message:
      input.action === 'saveAzureKey'
        ? 'Azure connection verified and saved securely.'
        : 'Azure test translation succeeded. This test does not save changes.',
  };
}
