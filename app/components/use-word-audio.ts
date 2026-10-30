'use client';
import { useEffect, useRef, useState } from 'react';
import { PracticeSounds } from '../../lib/practice-sounds';
import { AudioSequence } from '../../lib/audio-sequence';
export default function useWordAudio(
  scope: string,
  questionId: string,
  visible: boolean,
  onError: (message: string) => void,
) {
  const [state, setState] = useState('idle');
  const audio = useRef<HTMLAudioElement | null>(null),
    player = useRef<AudioSequence | null>(null),
    error = useRef(onError),
    preparation = useRef<AbortController | null>(null),
    sounds = useRef<PracticeSounds | null>(null);
  useEffect(() => {
    error.current = onError;
  }, [onError]);
  useEffect(() => {
    audio.current = new Audio();
    sounds.current = new PracticeSounds();
    player.current = new AudioSequence(
      audio.current,
      (_index, value) => setState(value),
      (message) => error.current(message),
    );
    player.current.setCacheScope(scope);
    return () => {
      sounds.current?.dispose();
      sounds.current = null;
      preparation.current?.abort();
      player.current?.dispose();
      player.current = null;
      audio.current = null;
    };
  }, []);
  useEffect(() => {
    preparation.current?.abort();
    player.current?.setCacheScope(scope);
  }, [scope]);
  useEffect(() => {
    player.current?.stop();
  }, [questionId, visible]);
  function play(text: string) {
    if (!player.current) {
      error.current('Audio is not ready. Please try again.');
      return;
    }
    if (state === 'loading') {
      player.current.stop();
      return;
    }
    if (state === 'playing') {
      player.current.pause();
      return;
    }
    if (state === 'paused') {
      player.current.resume();
      return;
    }
    void player.current.start([text], -1);
  }
  function unlock() {
    player.current?.unlockPlayback();
  }
  async function prepare(texts: string[]) {
    preparation.current?.abort();
    const controller = new AbortController();
    preparation.current = controller;
    const current = player.current;
    // Keep decoded memory bounded to the current round; WAVs remain cached on disk.
    current?.clearCache();
    const queue = [...new Set(texts)];
    let missing = 0,
      timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 20000);
    // Bound provider concurrency for old entries which have no recording yet.
    try {
      await Promise.all(
        [0, 1].map(async () => {
          while (queue.length && !controller.signal.aborted) {
            const text = queue.shift()!;
            try {
              await current?.prepare(text, controller.signal);
            } catch {
              if (!controller.signal.aborted) missing++;
            }
          }
        }),
      );
    } finally {
      clearTimeout(deadline);
    }
    return missing + (timedOut ? 1 : 0);
  }
  function autoPlay(text: string) {
    return player.current?.playPrepared(text) || false;
  }
  function sound() {
    const current = sounds.current;
    void current?.unlock().then(() => current.play());
  }
  return { state, play, unlock, prepare, autoPlay, sound };
}
