'use client';
import { useEffect, useState } from 'react';
import { LoaderCircle, ShieldCheck } from 'lucide-react';
import ConnectionHeading from './connection-heading';
import { dataChanged } from '../../lib/client-data';

export default function AzureSettings({
  configured,
  region,
  error = '',
  onChanged,
}: {
  configured: boolean;
  region: string;
  error?: string;
  onChanged: () => void;
}) {
  const [key, setKey] = useState(''),
    [nextRegion, setNextRegion] = useState(region),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => setNextRegion(region), [region]);
  async function action(action: 'saveAzureKey' | 'testAzureKey' | 'removeAzureKey') {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, azureKey: key, azureRegion: nextRegion }),
      });
      const result = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) throw Error(result.error || 'Azure settings could not be saved.');
      if (action !== 'testAzureKey') {
        setKey('');
        dataChanged('/api/settings');
        onChanged();
      }
      setMessage(result.message || 'Azure connection updated.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-card">
      <ConnectionHeading title="Azure Translator" configured={configured} />
      <p className="settings-copy">
        Azure translates phrases and text sentences first. OpenAI provides a fallback when available
        and continues to handle grammar and dictionary explanations.
      </p>
      {error && (
        <p role="status" className="settings-result">
          {error}
        </p>
      )}
      <label>
        API key
        <input
          type="password"
          aria-label="Azure Translator API key"
          autoComplete="off"
          value={key}
          maxLength={1000}
          disabled={busy}
          placeholder={configured ? 'Leave blank to use saved key' : 'Enter your Azure key…'}
          onChange={(event) => setKey(event.target.value)}
        />
      </label>
      <label>
        Azure resource region
        <input
          autoComplete="off"
          value={nextRegion}
          maxLength={64}
          disabled={busy}
          placeholder="westeurope"
          onChange={(event) => setNextRegion(event.target.value)}
        />
      </label>
      <div className="key-actions">
        <button
          className="primary"
          disabled={busy || (!key.trim() && !configured) || !nextRegion.trim()}
          onClick={() => void action('saveAzureKey')}
        >
          {busy ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />}
          Verify &amp; save key
        </button>
        <button
          className="secondary"
          disabled={busy || (!key.trim() && !configured) || !nextRegion.trim()}
          onClick={() => void action('testAzureKey')}
        >
          Test connection
        </button>
      </div>
      <p className="sheet-footnote">
        Verification sends a short translation request to your Azure resource. Your key is encrypted
        and scoped to your account.
      </p>
      {(configured || error) && (
        <details className="remove-key">
          <summary>Manage saved key</summary>
          <button
            className="text-action"
            disabled={busy}
            onClick={() => void action('removeAzureKey')}
          >
            Remove key from this app
          </button>
        </details>
      )}
      {message && (
        <p role="status" className="settings-result">
          {message}
        </p>
      )}
    </section>
  );
}
