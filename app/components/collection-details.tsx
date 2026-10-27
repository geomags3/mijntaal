'use client';
import { Archive, LoaderCircle, Pencil, Search, Volume2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { clientData, readJson } from '../../lib/client-data';
import { dictionarySnapshot, DictionarySnapshot } from '../../lib/dictionary-snapshot';
import { localLookup } from '../../lib/local-dictionary';
import { nounParts } from '../../lib/noun-article';
import { practiceMode, practiceName } from '../../lib/practice-mode';
import { cleanForms } from '../../lib/word-forms';
import LearningProgress from './learning-progress';
import NounTitle from './noun-title';
import PracticeBadge from './practice-badge';
import ResetProgress from './reset-progress';
import WordForms from './word-forms';
export default function CollectionDetails({
  item: summary,
  onClose,
  onEdit,
  onArchive,
  onSpeak,
  onSearch,
  onReset,
  onSaveDetails,
  currentAudio,
  audioState,
}: {
  item: any;
  onClose: () => void;
  onEdit: (item: any) => void;
  onArchive: (item: any) => void;
  onSpeak: (text: string) => void;
  currentAudio?: string;
  audioState?: string;
  onSearch: (text: string) => void;
  onReset: () => Promise<void>;
  onSaveDetails: (snapshot: DictionarySnapshot, item: any) => Promise<void>;
}) {
  const path = '/api/materials?id=' + encodeURIComponent(summary.id),
    cached = clientData.peek<any>(path);
  const [detail, setDetail] = useState<any>(() =>
      cached?.version >= summary.version ? cached : null,
    ),
    [detailsLoading, setDetailsLoading] = useState(!(cached?.version >= summary.version)),
    [detailsError, setDetailsError] = useState('');
  const item =
    detail && detail.version >= summary.version
      ? { ...detail, learning: summary.learning }
      : summary;
  useEffect(() => {
    let cancelled = false;
    setDetailsLoading(!detail || detail.version < summary.version);
    void readJson<any>(path, (clientData.peek<any>(path)?.version ?? -1) < summary.version)
      .then((value) => {
        if (!cancelled) {
          setDetail(value);
          setDetailsError('');
        }
      })
      .catch((e) => {
        if (!cancelled) setDetailsError(e.message);
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [summary.id, summary.version]);
  const [fallback, setFallback] = useState<DictionarySnapshot | undefined>(),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const raw = item.body.dictionarySnapshot;
  const saved = (
      raw?.version === 1 &&
      typeof raw.lemma === 'string' &&
      Array.isArray(raw.forms) &&
      Array.isArray(raw.senses) &&
      Array.isArray(raw.related)
        ? raw
        : undefined
    ) as DictionarySnapshot | undefined,
    entry = saved || fallback,
    parts = nounParts(item.title, item.body);
  useEffect(() => {
    if (detailsLoading) return;
    let cancelled = false;
    setFallback(undefined);
    setLoading(true);
    void localLookup(saved?.lemma || item.body.lemma || item.body.selectedForm || parts.word)
      .then((e) => {
        if (!cancelled) setFallback(dictionarySnapshot(e, saved?.lemma || item.body.lemma || ''));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, saved, detailsLoading]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement,
      overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const nodes = Array.from(
            dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),a[href],summary,input,select',
            ) || [],
          ).filter((n) => n.getClientRects().length),
          first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, [item.id]);
  const displayIpa =
    entry?.lemma.toLocaleLowerCase('nl') === parts.word.toLocaleLowerCase('nl')
      ? entry.ipa
      : entry?.queryForm?.text.toLocaleLowerCase('nl') === parts.word.toLocaleLowerCase('nl')
        ? entry.queryForm.ipa
        : '';
  const forms = cleanForms([
      ...(entry?.forms || (Array.isArray(item.body.forms) ? item.body.forms : [])),
      ...(fallback &&
      fallback.lemma === entry?.lemma &&
      fallback.partOfSpeech === entry?.partOfSpeech
        ? fallback.forms
        : []),
    ]),
    meanings = entry?.senses || [];
  async function save() {
    if (!entry) return;
    setSaving(true);
    setError('');
    try {
      await onSaveDetails(entry, item);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="sheet collection-sheet"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={'Details for ' + item.title}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="close icon-button" aria-label="Close word details" onClick={onClose}>
          <X size={20} />
        </button>
        <span className="sheet-label">YOUR COLLECTION</span>
        <div className="word-heading">
          <h2 lang="nl">
            <NounTitle title={item.title} body={item.body} />
          </h2>
          <button
            className="pronounce"
            aria-label="Listen to saved word"
            onClick={() => onSpeak((parts.article ? parts.article + ' ' : '') + parts.word)}
          >
            <Volume2 size={20} />
          </button>
        </div>
        <p className="grammar">
          {item.body.partOfSpeech || entry?.partOfSpeech}
          {displayIpa && <> · {displayIpa}</>}
          {item.body.formLabel && <> · {item.body.formLabel}</>}
        </p>
        <p className="word-translation" lang="en">
          {item.body.en || 'English meaning not added yet.'}
        </p>
        {detailsError && (
          <p className="words-small" role="status">
            {detailsError}
          </p>
        )}
        {item.body.lemma &&
          item.body.lemma.toLocaleLowerCase('nl') !== parts.word.toLocaleLowerCase('nl') && (
            <div className="base-form-link">
              Base form{' '}
              <button onClick={() => onSearch(item.body.lemma)}>{item.body.lemma} ↗</button>
            </div>
          )}
        {item.body.example && (
          <div className="context">
            <small>YOUR EXAMPLE</small>
            <p lang="nl">{item.body.example}</p>
            {item.body.exampleTranslation && <p>{item.body.exampleTranslation}</p>}
          </div>
        )}
        {(loading || detailsLoading) && (
          <p className="words-small" role="status">
            <LoaderCircle size={14} className="spin" /> Loading dictionary details…
          </p>
        )}
        {!!meanings.length && (
          <details className="entry-details" open>
            <summary>Dictionary meanings · {entry?.lemma}</summary>
            {meanings.map((sense, i) => (
              <div className="collection-dictionary-sense" key={i}>
                <b>{sense.meaning}</b>
                {sense.usage && <small>{sense.usage}</small>}
                {sense.example && <p lang="nl">{sense.example}</p>}
                {sense.exampleTranslation && <small>{sense.exampleTranslation}</small>}
              </div>
            ))}
          </details>
        )}
        {!!forms.length && (
          <details className="entry-details" open>
            <summary>Forms</summary>
            <WordForms
              forms={forms}
              partOfSpeech={entry?.partOfSpeech || item.body.partOfSpeech}
              lemma={entry?.lemma || item.body.lemma || parts.word}
              article={entry?.article || parts.article}
              selectedForm={parts.word}
              onSpeak={onSpeak}
              currentAudio={currentAudio}
              audioState={audioState}
            />
          </details>
        )}
        {!!entry?.related.length && (
          <details className="entry-details">
            <summary>Related words</summary>
            <div className="related-words">
              {entry.related.map((r, i) => (
                <button key={i} onClick={() => onSearch(r.word)}>
                  <b>{r.word}</b>
                  <small>{r.meaning}</small>
                </button>
              ))}
            </div>
          </details>
        )}
        {entry?.notes && <p className="collection-detail-notes">{entry.notes}</p>}
        {item.body.notes && item.body.notes !== entry?.notes && (
          <p className="collection-detail-notes">{item.body.notes}</p>
        )}
        {entry?.source && (
          <p className="sheet-footnote">
            {entry.source}
            {entry.sourceUrl &&
              (entry.sourceUrl.startsWith('https://') || entry.sourceUrl.startsWith('http://')) && (
                <>
                  {' '}
                  ·{' '}
                  <a href={entry.sourceUrl} target="_blank" rel="noreferrer">
                    Dictionary source ↗
                  </a>
                </>
              )}
          </p>
        )}
        {item.body.source && <p className="sheet-footnote">Source: {item.body.source}</p>}
        {!saved && fallback && (
          <button className="text-action" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save dictionary details'}
          </button>
        )}
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        <div className="collection-detail-progress">
          <PracticeBadge mode={practiceMode(item)} />
          <span className="words-small">Practice: {practiceName(practiceMode(item))}</span>
          {practiceMode(item) === 'words' && (
            <>
              <LearningProgress progress={item.learning} showDue />
              {item.learning?.due && (
                <span className="words-small">Next review: {item.learning.due}</span>
              )}
              <ResetProgress
                id={item.id}
                version={item.version}
                title={item.title}
                onReset={onReset}
              />
            </>
          )}
        </div>
        <div className="collection-detail-actions">
          <button className="secondary" onClick={() => onEdit(item)}>
            <Pencil size={15} />
            Edit
          </button>
          <button className="secondary" onClick={() => onArchive(item)}>
            <Archive size={15} />
            {item.body._archived ? 'Restore' : 'Archive'}
          </button>
          <button
            className="text-action"
            onClick={() => onSearch(item.body.selectedForm || parts.word)}
          >
            <Search size={14} />
            Look up in Search
          </button>
        </div>
      </div>
    </div>
  );
}
