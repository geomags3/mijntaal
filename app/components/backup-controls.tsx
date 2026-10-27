'use client';
import { Check, Download, LoaderCircle, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { dataChanged } from '../../lib/client-data';
async function request(data?: any) {
  const response = await fetch(
    '/api/backup',
    data
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          signal: AbortSignal.timeout(60000),
        }
      : { signal: AbortSignal.timeout(60000) },
  );
  const result: any = await response.json();
  if (!response.ok) throw Error(result.error || 'Backup request failed.');
  return result;
}
export default function BackupControls({
  onMessage,
  onImported,
}: {
  onMessage: (message: string) => void;
  onImported: () => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [exporting, setExporting] = useState(false),
    [backup, setBackup] = useState<any>(null),
    [preview, setPreview] = useState<any>(null),
    [error, setError] = useState(''),
    [filename, setFilename] = useState('');
  const dialog = useRef<HTMLDivElement>(null),
    generation = useRef(0);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement,
      overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        ++generation.current;
        setOpen(false);
      }
      if (event.key === 'Tab') {
        const nodes = Array.from(
            dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),[tabindex="0"]',
            ) || [],
          ),
          first = nodes[0],
          last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
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
  }, [open, busy]);
  async function download() {
    setExporting(true);
    try {
      const result = await request();
      const url = URL.createObjectURL(
          new Blob([JSON.stringify(result)], { type: 'application/json' }),
        ),
        link = document.createElement('a');
      link.href = url;
      link.download = 'mijntaal-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onMessage(
        `Backup exported: ${result.materials.length} entries, including archive, texts and learning history.`,
      );
    } catch (e) {
      onMessage((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  async function choose(file?: File) {
    const n = ++generation.current;
    setPreview(null);
    setBackup(null);
    setError('');
    setFilename(file?.name || '');
    if (!file) return;
    if (file.size > 12000000) {
      setError('Use a backup of up to 12 MB.');
      return;
    }
    setBusy(true);
    try {
      let parsed;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw Error('This file is not valid JSON.');
      }
      const result = await request({ action: 'preview', backup: parsed });
      if (n === generation.current) {
        setBackup(parsed);
        setPreview(result);
      }
    } catch (e) {
      if (n === generation.current) setError((e as Error).message);
    } finally {
      if (n === generation.current) setBusy(false);
    }
  }
  async function restore() {
    if (!preview || !backup) return;
    setBusy(true);
    setError('');
    try {
      const result = await request({ action: 'import', backup, token: preview.token });
      dataChanged('/api/backup');
      setOpen(false);
      onMessage(
        `Imported ${result.imported} entries. ${result.existing} already present; ${result.conflicts} conflicts kept unchanged.`,
      );
      onImported();
    } catch (e) {
      setPreview(null);
      setError((e as Error).message + ' Select the file again to refresh the preview.');
    } finally {
      setBusy(false);
    }
  }
  function close() {
    if (!busy) {
      ++generation.current;
      setOpen(false);
    }
  }
  return (
    <>
      <button disabled={exporting} onClick={download}>
        {exporting ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}Export
        backup
      </button>
      <button
        onClick={() => {
          setError('');
          setPreview(null);
          setBackup(null);
          setFilename('');
          setOpen(true);
        }}
      >
        <Upload size={14} />
        Import backup
      </button>
      {open && (
        <div className="overlay" onClick={close}>
          <div
            className="sheet backup-sheet"
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-label="Import backup"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close icon-button"
              aria-label="Close import"
              onClick={close}
              disabled={busy}
            >
              <X size={20} />
            </button>
            <span className="sheet-label">YOUR COLLECTION</span>
            <h2>Import backup</h2>
            <p className="backup-copy">
              Restore an Ultimately Dutch backup. New entries are added. Current entries and
              learning progress are kept; conflicts are skipped.
            </p>
            <label className="backup-file">
              Backup file
              <input
                type="file"
                accept=".json,application/json"
                disabled={busy}
                onChange={(e) => void choose(e.target.files?.[0])}
              />
            </label>
            <p className="sheet-footnote">
              Version 1 or 2 JSON · up to 12 MB. Includes archive, texts, translations and learning
              history and Words sessions. Audio files and API keys are excluded. Repeating an import
              does not create duplicate records.
            </p>
            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}
            {busy && (
              <p role="status">
                <LoaderCircle className="spin" size={16} />{' '}
                {preview ? 'Importing…' : 'Checking backup…'}
              </p>
            )}
            {preview && (
              <>
                <p className="backup-filename">{filename}</p>
                <div className="backup-counts">
                  <span>
                    <b>{preview.summary.new}</b>New
                  </span>
                  <span>
                    <b>{preview.summary.existing}</b>Already present
                  </span>
                  <span>
                    <b>{preview.summary.conflicts}</b>Conflicts
                  </span>
                </div>
                <p className="sheet-footnote">
                  {preview.summary.archived} archived · {preview.summary.attempts} review answers ·{' '}
                  {preview.summary.translations} text translations
                </p>
                <div className="backup-preview" aria-label="Import preview" tabIndex={0}>
                  {preview.rows.slice(0, 60).map((row: any) => (
                    <div key={row.id}>
                      <span>{row.title}</span>
                      <small>
                        {row.status === 'new'
                          ? 'Add'
                          : row.status === 'existing'
                            ? 'Already present'
                            : 'Keep current'}
                      </small>
                    </div>
                  ))}
                  {preview.rows.length > 60 && <p>…and {preview.rows.length - 60} more entries.</p>}
                </div>
              </>
            )}
            <div className="editor-actions">
              <button className="secondary" disabled={busy} onClick={close}>
                Cancel
              </button>
              <button className="primary wide" disabled={busy || !preview} onClick={restore}>
                <Check size={16} />
                Import backup
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
