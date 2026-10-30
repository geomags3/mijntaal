'use client';
import { useEffect, useMemo, useState } from 'react';
import { readJson } from '../../lib/client-data';
import { buildCollectionIndex, type CollectionWord } from '../../lib/collection-index';
/** Shared request cache, with no private collection data persisted to disk. */
export default function useCollectionIndex(visible = true) {
  const [rows, setRows] = useState<CollectionWord[]>([]);
  useEffect(() => {
    if (!visible) return;
    let active = true,
      generation = 0;
    const refresh = (force = false) => {
      const current = ++generation;
      void readJson<CollectionWord[]>('/api/collection-index', force)
        .then((value) => {
          if (active && current === generation) setRows(value);
        })
        .catch(() => {
          if (active && current === generation) setRows([]);
        });
    };
    const changed = () => refresh();
    const focus = () => refresh(true);
    refresh();
    window.addEventListener('dutch-external-data', changed);
    window.addEventListener('focus', focus);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') refresh(true);
    }, 60000);
    return () => {
      active = false;
      window.removeEventListener('dutch-external-data', changed);
      window.removeEventListener('focus', focus);
      clearInterval(interval);
    };
  }, [visible]);
  return useMemo(() => buildCollectionIndex(rows), [rows]);
}
