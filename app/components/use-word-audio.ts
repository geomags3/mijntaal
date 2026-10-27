'use client';
import { useEffect, useRef, useState } from 'react';
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
    error = useRef(onError);
  useEffect(() => {
    error.current = onError;
  }, [onError]);
  useEffect(() => {
    audio.current = new Audio();
    player.current = new AudioSequence(
      audio.current,
      (_index, value) => setState(value),
      (message) => error.current(message),
    );
    player.current.setCacheScope(scope);
    return () => {
      player.current?.dispose();
      player.current = null;
      audio.current = null;
    };
  }, []);
  useEffect(() => {
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
  return { state, play };
}
