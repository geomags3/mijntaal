'use client';
import { useEffect, useState } from 'react';
import { dataChanged, readJson } from '../../lib/client-data';
import { defaultWordPreferences, WordPreferences } from '../../lib/words';
export default function WordsSettings({ onSaved }: { onSaved?: (value: WordPreferences) => void }) {
  const [value, setValue] = useState<WordPreferences>(defaultWordPreferences),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    void readJson('/api/settings')
      .then((s) => {
        if (active) {
          setValue(s.preferences.words || defaultWordPreferences);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function save() {
    setSaving(true);
    setMessage('');
    try {
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'saveWordsPreferences', words: value }),
      });
      const result: any = await r.json();
      if (!r.ok) throw Error(result.error || 'Could not save Words preferences.');
      dataChanged('/api/settings');
      setValue(result.words);
      onSaved?.(result.words);
      setMessage('Saved. Applies to new rounds.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="settings-card">
      <h2>Words practice</h2>
      <label>
        Exercises per session
        <input
          type="number"
          min={1}
          max={30}
          step={1}
          disabled={loading || saving}
          value={value.sessionSize}
          onChange={(e) => setValue({ ...value, sessionSize: Number(e.target.value) })}
        />
      </label>
      <label>
        New words per day
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          disabled={loading || saving}
          value={value.newWordsPerDay}
          onChange={(e) => setValue({ ...value, newWordsPerDay: Number(e.target.value) })}
        />
      </label>
      <p className="settings-copy">
        Saved words wait in your collection until you start learning them. Use 0 to practise only
        words you have started.
      </p>
      <label>
        Preferred answer mode
        <select
          disabled={loading || saving}
          value={value.answerMode}
          onChange={(e) =>
            setValue({ ...value, answerMode: e.target.value as WordPreferences['answerMode'] })
          }
        >
          <option value="auto">Auto — follow the learning stage</option>
          <option value="typing">Type</option>
          <option value="letters">Letters</option>
          <option value="choices">Choices</option>
        </select>
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          disabled={loading || saving}
          checked={value.repeatMistakes}
          onChange={(e) => setValue({ ...value, repeatMistakes: e.target.checked })}
        />
        Repeat mistakes once later in the round
      </label>
      <p className="settings-copy">
        You can change the answer mode on each Dutch-answer card. Choices require four suitable
        answers; otherwise Letters is used.
      </p>
      {message && (
        <p role="status" className="settings-copy">
          {message}
        </p>
      )}
      <button
        className="primary"
        disabled={
          loading ||
          saving ||
          !Number.isInteger(value.sessionSize) ||
          value.sessionSize < 1 ||
          value.sessionSize > 30 ||
          !Number.isInteger(value.newWordsPerDay) ||
          value.newWordsPerDay < 0 ||
          value.newWordsPerDay > 100
        }
        onClick={() => void save()}
      >
        {saving ? 'Saving…' : 'Save Words preferences'}
      </button>
    </section>
  );
}
