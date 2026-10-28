import { azureCredentials } from './azure-settings';
import { AppError } from './common';

export const AZURE_TRANSLATION_TIMEOUT_MS = 2000;
export type TranslationLanguage = 'nl' | 'en' | 'ru';
const unavailable = new Map<string, number>();

export function throwIfTranslationAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason || new DOMException('Cancelled', 'AbortError');
}

/** One bounded provider attempt; callers choose an AI fallback, never this adapter. */
export async function azureTranslate(
  user: string,
  texts: string[],
  source: TranslationLanguage,
  target: 'nl' | 'en',
  signal?: AbortSignal,
  loadedCredentials?: Awaited<ReturnType<typeof azureCredentials>>,
) {
  throwIfTranslationAborted(signal);
  const credentials =
    loadedCredentials === undefined ? await azureCredentials(user) : loadedCredentials;
  throwIfTranslationAborted(signal);
  if (!credentials) return null;
  if ((unavailable.get(credentials.scope) || 0) > Date.now())
    throw new AppError('Azure translation is temporarily unavailable.', 503);
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), AZURE_TRANSLATION_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=${source}&to=${target}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Ocp-Apim-Subscription-Key': credentials.key,
          ...(credentials.region ? { 'Ocp-Apim-Subscription-Region': credentials.region } : {}),
        },
        body: JSON.stringify(texts.map((Text) => ({ Text }))),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const seconds = Number(response.headers.get('Retry-After'));
      if ([401, 403, 429, 500, 503].includes(response.status)) {
        if (unavailable.size >= 100) unavailable.delete(unavailable.keys().next().value!);
        unavailable.set(
          credentials.scope,
          Date.now() +
            (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 300) : 30) * 1000,
        );
      }
      throw new AppError('Azure could not translate this request.', 502);
    }
    const result: unknown = await response.json();
    if (!Array.isArray(result) || result.length !== texts.length)
      throw new AppError('Azure returned an incomplete translation.', 502);
    const translations = result.map((item: any) => {
      const text = item?.translations?.find((t: any) => t.to === target)?.text;
      if (typeof text !== 'string' || !text.trim() || text.length > 5000)
        throw new AppError('Azure returned an incomplete translation.', 502);
      return text.trim();
    });
    throwIfTranslationAborted(signal);
    return { translations, scope: credentials.scope };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
