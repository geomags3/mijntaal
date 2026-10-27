'use client';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
export default function ConfirmTextDelete({
  title,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement,
      overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (
      dialog.current?.querySelector<HTMLButtonElement>('button:not(:disabled)') || dialog.current
    )?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
      if (e.key === 'Tab') {
        const nodes = Array.from(
            dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [],
          ),
          first = nodes[0],
          last = nodes.at(-1);
        if (!nodes.length) {
          e.preventDefault();
          return;
        }
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
  }, [busy]);
  return (
    <div
      className="overlay"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="sheet text-delete-sheet"
        ref={dialog}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-text-title"
        aria-describedby="delete-text-description"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="delete-text-title">Delete text?</h2>
        <p className="delete-text-name">{title}</p>
        <p id="delete-text-description">
          This text will move to Archive, where you can restore it. Words saved from it will stay in
          your collection.
        </p>
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        <div className="editor-actions">
          <button className="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button className="primary danger-button" disabled={busy} onClick={onConfirm}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}Delete text
          </button>
        </div>
      </div>
    </div>
  );
}
