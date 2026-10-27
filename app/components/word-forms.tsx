'use client';
import { LoaderCircle, Pause, Volume2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { structureForms } from '../../lib/word-forms';
export default function WordForms({
  forms,
  partOfSpeech = '',
  lemma = '',
  article = '',
  selectedForm = '',
  onSpeak,
  currentAudio = '',
  audioState = 'idle',
}: {
  forms: unknown;
  partOfSpeech?: string;
  lemma?: string;
  article?: string;
  selectedForm?: string;
  onSpeak?: (text: string) => void;
  currentAudio?: string;
  audioState?: string;
}) {
  const model = useMemo(
    () => structureForms(forms, partOfSpeech, lemma, article),
    [forms, partOfSpeech, lemma, article],
  );
  const [tense, setTense] = useState<'present' | 'past'>('present'),
    [clause, setClause] = useState('Main clause');
  const id = useId();
  const table = model.tables.find((t) => t.label === clause) || model.tables[0];
  const norm = (s: string) => s.trim().normalize('NFC').toLocaleLowerCase('nl');
  const values = (list: string[]) =>
    list.length ? (
      <div className="word-form-values">
        {list.map((value) => (
          <span
            key={value}
            className={
              'word-form-value' +
              (selectedForm && norm(value) === norm(selectedForm) ? ' selected' : '')
            }
          >
            <b lang="nl">{value}</b>
            {onSpeak && (
              <button
                type="button"
                className="icon-button"
                aria-label={
                  currentAudio === value && audioState === 'loading'
                    ? 'Cancel loading ' + value
                    : currentAudio === value && audioState === 'playing'
                      ? 'Pause ' + value
                      : currentAudio === value && audioState === 'paused'
                        ? 'Resume ' + value
                        : 'Listen to ' + value
                }
                aria-busy={currentAudio === value && audioState === 'loading'}
                onClick={() => onSpeak(value)}
              >
                {currentAudio === value && audioState === 'loading' ? (
                  <LoaderCircle size={15} className="spin" />
                ) : currentAudio === value && audioState === 'playing' ? (
                  <Pause size={15} />
                ) : (
                  <Volume2 size={15} />
                )}
              </button>
            )}
          </span>
        ))}
      </div>
    ) : (
      <span className="word-form-missing" aria-label="Not available in dictionary">
        —
      </span>
    );
  const formList = (items: { label: string; value: string }[]) => {
    const byValue = new Map<string, string[]>();
    for (const f of items) {
      const labels = byValue.get(f.value) || [];
      if (!labels.includes(f.label || 'Unlabelled form')) labels.push(f.label || 'Unlabelled form');
      byValue.set(f.value, labels);
    }
    return (
      <dl className="word-form-other">
        {Array.from(byValue, ([value, labels]) => (
          <div key={value}>
            <dt>{values([value])}</dt>
            <dd>{labels.join('; ')}</dd>
          </div>
        ))}
      </dl>
    );
  };
  const hasStructure = model.tables.length > 0 || model.groups.length > 0;
  return (
    <div className="structured-forms">
      {table && (
        <>
          {model.tables.length > 1 && (
            <div className="form-switch" role="group" aria-label="Clause type">
              {model.tables.map((t) => (
                <button
                  type="button"
                  key={t.label}
                  aria-pressed={table.label === t.label}
                  onClick={() => setClause(t.label)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <div className="form-switch form-tense-switch" role="group" aria-label="Tense">
            <button
              type="button"
              aria-pressed={tense === 'present'}
              onClick={() => setTense('present')}
            >
              Present
            </button>
            <button type="button" aria-pressed={tense === 'past'} onClick={() => setTense('past')}>
              Past
            </button>
          </div>
          <table className={'conjugation-table tense-' + tense}>
            <caption className="sr-only">
              {lemma} · {table.label} · dictionary forms
            </caption>
            <thead>
              <tr>
                <th scope="col">Pronoun</th>
                <th scope="col" className="tense-present">
                  Present
                </th>
                <th scope="col" className="tense-past">
                  Past
                </th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.pronoun}>
                  <th scope="row" lang="nl">
                    {row.pronoun}
                  </th>
                  <td className="tense-present">{values(row.present)}</td>
                  <td className="tense-past">{values(row.past)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {table.rows.some((r) => r.present.length > 1 || r.past.length > 1) && (
            <p className="form-note">
              The dictionary lists multiple variants in some rows. Usage depends on context.
            </p>
          )}
        </>
      )}
      {model.groups.length > 0 && (
        <dl className="word-form-groups">
          {model.groups.map((g) => (
            <div key={g.label}>
              <dt>{g.label}</dt>
              <dd>{values(g.values)}</dd>
            </div>
          ))}
        </dl>
      )}
      {model.other.length > 0 &&
        (hasStructure ? (
          <details className="other-word-forms">
            <summary aria-controls={id}>Other forms</summary>
            <div id={id}>{formList(model.other)}</div>
          </details>
        ) : (
          formList(model.other)
        ))}
      {!hasStructure && !model.other.length && (
        <p className="form-note">No dictionary forms available.</p>
      )}
    </div>
  );
}
