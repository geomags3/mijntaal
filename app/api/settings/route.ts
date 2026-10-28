import { sentencePreferencesSchema } from '../../../lib/sentences';
import { configureAzure, getAzureSettings } from '../../../lib/server/azure-settings';
import {
  AppError,
  body,
  db,
  fail,
  hash,
  json,
  limit,
  mutation,
  owner,
} from '../../../lib/server/common';
import { elevenStatus } from '../../../lib/server/eleven-speech';
import {
  elevenAudioScope,
  encryptKey,
  getSettings,
  preferencesSchema,
  textResponse,
  userApiKey,
} from '../../../lib/server/settings';
import { wordPreferencesSchema } from '../../../lib/words';
export async function GET(r: Request) {
  try {
    const user = owner(r),
      [s, audio, azure] = await Promise.all([
        getSettings(user),
        elevenStatus(user),
        getAzureSettings(user),
      ]);
    return json({
      userScope: await hash('client-data:' + user),
      keyConfigured: s.keyConfigured,
      azureConfigured: azure.configured,
      azureRegion: azure.region,
      azureError: azure.error,
      translationReady: s.keyConfigured || azure.configured,
      preferences: s.preferences,
      language: 'nl-NL',
      audioCacheScope: audio.scope,
      audioReady: audio.audioReady,
      audioProvider: 'elevenlabs',
    });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(r: Request) {
  try {
    mutation(r);
    const user = owner(r),
      b = await body(r);
    if (['saveAzureKey', 'testAzureKey', 'removeAzureKey'].includes(b.action)) {
      const result = await configureAzure(user, b, r.signal);
      return json({
        ok: true,
        azureConfigured: result.configured,
        azureRegion: result.region,
        translationReady: result.configured || (await getSettings(user)).keyConfigured,
        message: result.message,
      });
    }
    if (b.action === 'saveSentencesPreferences') {
      const sentences = sentencePreferencesSchema.safeParse(b.sentences);
      if (!sentences.success) throw new AppError('Choose a session size from 1 to 30.');
      const current = await getSettings(user);
      const preferences = { ...current.preferences, sentences: sentences.data };
      await db()
        .prepare(
          'INSERT INTO user_settings(owner,preferences,updated) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET preferences=excluded.preferences,updated=excluded.updated',
        )
        .bind(user, JSON.stringify(preferences), new Date().toISOString())
        .run();
      return json({ ok: true, sentences: sentences.data });
    }
    if (b.action === 'saveWordsPreferences') {
      const words = wordPreferencesSchema.safeParse(b.words);
      if (!words.success) throw new AppError('Check your Words preferences.');
      const current = await getSettings(user);
      const preferences = { ...current.preferences, words: words.data };
      await db()
        .prepare(
          'INSERT INTO user_settings(owner,preferences,updated) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET preferences=excluded.preferences,updated=excluded.updated',
        )
        .bind(user, JSON.stringify(preferences), new Date().toISOString())
        .run();
      return json({ ok: true, words: words.data });
    }
    const prefs = preferencesSchema.safeParse(b.preferences || {});
    if (!prefs.success) throw new AppError('Check the voice and preferences.');
    const now = new Date().toISOString();
    if (b.action === 'saveKey' || b.action === 'testKey') {
      await limit(user, 'key-test', 5);
      const input = typeof b.apiKey === 'string' ? b.apiKey.trim() : '';
      if (input && (!input.startsWith('sk-') || input.length < 20 || input.length > 1000))
        throw new AppError('Enter a valid OpenAI API key.');
      const key = input || (await userApiKey(user));
      await textResponse(key, prefs.data.textModel, [
        { role: 'user', content: 'Reply with OK only.' },
      ]);
      if (b.action === 'saveKey') {
        const cipher = await encryptKey(key, user);
        await db()
          .prepare(
            'INSERT INTO user_settings(owner,key_cipher,preferences,updated) VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET key_cipher=excluded.key_cipher,preferences=excluded.preferences,updated=excluded.updated',
          )
          .bind(user, cipher, JSON.stringify(prefs.data), now)
          .run();
      }
      return json({
        ok: true,
        keyConfigured: true,
        audioCacheScope: await elevenAudioScope(user),
        message:
          b.action === 'saveKey'
            ? 'Key verified and saved securely.'
            : 'Text API request succeeded. Test Dutch audio separately to check voice access.',
      });
    }
    if (b.action === 'savePreferences') {
      await db()
        .prepare(
          'INSERT INTO user_settings(owner,preferences,updated) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET preferences=excluded.preferences,updated=excluded.updated',
        )
        .bind(user, JSON.stringify(prefs.data), now)
        .run();
      return json({
        ok: true,
        preferences: prefs.data,
        audioCacheScope: await elevenAudioScope(user),
      });
    }
    throw new AppError('Unknown settings action.');
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(r: Request) {
  try {
    mutation(r);
    await db()
      .prepare('UPDATE user_settings SET key_cipher=NULL,updated=? WHERE owner=?')
      .bind(new Date().toISOString(), owner(r))
      .run();
    return json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
