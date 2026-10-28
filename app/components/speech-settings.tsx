'use client';
import { useEffect, useState } from 'react';
import { LoaderCircle, ShieldCheck } from 'lucide-react';
import ConnectionHeading from './connection-heading';
import { dataChanged } from '../../lib/client-data';
async function api(data?: any) {
  const r = await fetch('/api/audio-settings', {
    method: data ? 'POST' : 'GET',
    headers: data ? { 'Content-Type': 'application/json' } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  const j: any = await r.json();
  if (!r.ok) throw Error(j.error || 'Audio settings could not load.');
  if (data) dataChanged('/api/audio-settings');
  return j;
}
export default function SpeechSettings({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<any>({ voices: [] }),
    [key, setKey] = useState(''),
    [voice, setVoice] = useState(''),
    [model, setModel] = useState('eleven_v4'),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [sample, setSample] = useState('Gelden. Gaan. Goed. De les begint om 8.00 uur.'),
    [audio, setAudio] = useState('');
  useEffect(() => {
    void api()
      .then((s) => {
        setStatus(s);
        setVoice(s.voice);
        setModel(s.model);
        if (s.keyConfigured) void action('voices');
      })
      .catch((e) => setMessage(e.message));
    return () => {};
  }, []);
  useEffect(
    () => () => {
      if (audio) URL.revokeObjectURL(audio);
    },
    [audio],
  );
  async function action(action: string) {
    setBusy(true);
    setMessage('');
    try {
      const s = await api({ action, key, voice, model });
      setStatus(s);
      if (action === 'key') {
        setKey('');
        setMessage('Connection verified and key saved.');
      }
      if (action === 'voices') setMessage('Connection verified. My Voices refreshed.');
      if (action === 'preferences') setMessage('Voice saved. New audio will use this voice.');
      if (action === 'forget') setKey('');
      onChanged();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sample }),
      });
      if (!r.ok) {
        const j: any = await r.json();
        throw Error(j.error);
      }
      setAudio(URL.createObjectURL(await r.blob()));
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-card">
      <ConnectionHeading title="ElevenLabs" configured={!!status.keyConfigured} />
      <p className="settings-copy">
        One saved voice for words, practice and texts. Choose a voice and model below after
        connecting your account.
      </p>
      <label>
        API key
        <input
          type="password"
          aria-label="ElevenLabs API key"
          autoComplete="off"
          value={key}
          maxLength={500}
          disabled={busy}
          placeholder={
            status.keyConfigured ? 'Enter a replacement key…' : 'Enter your ElevenLabs key…'
          }
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      <div className="key-actions">
        <button
          className="primary"
          disabled={busy || !key.trim()}
          onClick={() => void action('key')}
        >
          {busy ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />}
          Verify &amp; save key
        </button>
        <button
          className="secondary"
          disabled={busy || !status.keyConfigured}
          onClick={() => void action('voices')}
        >
          Test connection
        </button>
      </div>
      <p className="sheet-footnote">
        Verification checks access to My Voices. Your key is encrypted and scoped to your account.
        Audio generation is tested separately below.
      </p>
      {status.keyConfigured && (
        <details className="remove-key">
          <summary>Manage saved key</summary>
          <button className="text-action" disabled={busy} onClick={() => void action('forget')}>
            Remove key from this app
          </button>
        </details>
      )}
      <div className="settings-subsection">
        <h3>Voice and playback</h3>
        <label>
          My Voices
          <select value={voice} disabled={busy} onChange={(e) => setVoice(e.target.value)}>
            <option value="">Choose a voice</option>
            {!(status.voices || []).some((v: any) => v.id === voice) && voice && (
              <option value={voice}>Saved voice · {voice}</option>
            )}
            {(status.voices || []).map((v: any) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.accent ? ' · ' + v.accent : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          className="text-action"
          disabled={busy || !status.keyConfigured}
          onClick={() => void action('voices')}
        >
          Refresh My Voices
        </button>
        <label>
          Speech model
          <select value={model} disabled={busy} onChange={(e) => setModel(e.target.value)}>
            <option value="eleven_v4">Eleven v4</option>
            <option value="eleven_v3">Eleven v3</option>
          </select>
        </label>
        <button
          className="primary"
          disabled={busy || !voice || !status.keyConfigured}
          onClick={() => void action('preferences')}
        >
          Save voice
        </button>
        <label>
          Test Dutch audio
          <textarea
            rows={2}
            maxLength={1500}
            value={sample}
            onChange={(e) => setSample(e.target.value)}
          />
        </label>
        <button
          className="secondary"
          disabled={busy || !status.audioReady || !sample.trim()}
          onClick={() => void test()}
        >
          {busy ? 'Preparing…' : 'Generate test audio'}
        </button>
        <p className="words-small">
          Uses your saved voice. Generated recordings are saved and reused.
        </p>
        {audio && <audio controls src={audio} style={{ width: '100%' }} />}
      </div>
      {message && (
        <p role="status" className="settings-result">
          {message}
        </p>
      )}
    </section>
  );
}
