'use client';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Entry } from '../../lib/server/dictionary';

type Language = 'nl' | 'en' | 'ru';
export type LiveTranslationResult = {
  key: string;
  entry: Entry;
  input: string;
  language: Language;
  context: string;
  scope: string;
};
export default function LiveTranslation({
  query,
  context,
  language,
  enabled,
  paused,
  coveredBySearch,
  onSearch,
  onResult,
  scope = '',
  inSuggestions = false,
}: {
  query: string;
  context: string;
  language: Language;
  enabled: boolean;
  paused: boolean;
  coveredBySearch: boolean;
  onSearch: () => void;
  onResult?: (result: LiveTranslationResult) => void;
  scope?: string;
  inSuggestions?: boolean;
}) {
  const input = query.trim().normalize('NFC');
  const key = JSON.stringify([language, input, context]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const completed = useRef('');
  useEffect(() => {
    setError('');
    setBusy(false);
    if (!input) {
      completed.current = '';
      return;
    }
    if (!enabled || paused || coveredBySearch || completed.current === key) return;
    const controller = new AbortController();
    let current = true;
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/api/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'translate',
            live: true,
            query: input,
            context,
            sourceLanguage: language,
            targetLanguage: language === 'nl' ? 'en' : 'nl',
          }),
          signal: controller.signal,
        });
        const translated = (await response.json()) as Entry & { error?: string };
        if (
          !response.ok ||
          !translated.found ||
          !translated.lemma ||
          !Array.isArray(translated.senses) ||
          !translated.senses.length
        )
          throw Error('Live translation is unavailable. Search to try the configured fallback.');
        if (!current || controller.signal.aborted) return;
        completed.current = key;
        const next = { key, entry: translated, input, language, context, scope };
        onResult?.(next);
      } catch {
        if (current && !controller.signal.aborted)
          setError('Live translation is unavailable. Search to try the configured fallback.');
      } finally {
        if (current && !controller.signal.aborted) setBusy(false);
      }
    }, 500);
    return () => {
      current = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [input, context, language, key, enabled, paused, coveredBySearch, onResult, scope]);
  if (!enabled || !input || coveredBySearch || inSuggestions) return null;
  if (!busy && !error) return null;
  return (
    <div className="lookup-loading" role="status" aria-label="Live translation" aria-busy={busy}>
      {busy && (
        <>
          <LoaderCircle size={14} className="spin" /> Updating translation…
        </>
      )}
      {error && (
        <p>
          {error}{' '}
          <button type="button" className="text-action" onClick={onSearch}>
            Search
          </button>
        </p>
      )}
    </div>
  );
}
