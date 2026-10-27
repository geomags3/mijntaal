import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { defaultSentencePreferences, sentencePreferencesSchema } from '../sentences';
import { defaultWordPreferences, wordPreferencesSchema } from '../words';
import { AppError, db, hash } from './common';
export const voices = [
  'marin',
  'cedar',
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
] as const;
export const preferencesSchema = z.object({
  sentences: sentencePreferencesSchema.default(defaultSentencePreferences),
  words: wordPreferencesSchema.default(defaultWordPreferences),
  aiEnrichment: z.enum(['auto', 'manual', 'off']).default('auto'),
  voice: z.enum(voices).default('marin'),
  style: z.enum(['natural', 'slow', 'teacher']).default('natural'),
  tone: z.string().max(400).default('Warm, calm and clear.'),
  translationModel: z.enum(['same', 'gpt-6-luna', 'gpt-4.1-mini', 'gpt-4o-mini']).default('same'),
  textModel: z
    .enum(['gpt-6-luna', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini'])
    .default('gpt-4.1-mini'),
  audioModel: z.literal('gpt-realtime-2.1-mini').default('gpt-realtime-2.1-mini'),
  format: z.literal('wav').default('wav'),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaults = preferencesSchema.parse({});
async function encryptionKey() {
  const hex = (env as any).CREDENTIAL_ENCRYPTION_KEY as string;
  if (!hex || !/^[a-f0-9]{64}$/.test(hex))
    throw new AppError('Secure key storage is not configured.', 503);
  return crypto.subtle.importKey(
    'raw',
    Uint8Array.from(hex.match(/../g)!, (x) => parseInt(x, 16)),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}
const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function encryptKey(value: string, user: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(user) },
    await encryptionKey(),
    new TextEncoder().encode(value),
  );
  return b64(iv) + '.' + b64(new Uint8Array(encoded));
}
export async function decryptKey(cipher: string, user: string) {
  try {
    const [iv, data] = cipher.split('.');
    return new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: unb64(iv), additionalData: new TextEncoder().encode(user) },
        await encryptionKey(),
        unb64(data),
      ),
    );
  } catch {
    throw new AppError('The saved API key could not be read. Please save it again.', 503);
  }
}
export async function getSettings(user: string) {
  const row: any = await db()
    .prepare('SELECT * FROM user_settings WHERE owner=?')
    .bind(user)
    .first();
  let preferences = defaults;
  try {
    preferences = preferencesSchema.parse(JSON.parse(row?.preferences || '{}'));
  } catch {}
  return {
    keyConfigured: !!row?.key_cipher,
    preferences,
    cipher: row?.key_cipher as string | undefined,
  };
}
export async function userApiKey(user: string) {
  const s = await getSettings(user);
  if (!s.cipher)
    throw new AppError('Add your OpenAI API key in Settings to use this feature.', 428);
  return decryptKey(s.cipher, user);
}
export async function openAIError(response: Response) {
  let code = '';
  try {
    const j: any = await response.json();
    code = j.error?.code || '';
  } catch {}
  if (response.status === 401)
    throw new AppError('OpenAI rejected this key. Check the key in Settings.', 401);
  if (response.status === 429)
    throw new AppError(
      code === 'insufficient_quota'
        ? 'OpenAI API credit is unavailable. Check billing on your OpenAI project.'
        : 'OpenAI rate limit reached. Try again shortly.',
      429,
    );
  if (response.status === 403 || response.status === 404)
    throw new AppError(
      'This OpenAI project cannot access the selected model. Choose another model or check project access.',
      403,
    );
  throw new AppError('OpenAI could not complete this request. Please try again.', 502);
}
export async function textResponse(
  key: string,
  model: string,
  input: any,
  format?: any,
  maxTokens?: number,
  signal?: AbortSignal,
) {
  let r: Response;
  try {
    r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input,
        max_output_tokens: maxTokens ?? (format ? 2400 : 40),
        ...(model === 'gpt-6-luna'
          ? {
              reasoning: { effort: 'none' },
              text: { verbosity: 'low', ...(format ? { format } : {}) },
            }
          : format
            ? { text: { format } }
            : {}),
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
        : AbortSignal.timeout(60000),
    });
  } catch {
    throw new AppError('Could not reach OpenAI. Try again.', 502);
  }
  if (!r.ok) await openAIError(r);
  const j: any = await r.json();
  if (j.status === 'incomplete')
    throw new AppError('The response was incomplete. Try a shorter query.', 502);
  const text = (j.output || [])
    .flatMap((o: any) => o.content || [])
    .filter((c: any) => c.type === 'output_text')
    .map((c: any) => c.text)
    .join('');
  if (!text) throw new AppError('OpenAI did not return a usable result.', 502);
  return text;
}

export async function audioCacheScope(user: string, p: Preferences) {
  return hash(
    'browser-audio-v1:' +
      user +
      JSON.stringify({
        voice: p.voice,
        style: p.style,
        tone: p.tone,
        audioModel: p.audioModel,
        format: p.format,
      }),
  );
}

// ElevenLabs production settings. Reuse the owner's encrypted experiment key/selection once.
export async function getElevenSettings(user: string) {
  const id = 'eleven-speech-v1:' + (await hash(user)),
    row: any = await db()
      .prepare('SELECT body FROM lookup_cache WHERE id=? AND owner=?')
      .bind(id, user)
      .first();
  if (row) return JSON.parse(row.body);
  const oldKey: any = await db()
      .prepare('SELECT body FROM lookup_cache WHERE id=? AND owner=?')
      .bind('audio-comparison-v1:' + (await hash(user + ':key')), user)
      .first(),
    oldRun: any = await db()
      .prepare('SELECT body FROM lookup_cache WHERE id=? AND owner=?')
      .bind('audio-comparison-v1:' + (await hash(user + ':run')), user)
      .first();
  const key = oldKey ? JSON.parse(oldKey.body) : {},
    run = oldRun ? JSON.parse(oldRun.body) : {};
  const result = {
    cipher: key.cipher || null,
    voice: run.voice || '',
    model: run.model === 'eleven_v3' ? 'eleven_v3' : 'eleven_v4',
    voices: [],
  };
  if (key.cipher) {
    await db()
      .prepare('INSERT OR IGNORE INTO lookup_cache(id,owner,body,created) VALUES(?,?,?,?)')
      .bind(id, user, JSON.stringify(result), new Date().toISOString())
      .run();
    return getElevenSettings(user);
  }
  return result;
}
export async function putElevenSettings(user: string, value: any) {
  await db()
    .prepare(
      'INSERT INTO lookup_cache(id,owner,body,created) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,created=excluded.created',
    )
    .bind(
      'eleven-speech-v1:' + (await hash(user)),
      user,
      JSON.stringify(value),
      new Date().toISOString(),
    )
    .run();
}
export async function elevenAudioScope(user: string, saved?: any) {
  const s = saved || (await getElevenSettings(user));
  return hash('eleven-speech-v1:' + user + JSON.stringify({ voice: s.voice, model: s.model }));
}
