'use client';
import { LoaderCircle, RotateCcw } from 'lucide-react';
import { useRef, useState } from 'react';
import { dataChanged } from '../../lib/client-data';
import { newWordAttemptId } from '../../lib/words';
export default function ResetProgress({
  id,
  version,
  title,
  onReset,
}: {
  id: string;
  version: number;
  title: string;
  onReset: () => Promise<void> | void;
}) {
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const attempt = useRef('');
  async function reset() {
    setBusy(true);
    setError('');
    if (!attempt.current) attempt.current = newWordAttemptId();
    try {
      const r = await fetch('/api/words', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset', id, version, attemptId: attempt.current }),
        signal: AbortSignal.timeout(20000),
      });
      const data: any = await r.json();
      if (!r.ok) throw Error(data.error || 'Progress could not be reset.');
      setConfirm(false);
      attempt.current = '';
      dataChanged('/api/reset');
      await onReset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="reset-progress">
      {confirm ? (
        <div className="reset-confirm">
          <p>Reset this entry to New?</p>
          <div>
            <button
              className="text-action"
              disabled={busy}
              onClick={() => {
                setConfirm(false);
                setError('');
                attempt.current = '';
              }}
            >
              Cancel
            </button>
            <button className="secondary" disabled={busy} onClick={() => void reset()}>
              {busy ? <LoaderCircle size={14} className="spin" /> : <RotateCcw size={14} />}Reset
              progress
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
        </div>
      ) : (
        <button
          className="text-action"
          aria-label={'Reset progress for ' + title}
          onClick={() => setConfirm(true)}
        >
          <RotateCcw size={14} />
          Reset progress
        </button>
      )}
    </div>
  );
}
