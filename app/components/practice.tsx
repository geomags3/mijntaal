'use client';
import { useEffect, useState } from 'react';
import SentencesPractice from './sentences-practice';
import WordsPractice from './words-practice';
export default function Practice(props: {
  onCollection: () => void;
  onChanged: () => void;
  onSpeak: (text: string) => void;
  audioReady: boolean;
  audioScope?: string;
  visible?: boolean;
}) {
  const [mode, setMode] = useState('Words');
  const [sentencesVisited, setSentencesVisited] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('mode') === 'Sentences')
      setMode('Sentences');
  }, []);
  function choose(next: string) {
    setMode(next);
    if (next === 'Sentences') setSentencesVisited(true);
    const url = new URL(window.location.href);
    url.searchParams.set('mode', next);
    window.history.replaceState(null, '', url.pathname + url.search);
  }
  return (
    <>
      <div className="practice-switch practice-modes" role="group" aria-label="Practice mode">
        {['Words', 'Sentences'].map((m) => (
          <button key={m} aria-pressed={mode === m} onClick={() => choose(m)}>
            {m}
          </button>
        ))}
      </div>
      <div hidden={mode !== 'Words'}>
        <WordsPractice {...props} visible={props.visible !== false && mode === 'Words'} />
      </div>
      {(sentencesVisited || mode === 'Sentences') && (
        <div hidden={mode !== 'Sentences'}>
          <SentencesPractice
            visible={props.visible !== false && mode === 'Sentences'}
            onSpeak={props.onSpeak}
            audioReady={props.audioReady}
          />
        </div>
      )}
    </>
  );
}
