'use client';
import { useEffect, useState } from 'react';
import { dataChanged, readJson } from '../../lib/client-data';
import { defaultSentencePreferences, SentencePreferences } from '../../lib/sentences';
export default function SentencesSettings({
  onSaved,
}: {
  onSaved?: (value: SentencePreferences) => void;
}) {
  const [value, setValue] = useState(defaultSentencePreferences),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    void readJson('/api/settings')
      .then((s) => {
        if (active) {
          setValue(s.preferences.sentences || defaultSentencePreferences);
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
        body: JSON.stringify({ action: 'saveSentencesPreferences', sentences: value }),
      });
      const result: any = await r.json();
      if (!r.ok) throw Error(result.error || 'Could not save Sentences preferences.');
      dataChanged('/api/settings');
      setValue(result.sentences);
      onSaved?.(result.sentences);
      setMessage('Saved. Applies to new rounds.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="settings-card">
      <h2>Sentences practice</h2>
      <label>
        Exercises per session
        <input
          type="number"
          min={1}
          max={30}
          step={1}
          disabled={loading || saving}
          value={value.sessionSize}
          onChange={(e) => setValue({ sessionSize: Number(e.target.value) })}
        />
      </label>
      <p className="settings-copy">
        A round uses fewer sentences if the selected text does not have enough translated sentences.
      </p>
      {message && (
        <p role="status" className="settings-result">
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
          value.sessionSize > 30
        }
        onClick={() => void save()}
      >
        {saving ? 'Saving…' : 'Save preferences'}
      </button>
    </section>
  );
}
