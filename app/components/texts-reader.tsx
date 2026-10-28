'use client';
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  BookOpen,
  Bookmark,
  Check,
  ChevronDown,
  Download,
  ListStart,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw as RestoreIcon,
  RotateCcw,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AudioSequence } from '../../lib/audio-sequence';
import { clientData, dataChanged, readJson } from '../../lib/client-data';
import { dictionarySnapshot } from '../../lib/dictionary-snapshot';
import { localLookup } from '../../lib/local-dictionary';
import { nounArticle } from '../../lib/noun-article';
import type { PracticeMode } from '../../lib/practice-mode';
import type { Entry } from '../../lib/server/dictionary';
import { audioGroups } from '../../lib/text-audio';
import { TextPlayer } from '../../lib/text-player';
import { textPreparation } from '../../lib/text-preparation';
import { ReadingSegment, segmentText } from '../../lib/text-segments';
import { demoText } from '../data';
import AppHeader from './app-header';
import ConfirmTextDelete from './confirm-text-delete';
import NounTitle from './noun-title';
import PracticeModeSelect from './practice-mode-select';
import WordForms from './word-forms';
type Text = {
  id: string;
  title: string;
  source: string;
  segments: ReadingSegment[];
  scope: string;
  keyConfigured: boolean;
  translationReady?: boolean;
  audioConfigured?: boolean;
  wordScope?: string;
  version?: number;
  original?: string;
  edited?: boolean;
};
type RowState = 'pending' | 'loading' | 'ready' | 'error';
type Progress = { audio: RowState; translation: RowState; error?: string };
type Word = {
  nl: string;
  segment?: ReadingSegment;
  entry?: Entry;
  busy: boolean;
  error?: string;
  contextBusy?: boolean;
  contextMeaning?: string;
  contextLemma?: string;
  formLabel?: string;
  contextError?: string;
  back?: { nl: string; segment?: ReadingSegment };
};
async function api(path: string, data?: any, signal?: AbortSignal): Promise<any> {
  if (!data) return readJson(path);
  const r = await fetch(path, {
    method: data ? 'POST' : 'GET',
    headers: data ? { 'Content-Type': 'application/json' } : undefined,
    body: data ? JSON.stringify(data) : undefined,
    signal,
  });
  if (!r.ok) {
    const j: any = await r.json();
    throw Error(j.error || 'Please try again.');
  }
  const value: any = await r.json();
  dataChanged(path);
  if (data?.action === 'edit' && value.text?.id)
    clientData.put('/api/texts?id=' + encodeURIComponent(value.text.id), value.text);
  return value;
}
const sample: Text = {
  id: '',
  title: demoText.title,
  source: demoText.source,
  segments: demoText.segments.map((s, i) => ({
    id: 'sample-' + i,
    nl: s.nl,
    en: s.en,
    audioReady: false,
  })),
  scope: '',
  keyConfigured: false,
};
export default function Texts({
  onNavigate,
  visible = true,
}: {
  onNavigate?: (tab: string) => void;
  visible?: boolean;
}) {
  const [audioReady, setAudioReady] = useState(false);
  const [library, setLibrary] = useState(true);
  const [textArchive, setTextArchive] = useState(false),
    [deleteTarget, setDeleteTarget] = useState<{
      id: string;
      title: string;
      version: number;
    } | null>(null),
    [deleting, setDeleting] = useState(false),
    [deleteError, setDeleteError] = useState('');
  const listGeneration = useRef(0);
  const [listLoading, setListLoading] = useState(() => !clientData.peek('/api/text-library'));
  const [texts, setTexts] = useState<any[]>(() => clientData.peek('/api/text-library') || []),
    [current, setCurrent] = useState<Text>(sample),
    [loading, setLoading] = useState(false),
    [ready, setReady] = useState(false),
    [autoForm, setAutoForm] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [adding, setAdding] = useState(false),
    [editBase, setEditBase] = useState<Text | null>(null),
    [formError, setFormError] = useState(''),
    [title, setTitle] = useState(''),
    [original, setOriginal] = useState(''),
    [source, setSource] = useState(''),
    [saving, setSaving] = useState(false),
    [showTranslation, setShowTranslation] = useState(false),
    [word, setWord] = useState<Word | null>(null),
    [phrase, setPhrase] = useState(''),
    [phraseAnchor, setPhraseAnchor] = useState<{
      top: number;
      left: number;
      below: boolean;
    } | null>(null),
    [practice, setPractice] = useState<PracticeMode>('words'),
    [audioState, setAudioState] = useState('idle'),
    [active, setActive] = useState(-1),
    [position, setPosition] = useState(0),
    [speed, setSpeed] = useState(1),
    [panel, setPanel] = useState(false),
    [preparing, setPreparing] = useState(false),
    [progress, setProgress] = useState<Record<string, Progress>>({}),
    [translationBusy, setTranslationBusy] = useState(false);
  const readyAudio = useRef(new Set<string>());
  const [wordSound, setWordSound] = useState({ text: '', state: 'idle' });
  const audio = useRef<HTMLAudioElement>(null),
    wordAudio = useRef<HTMLAudioElement>(null),
    player = useRef<TextPlayer | null>(null),
    wordPlayer = useRef<AudioSequence | null>(null),
    currentRef = useRef(current),
    wordGeneration = useRef(0),
    wordController = useRef<AbortController | null>(null),
    formController = useRef<AbortController | null>(null),
    prepareController = useRef<AbortController | null>(null),
    translationController = useRef<AbortController | null>(null),
    openGeneration = useRef(0),
    dialog = useRef<HTMLDivElement>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasActive = useRef(visible),
    activeRef = useRef(visible);
  const [translationReady, setTranslationReady] = useState(false);
  activeRef.current = visible;
  function restoreReaderLocation() {
    if (window.location.pathname !== '/texts') return;
    const id = new URLSearchParams(window.location.search).get('id');
    if (id) {
      if (id !== currentRef.current.id) void openText(id);
      else setLibrary(false);
    } else {
      ++openGeneration.current;
      cancelWork();
      closeWord();
      player.current?.stop();
      setLibrary(true);
      setLoading(false);
      void loadList().catch((e) => setError(e.message));
    }
  }
  useEffect(() => {
    if (!visible) {
      cancelWork();
      closeWord();
      player.current?.stop();
      setAdding(false);
      setDeleteTarget(null);
    } else if (!wasActive.current) restoreReaderLocation();
    wasActive.current = visible;
  }, [visible]);
  useEffect(() => {
    const back = () => {
      if (activeRef.current) restoreReaderLocation();
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  function notify(s: string) {
    setNotice(s);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(''), 6000);
  }
  function patch(id: string, change: Partial<Progress>) {
    setProgress((p) => ({
      ...p,
      [id]: { ...(p[id] || { audio: 'pending', translation: 'pending' }), ...change },
    }));
  }
  async function loadList(force = false) {
    const generation = ++listGeneration.current;
    const path = '/api/text-library' + (textArchive ? '?archived=true' : '');
    const cached = clientData.peek<any[]>(path);
    setTexts(cached || []);
    setListLoading(!cached);
    try {
      const list = await readJson<any[]>(path, force);
      if (generation === listGeneration.current) setTexts(list);
      return list;
    } finally {
      if (generation === listGeneration.current) setListLoading(false);
    }
  }
  function mergeTranslations(
    textId: string,
    values: Pick<ReadingSegment, 'id' | 'en' | 'translationProvider' | 'translationFallback'>[],
  ) {
    if (currentRef.current.id !== textId) return;
    const next = {
      ...currentRef.current,
      segments: currentRef.current.segments.map((s) => ({
        ...s,
        ...(values.find((v) => v.id === s.id) || {}),
      })),
    };
    currentRef.current = next;
    setCurrent(next);
    clientData.put('/api/texts?id=' + encodeURIComponent(textId), next);
    for (const v of values) patch(v.id, { translation: 'ready' });
  }
  function speakWord(text: string) {
    if (!audioReady) {
      notify('Connect ElevenLabs and choose a voice in Settings.');
      return;
    }
    const player = wordPlayer.current;
    if (!player) {
      notify('Audio is not ready. Please try again.');
      return;
    }
    if (wordSound.text === text) {
      if (wordSound.state === 'loading') {
        player.stop();
        return;
      }
      if (wordSound.state === 'playing') {
        player.pause();
        return;
      }
      if (wordSound.state === 'paused') {
        player.resume();
        return;
      }
    }
    setWordSound({ text, state: 'loading' });
    void player.start([text], -1);
  }
  function closeWord() {
    formController.current?.abort();
    wordController.current?.abort();
    ++wordGeneration.current;
    wordPlayer.current?.stop();
    setWord(null);
    setPhrase('');
    setPhraseAnchor(null);
  }
  function cancelWork() {
    prepareController.current?.abort();
    translationController.current?.abort();
    setPreparing(false);
    setTranslationBusy(false);
    setProgress((p) =>
      Object.fromEntries(
        Object.entries(p).map(([id, v]) => [
          id,
          {
            ...v,
            audio: v.audio === 'loading' ? 'pending' : v.audio,
            translation: v.translation === 'loading' ? 'pending' : v.translation,
          },
        ]),
      ),
    );
  }
  async function openText(id: string, force = false) {
    setLibrary(false);
    window.history.replaceState(null, '', '/texts?id=' + encodeURIComponent(id));
    const generation = ++openGeneration.current;
    cancelWork();
    closeWord();
    player.current?.stop();
    setError('');
    const path = '/api/texts?id=' + encodeURIComponent(id),
      cached = force ? undefined : clientData.peek<Text>(path);
    let applied = false;
    setLoading(!cached);
    function apply(text: Text) {
      const same =
        applied && currentRef.current.id === id && currentRef.current.scope === text.scope;
      currentRef.current = text;
      readyAudio.current = new Set([
        ...text.segments.filter((s) => s.audioReady).map((s) => s.id),
        ...(same ? Array.from(readyAudio.current) : []),
      ]);
      setCurrent(text);
      setReady(text.keyConfigured);
      setTranslationReady(!!(text.translationReady ?? text.keyConfigured));
      setAudioReady(!!text.audioConfigured);
      if (!same) {
        player.current?.configure(text.segments, text.scope);
        wordPlayer.current?.setCacheScope(text.wordScope || text.scope);
        let at = 0;
        try {
          at = Number(localStorage.getItem('dutch-reading:' + text.scope + ':' + id) || 0);
        } catch {}
        at = Number.isInteger(at) ? Math.max(0, Math.min(text.segments.length - 1, at)) : 0;
        setPosition(at);
        setActive(-1);
      }
      setProgress(
        Object.fromEntries(
          text.segments.map((s) => [
            s.id,
            {
              audio: readyAudio.current.has(s.id) ? 'ready' : 'pending',
              translation: s.en ? 'ready' : 'pending',
            },
          ]),
        ),
      );
      applied = true;
      setLoading(false);
      try {
        localStorage.setItem('dutch-last-text', id);
      } catch {}
      if (player.current)
        player.current.loadFragment = async (segmentId, signal) => {
          const group = audioGroups(text.segments).find((g) => g.some((s) => s.id === segmentId));
          if (!group) throw Error('Sentence not found.');
          for (const s of group) patch(s.id, { audio: 'loading', error: '' });
          try {
            const r = await fetch('/api/texts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id, action: 'audio-fragment', segment: segmentId }),
              signal,
            });
            if (!r.ok) {
              const j: any = await r.json();
              throw Error(j.error || 'Audio preparation failed.');
            }
            const cues = JSON.parse(r.headers.get('X-Audio-Timeline') || 'null'),
              blob = await r.blob();
            if (currentRef.current.id === id && !signal?.aborted) {
              for (const s of group) {
                readyAudio.current.add(s.id);
                patch(s.id, { audio: 'ready' });
              }
              clientData.put(path, {
                ...currentRef.current,
                segments: currentRef.current.segments.map((s) => ({
                  ...s,
                  audioReady: readyAudio.current.has(s.id),
                })),
              });
            }
            return { blob, cues };
          } catch (e) {
            if (currentRef.current.id === id && !signal?.aborted)
              for (const s of group) patch(s.id, { audio: 'error', error: (e as Error).message });
            throw e;
          }
        };
    }
    if (cached) apply(cached);
    try {
      const text = await readJson<Text>(path, force);
      if (generation === openGeneration.current && text !== cached) apply(text);
    } catch (e) {
      if (generation === openGeneration.current) setError((e as Error).message);
    } finally {
      if (generation === openGeneration.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (audio.current)
      player.current = new TextPlayer(
        audio.current,
        (index, state) => {
          setAudioState(state);
          if (index >= 0) {
            setActive(index);
            if (state === 'playing') {
              setPosition(index);
              const text = currentRef.current;
              try {
                localStorage.setItem('dutch-reading:' + text.scope + ':' + text.id, String(index));
              } catch {}
            }
          }
        },
        notify,
      );
    if (wordAudio.current)
      wordPlayer.current = new AudioSequence(
        wordAudio.current,
        (_index, state) => setWordSound((s) => ({ ...s, state })),
        notify,
      );
    void (async () => {
      try {
        const requested = new URLSearchParams(window.location.search).get('id');
        await Promise.all([
          readJson('/api/settings').then((settings) => {
            setReady(settings.keyConfigured);
            setTranslationReady(!!(settings.translationReady ?? settings.keyConfigured));
            setAudioReady(!!settings.audioReady);
            setAutoForm(settings.preferences?.aiEnrichment !== 'off');
            wordPlayer.current?.setCacheScope(settings.audioCacheScope);
          }),
          loadList(),
          requested ? openText(requested) : Promise.resolve(),
        ]);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => {
      cancelWork();
      wordController.current?.abort();
      formController.current?.abort();
      ++openGeneration.current;
      player.current?.dispose();
      wordPlayer.current?.dispose();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    void loadList().catch((e) => setError(e.message));
  }, [textArchive]);
  useEffect(() => {
    const refresh = () => {
      clientData.invalidate(['/api/texts']);
      void Promise.all([loadList(true), readJson('/api/settings', true)]).catch((e) =>
        setError(e.message),
      );
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [textArchive]);
  useEffect(() => {
    if (!word && !adding) return;
    const previous = document.activeElement as HTMLElement;
    dialog.current?.querySelector<HTMLElement>('button,input')?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) {
        closeWord();
        closeForm();
      }
      if (e.key === 'Tab') {
        const nodes = Array.from(
            dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input,textarea,select',
            ) || [],
          ),
          first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, [word?.nl, adding, saving]);
  async function translateBatch(text: Text, segments: ReadingSegment[], signal?: AbortSignal) {
    segments.forEach((s) => patch(s.id, { translation: 'loading', error: '' }));
    try {
      const result = await api(
        '/api/texts',
        { id: text.id, action: 'translate', segments: segments.map((s) => s.id) },
        signal,
      );
      mergeTranslations(text.id, result.segments);
    } catch (e) {
      if (!signal?.aborted && currentRef.current.id === text.id)
        segments.forEach((s) => patch(s.id, { translation: 'error', error: (e as Error).message }));
      throw e;
    }
  }
  async function translateAll() {
    if (!translationReady) {
      notify('Connect Azure or OpenAI in Settings to translate.');
      return;
    }
    if (!current.id) {
      setShowTranslation(true);
      return;
    }
    translationController.current?.abort();
    const controller = new AbortController();
    translationController.current = controller;
    setShowTranslation(true);
    setTranslationBusy(true);
    const text = currentRef.current;
    try {
      const missing = text.segments.filter((s) => !s.en);
      for (let i = 0; i < missing.length; i += 4) {
        if (controller.signal.aborted) break;
        await translateBatch(text, missing.slice(i, i + 4), controller.signal);
      }
    } catch (e) {
      if (!controller.signal.aborted) notify((e as Error).message);
    } finally {
      if (translationController.current === controller) setTranslationBusy(false);
    }
  }
  async function prepareText() {
    if (preparing) {
      cancelWork();
      return;
    }
    if (!current.id) {
      notify('Save a text first to prepare it.');
      return;
    }
    if (!audioReady) {
      notify('Connect ElevenLabs and choose a voice in Settings.');
      return;
    }
    translationController.current?.abort();
    setTranslationBusy(false);
    const controller = new AbortController();
    prepareController.current = controller;
    setPreparing(true);
    setPanel(true);
    const text = currentRef.current;
    await Promise.allSettled([
      (async () => {
        if (!(text.translationReady ?? text.keyConfigured)) return;
        const missing = text.segments.filter((s) => !s.en);
        for (let i = 0; i < missing.length; i += 4) {
          if (controller.signal.aborted) return;
          try {
            await translateBatch(text, missing.slice(i, i + 4), controller.signal);
          } catch {
            if (controller.signal.aborted) return;
          }
        }
      })(),
      (async () => {
        for (const group of audioGroups(text.segments)) {
          if (controller.signal.aborted) return;
          try {
            await player.current?.preload(group[0].id, controller.signal);
            if (!controller.signal.aborted && currentRef.current.id === text.id)
              for (const s of group) {
                readyAudio.current.add(s.id);
                patch(s.id, { audio: 'ready', error: '' });
              }
          } catch (e) {
            if (!controller.signal.aborted && currentRef.current.id === text.id)
              for (const s of group) patch(s.id, { audio: 'error', error: (e as Error).message });
          }
        }
      })(),
    ]);
    if (prepareController.current === controller) {
      setPreparing(false);
      prepareController.current = null;
    }
  }
  async function retry(s: ReadingSegment) {
    if (!audioReady) return;
    const text = currentRef.current;
    if (!s.en && translationReady)
      try {
        await translateBatch(text, [s]);
      } catch (e) {
        notify((e as Error).message);
      }
    try {
      await player.current?.preload(s.id);
      const group = audioGroups(text.segments).find((g) => g.some((x) => x.id === s.id)) || [s];
      for (const row of group) patch(row.id, { audio: 'ready', error: '' });
    } catch (e) {
      patch(s.id, { audio: 'error', error: (e as Error).message });
    }
  }

  function play(from = position, once = false) {
    from = Math.max(0, Math.min(current.segments.length - 1, from));
    if (!audioReady) {
      notify('Connect ElevenLabs and choose a voice in Settings.');
      return;
    }
    closeWord();
    setPosition(from);
    setActive(from);
    void (once ? player.current?.playOnce(from) : player.current?.start(from));
  }
  function togglePlay() {
    if (audioState === 'playing') player.current?.pause();
    else if (audioState === 'paused') player.current?.resume();
    else if (audioState === 'loading') player.current?.stop();
    else play();
  }
  async function translateWordForm(selected: Word, n = wordGeneration.current) {
    if (!ready || !selected.segment) return;
    formController.current?.abort();
    const controller = new AbortController();
    formController.current = controller;
    setWord((w) => (w ? { ...w, contextBusy: true, contextError: '' } : null));
    try {
      const result = await api(
        '/api/lookup',
        {
          mode: 'selected-form',
          query: selected.nl,
          context: selected.segment.nl,
          lemma: selected.entry?.lemma || '',
        },
        controller.signal,
      );
      if (n !== wordGeneration.current || controller.signal.aborted) return;
      setWord((w) =>
        w
          ? {
              ...w,
              contextBusy: false,
              contextMeaning: result.found ? result.english : '',
              formLabel: result.formLabel,
              contextLemma: result.baseForm,
              contextError: result.found ? '' : 'No clear translation found for this selection.',
            }
          : null,
      );
    } catch (e) {
      if (n === wordGeneration.current && !controller.signal.aborted)
        setWord((w) =>
          w ? { ...w, contextBusy: false, contextError: (e as Error).message } : null,
        );
    }
  }
  async function openWord(nl: string, segment?: ReadingSegment, back?: Word['back']) {
    if (!nl.trim()) return;
    if (nl.length > 240) {
      notify('Select a phrase of up to 240 characters.');
      return;
    }
    if (audioState === 'playing') player.current?.pause();
    else if (audioState === 'loading') player.current?.stop();
    wordController.current?.abort();
    formController.current?.abort();
    wordPlayer.current?.stop();
    const n = ++wordGeneration.current,
      controller = new AbortController();
    wordController.current = controller;
    setWord({ nl, segment, back, busy: true });
    try {
      const entry = await localLookup(nl);
      if (n !== wordGeneration.current) return;
      const selected = { nl, segment, back, entry, busy: false };
      setWord(selected);
      if (segment) {
        if (ready && autoForm) void translateWordForm(selected, n);
      } else if (!entry.found && translationReady) {
        setWord({ ...selected, busy: true });
        const translated = await api(
          '/api/lookup',
          { mode: 'translate', query: nl },
          controller.signal,
        );
        if (n === wordGeneration.current) setWord({ ...selected, entry: translated, busy: false });
      }
    } catch (e) {
      if (n === wordGeneration.current && !controller.signal.aborted) {
        const selected = { nl, segment, back, busy: false, error: (e as Error).message };
        setWord(selected);
        if (segment && ready && autoForm) void translateWordForm(selected, n);
      }
    }
  }
  async function explainWord() {
    if (!word || !ready) return;
    const selected = word,
      n = wordGeneration.current;
    wordController.current?.abort();
    const controller = new AbortController();
    wordController.current = controller;
    setWord({ ...selected, busy: true, error: '' });
    try {
      const entry = await api(
        '/api/lookup',
        { query: selected.nl, context: selected.segment?.nl || '', evidence: selected.entry },
        controller.signal,
      );
      if (n === wordGeneration.current) setWord((w) => (w ? { ...w, entry, busy: false } : null));
    } catch (e) {
      if (n === wordGeneration.current && !controller.signal.aborted)
        setWord((w) => (w ? { ...w, busy: false, error: (e as Error).message } : null));
    }
  }
  async function saveMeaning(meaning: string, whole = false) {
    if (!word) return;
    setSaving(true);
    try {
      const nl = whole ? word.segment?.nl : word.nl;
      if (!nl) throw Error('Choose a phrase.');
      const result = await api('/api/materials', {
        kind: 'phrase',
        title: nl,
        practice: practice !== 'off',
        practiceMode: practice,
        body: {
          en: meaning,
          ...(!whole
            ? {
                dictionarySnapshot: dictionarySnapshot(word.entry, word.contextLemma),
                forms: dictionarySnapshot(word.entry, word.contextLemma)?.forms || [],
                article: nounArticle(word.nl, word.entry, word.contextLemma),
                partOfSpeech:
                  !word.contextLemma || word.contextLemma === word.entry?.lemma
                    ? word.entry?.partOfSpeech || ''
                    : '',
                selectedForm: word.nl,
                lemma: word.contextLemma || word.entry?.lemma || word.nl,
                formLabel: word.formLabel || '',
                meaningSource:
                  meaning === word.contextMeaning
                    ? 'OpenAI contextual translation'
                    : 'Dictionary meaning',
              }
            : {}),
          example: whole ? '' : word.segment?.nl || '',
          exampleTranslation: whole
            ? ''
            : current.segments.find((s) => s.id === word.segment?.id)?.en || '',
          source: current.title,
          textId: current.id,
          segmentId: word.segment?.id,
          sourceUrl: word.entry?.sourceUrl,
          notes: word.entry?.queryExplanation || '',
        },
      });
      notify(
        result.duplicate
          ? 'Already in your collection.'
          : 'Saved' +
              (practice !== 'off'
                ? ' and added to ' + (practice === 'words' ? 'Words' : 'Sentences') + '.'
                : '.'),
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function capturePhrase() {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || !selection.toString().trim()) {
      if (document.activeElement?.closest('.selection-popover')) return;
      setPhrase('');
      setPhraseAnchor(null);
      return;
    }
    const range = selection.getRangeAt(0),
      parent =
        range.commonAncestorContainer.nodeType === 1
          ? (range.commonAncestorContainer as Element)
          : range.commonAncestorContainer.parentElement;
    const start = selection.anchorNode?.parentElement,
      end = selection.focusNode?.parentElement;
    if (
      !parent?.closest('[data-reading-text]') ||
      !start?.closest('[data-reading-text]') ||
      !end?.closest('[data-reading-text]')
    ) {
      setPhrase('');
      setPhraseAnchor(null);
      return;
    }
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) return;
    const rect = rects.find((r) => r.bottom > 0 && r.top < window.innerHeight) || rects[0];
    const viewport = window.visualViewport;
    const width = viewport?.width || window.innerWidth,
      offset = viewport?.offsetTop || 0;
    const below = rect.top - offset < 60 || width < 640;
    setPhrase(selection.toString().trim().slice(0, 241));
    setPhraseAnchor({
      top: below ? rect.bottom + 10 : rect.top - 10,
      left: Math.max(12, Math.min(width - 200, rect.left)),
      below,
    });
  }
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!dialog.current) capturePhrase();
      });
    };
    const scroll = () => {
      setPhrase('');
      setPhraseAnchor(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPhrase('');
        setPhraseAnchor(null);
      }
    };
    document.addEventListener('keydown', escape);
    document.addEventListener('selectionchange', update);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', scroll);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('selectionchange', update);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', scroll);
    };
  }, []);
  function lookupPhrase() {
    const selected = phrase,
      segment = current.segments.find((s) => s.nl.includes(selected));
    void openWord(selected, segment);
    window.getSelection()?.removeAllRanges();
    setPhrase('');
    setPhraseAnchor(null);
  }
  async function changeTextArchive(
    target: { id: string; title: string; version: number },
    restore = false,
  ) {
    setDeleting(true);
    setDeleteError('');
    try {
      const r = await fetch('/api/materials', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: target.id, version: target.version, archived: !restore }),
      });
      const result: any = await r.json();
      if (!r.ok) throw Error(result.error || 'The text could not be updated.');
      dataChanged('/api/materials');
      clientData.remove('/api/texts?id=' + encodeURIComponent(target.id));
      if (!restore && currentRef.current.id === target.id) {
        ++openGeneration.current;
        cancelWork();
        closeWord();
        player.current?.stop();
        setLibrary(true);
        setCurrent(sample);
        currentRef.current = sample;
        setPosition(0);
        setLoading(false);
        window.history.replaceState(null, '', '/texts');
      }
      setDeleteTarget(null);
      await loadList(true);
      notify(restore ? 'Text restored.' : 'Text moved to Archive.');
    } catch (e) {
      setDeleteError((e as Error).message);
      await loadList(true).catch(() => {});
      if (restore) notify((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }
  async function beginEdit() {
    cancelWork();
    player.current?.stop();
    closeWord();
    const id = current.id;
    try {
      const latest: Text = await readJson('/api/texts?id=' + encodeURIComponent(id), true);
      if (currentRef.current.id !== id) return;
      setEditBase(latest);
      setTitle(latest.title);
      setSource(latest.source);
      setOriginal(latest.original ?? latest.segments.map((s) => s.nl).join('\n'));
      setFormError('');
      setAdding(true);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function closeForm() {
    if (saving) return;
    setAdding(false);
    setEditBase(null);
    setFormError('');
  }
  function preparationNeeded(draft: string) {
    const available = new Map<string, boolean[]>();
    for (const segment of editBase?.segments || []) {
      const values = available.get(segment.nl) || [];
      values.push(!!segment.en && (segment.audioReady || progress[segment.id]?.audio === 'ready'));
      available.set(segment.nl, values);
    }
    return segmentText(draft).filter((nl) => !available.get(nl)?.shift()).length;
  }
  async function saveEdits(e: React.FormEvent) {
    e.preventDefault();
    if (!editBase) return;
    setSaving(true);
    setFormError('');
    try {
      const result = await api('/api/texts', {
        action: 'edit',
        id: editBase.id,
        version: editBase.version,
        title,
        source,
        original,
      });
      setAdding(false);
      setEditBase(null);
      await loadList();
      await openText(result.text.id);
      notify(
        result.needsPreparation
          ? `Saved. ${result.needsPreparation} sentences need preparation.`
          : 'Saved. All prepared audio and translations are kept.',
      );
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function addText(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const segments = segmentText(original).map((nl) => ({ nl, en: '' }));
      if (!segments.length) throw Error('Paste a Dutch text.');
      if (segments.length > 400) throw Error('Use up to 400 sentences per text.');
      const result = await api('/api/materials', {
        kind: 'text',
        title: title.trim() || 'New text',
        body: { source, original, segments },
      });
      await loadList();
      setAdding(false);
      setOriginal('');
      setTitle('');
      await openText(result.id);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const baseLemma = word?.contextLemma || word?.entry?.lemma || word?.nl || '';
  const hasBaseForm =
    !!word &&
    baseLemma.normalize('NFC').toLocaleLowerCase('nl') !==
      word.nl.normalize('NFC').toLocaleLowerCase('nl');
  const wordMeanings = word
    ? word.entry?.senses.map((sense, i) => (
        <div className="reader-meaning" key={i}>
          <div>
            <b>{sense.meaning}</b>
            {sense.usage && <small>{sense.usage}</small>}
          </div>
          {(!word.segment || !hasBaseForm) && (
            <button
              className="icon-button"
              disabled={saving}
              aria-label={'Save meaning ' + (i + 1)}
              onClick={() => saveMeaning(sense.meaning)}
            >
              <Bookmark size={18} />
            </button>
          )}
        </div>
      ))
    : null;
  const preparation = textPreparation(current.segments, progress);
  const { parts, readyParts, percent, translated, translationErrors } = preparation;
  const audioErrors = parts.some((p) => p.state === 'error');
  const allReady = readyParts === parts.length && translated === current.segments.length;
  const partStatus = (state: string) =>
    state === 'loading'
      ? 'Preparing…'
      : state === 'ready'
        ? 'Ready'
        : state === 'error'
          ? 'Needs retry'
          : 'Pending';
  return (
    <div className="app">
      <audio ref={audio} preload="auto" />
      <audio ref={wordAudio} preload="auto" />
      <AppHeader active="Texts" onNavigate={onNavigate} />
      <main className="main reading">
        {error && (
          <div className="alert" role="alert">
            {error}
            <button
              onClick={() =>
                current.id ? openText(current.id) : loadList().catch((e) => notify(e.message))
              }
            >
              Try again
            </button>
          </div>
        )}
        {library ? (
          <>
            <div className="section-heading">
              <div>
                <span className="eyebrow">YOUR READING LIBRARY</span>
                <h1>{textArchive ? 'Archived texts' : 'Texts'}</h1>
                <p>
                  {textArchive
                    ? 'Restore a text to read it again.'
                    : 'Your texts, translations and Dutch audio.'}
                </p>
              </div>
              <div className="text-library-actions">
                <button
                  className="text-action"
                  disabled={deleting}
                  onClick={() => setTextArchive(!textArchive)}
                >
                  <Archive size={15} />
                  {textArchive ? 'Back to texts' : 'Archive'}
                </button>
                {!textArchive && (
                  <button
                    className="primary"
                    onClick={() => {
                      setEditBase(null);
                      setFormError('');
                      setAdding(true);
                      setTitle('');
                      setOriginal('');
                      setSource('');
                    }}
                  >
                    <Plus size={17} />
                    Add text
                  </button>
                )}
              </div>
            </div>
            <div className="saved-list">
              {texts.map((t) => (
                <div className="saved-card text-library-card" key={t.id}>
                  <button
                    className="text-library-entry"
                    disabled={textArchive}
                    onClick={() => openText(t.id)}
                  >
                    <h2>{t.title}</h2>
                    <p>{t.source || 'My text'}</p>
                    <small>{t.sentenceCount} sentences</small>
                  </button>
                  {textArchive ? (
                    <button
                      className="secondary"
                      disabled={deleting}
                      onClick={() => void changeTextArchive(t, true)}
                    >
                      <RestoreIcon size={15} />
                      Restore
                    </button>
                  ) : (
                    <button
                      className="icon-button delete-text-button"
                      aria-label={'Delete ' + t.title}
                      title="Delete text"
                      onClick={() => {
                        setDeleteError('');
                        setDeleteTarget(t);
                      }}
                    >
                      <Trash2 size={17} />
                    </button>
                  )}
                </div>
              ))}
              {listLoading && !texts.length && (
                <div className="lookup-loading" role="status">
                  <LoaderCircle className="spin" />
                  <p>Loading your texts…</p>
                </div>
              )}
              {!listLoading && !texts.length && (
                <div className="empty">
                  <BookOpen size={28} />
                  <h2>{textArchive ? 'Archive is empty' : 'Your reading library'}</h2>
                  <p>
                    {textArchive
                      ? 'Deleted texts will appear here.'
                      : 'Add a Dutch text to start reading, translating and listening.'}
                  </p>
                  {!textArchive && (
                    <button
                      className="secondary"
                      onClick={() => {
                        setLibrary(false);
                        setCurrent(sample);
                        currentRef.current = sample;
                        setPosition(0);
                        setActive(-1);
                        setProgress({});
                        setPanel(false);
                      }}
                    >
                      Explore a sample text
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="breadcrumb">
              <button
                className="back-to-texts"
                onClick={() => {
                  ++openGeneration.current;
                  cancelWork();
                  closeWord();
                  player.current?.stop();
                  setLibrary(true);
                  setLoading(false);
                  setError('');
                  setPanel(false);
                  window.history.replaceState(null, '', '/texts');
                  void loadList().catch((e) => notify(e.message));
                }}
              >
                <ArrowLeft size={15} />
                All texts
              </button>
            </div>
            {loading ? (
              <div className="lookup-loading">
                <LoaderCircle className="spin" />
                <p>Opening your text…</p>
              </div>
            ) : (
              <article className="reader">
                <div className="reader-meta">
                  <span className="level">DUTCH</span>
                  <span>{current.segments.length} sentences</span>
                </div>
                <div className="reader-title-row">
                  <h1>{current.title}</h1>
                  {current.id && (
                    <button className="text-action edit-text-button" onClick={beginEdit}>
                      <Pencil size={14} />
                      Edit text
                    </button>
                  )}
                </div>
                {current.source && <p className="reader-source">{current.source}</p>}
                <div className="audio-toolbar text-controls">
                  <button className="listen-button" onClick={togglePlay}>
                    {audioState === 'loading' ? (
                      <LoaderCircle size={17} className="spin" />
                    ) : audioState === 'playing' ? (
                      <Pause size={17} />
                    ) : (
                      <Play size={17} />
                    )}
                    <span>
                      {audioState === 'loading'
                        ? 'Cancel loading'
                        : audioState === 'playing'
                          ? 'Pause'
                          : audioState === 'paused'
                            ? 'Resume'
                            : position > 0
                              ? 'Continue'
                              : 'Listen'}
                    </span>
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Previous sentence"
                    title="Previous sentence"
                    disabled={!current.segments.length || position <= 0}
                    onClick={() => play(position - 1)}
                  >
                    <SkipBack size={18} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Next sentence"
                    title="Next sentence"
                    disabled={position >= current.segments.length - 1}
                    onClick={() => play(position + 1)}
                  >
                    <SkipForward size={18} />
                  </button>
                  <span className="sentence-counter" aria-live="polite">
                    {position + 1} / {current.segments.length}
                  </span>
                  <button
                    className="icon-button"
                    aria-label="Listen from beginning"
                    onClick={() => play(0)}
                  >
                    <RotateCcw size={18} />
                  </button>
                  <select
                    aria-label="Playback speed"
                    value={speed}
                    onChange={(e) => {
                      setSpeed(+e.target.value);
                      player.current?.setSpeed(+e.target.value);
                    }}
                  >
                    <option value="0.8">0.8×</option>
                    <option value="1">1×</option>
                    <option value="1.2">1.2×</option>
                  </select>
                  <button
                    className="text-action"
                    onClick={() => {
                      if (showTranslation) setShowTranslation(false);
                      else {
                        setShowTranslation(true);
                        if (!preparing) void translateAll();
                      }
                    }}
                  >
                    {translationBusy ? <LoaderCircle size={15} className="spin" /> : null}
                    {showTranslation ? 'Hide translation' : 'Show translation'}
                  </button>
                  <button className="secondary prepare-button" onClick={prepareText}>
                    {preparing ? <Square size={15} /> : <Download size={16} />}{' '}
                    {preparing
                      ? 'Stop preparation'
                      : current.edited
                        ? 'Prepare changes'
                        : 'Prepare text'}
                  </button>
                </div>
                {panel && (
                  <section className="preparation-panel" aria-label="Text preparation">
                    <div className="preparation-heading">
                      <div>
                        <b>
                          {preparing
                            ? 'Preparing your text'
                            : allReady
                              ? 'Ready to read and listen'
                              : audioErrors || translationErrors
                                ? 'Some parts need a retry'
                                : 'Text preparation'}
                        </b>
                        <small>
                          Audio · {readyParts} / {parts.length} parts ready
                        </small>
                      </div>
                      <button
                        className="icon-button"
                        aria-label="Hide preparation progress"
                        onClick={() => setPanel(false)}
                      >
                        <X size={17} />
                      </button>
                    </div>
                    <div
                      className="audio-part-progress"
                      role="progressbar"
                      aria-label="Audio prepared"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                      aria-valuetext={`${percent}% of text ready; ${readyParts} of ${parts.length} audio parts ready`}
                    >
                      {parts.map((p, i) => (
                        <span
                          key={p.id}
                          className={'audio-part-segment ' + p.state}
                          style={{ flexGrow: p.weight }}
                          title={`Part ${i + 1} · Sentences ${p.first}–${p.last} · ${partStatus(p.state)}`}
                        />
                      ))}
                    </div>
                    <div className="audio-part-list">
                      {parts.map((p, i) => (
                        <div key={p.id} className={'audio-part-row ' + p.state}>
                          <div>
                            <b>Part {i + 1}</b>
                            <small>
                              Sentences {p.first}–{p.last}
                            </small>
                          </div>
                          <span className="audio-part-status">
                            {p.state === 'loading' ? (
                              <LoaderCircle size={15} className="spin" />
                            ) : p.state === 'ready' ? (
                              <Check size={15} />
                            ) : p.state === 'error' ? (
                              <AlertCircle size={15} />
                            ) : null}
                            {partStatus(p.state)}
                          </span>
                          {p.state === 'error' && !preparing && (
                            <button
                              className="text-action"
                              onClick={() => retry(current.segments.find((s) => s.id === p.id)!)}
                            >
                              Retry
                            </button>
                          )}
                          {p.error && progress[p.error]?.error && (
                            <p className="audio-part-error">{progress[p.error].error}</p>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="preparation-translation">
                      <span>
                        Translation · {translated} / {current.segments.length} sentences ready
                      </span>
                      {translationBusy && <LoaderCircle size={14} className="spin" />}
                      {translationErrors && !preparing && (
                        <button className="text-action" onClick={() => void translateAll()}>
                          Retry translation
                        </button>
                      )}
                    </div>
                  </section>
                )}
                {!panel && current.id && (
                  <button
                    className="preparation-summary text-action"
                    onClick={() => setPanel(true)}
                  >
                    Preparation · Audio {readyParts}/{parts.length} parts <ChevronDown size={13} />
                  </button>
                )}
                <div
                  data-reading-text
                  className={'text-body sentence-list ' + (showTranslation ? 'parallel-text' : '')}
                  lang="nl"
                  onMouseUp={capturePhrase}
                  onTouchEnd={() => setTimeout(capturePhrase, 0)}
                >
                  {current.segments.map((s, i) => (
                    <span
                      key={s.id}
                      className={
                        'sentence ' + (active === i && audioState !== 'idle' ? 'is-speaking' : '')
                      }
                      aria-current={active === i && audioState !== 'idle' ? 'true' : undefined}
                    >
                      <span
                        className="sentence-audio-actions"
                        role="group"
                        aria-label={'Sentence ' + (i + 1) + ' audio'}
                      >
                        <button
                          aria-label={'Play sentence ' + (i + 1) + ' only'}
                          title="Play this sentence only"
                          onClick={() => play(i, true)}
                        >
                          <Play size={15} />
                        </button>
                        <button
                          aria-label={'Continue from sentence ' + (i + 1)}
                          title="Continue from this sentence"
                          onClick={() => play(i)}
                        >
                          <ListStart size={16} />
                        </button>
                      </span>
                      <span className="sentence-dutch">
                        {s.nl.split(/(\s+)/).map((w, j) =>
                          /^\s+$/.test(w) ? (
                            w
                          ) : (
                            <button
                              className="word"
                              key={j}
                              onClick={() => {
                                if (!window.getSelection()?.toString().trim())
                                  void openWord(
                                    w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''),
                                    s,
                                  );
                              }}
                            >
                              {w}
                            </button>
                          ),
                        )}
                      </span>
                      {showTranslation && (
                        <span className="sentence-english" lang="en">
                          {s.en ||
                            (progress[s.id]?.translation === 'loading'
                              ? 'Translating…'
                              : 'Translation not prepared yet.')}
                          {s.en && s.translationProvider && (
                            <small className="sentence-provider">
                              {s.translationProvider === 'azure'
                                ? 'Azure Translator'
                                : s.translationFallback
                                  ? 'OpenAI fallback'
                                  : 'OpenAI translation'}
                            </small>
                          )}
                          {!s.en && current.id && !preparing && !translationBusy && (
                            <button
                              className="text-action"
                              onClick={() =>
                                translateBatch(current, [s]).catch((e) => notify(e.message))
                              }
                            >
                              Translate
                            </button>
                          )}
                        </span>
                      )}{' '}
                    </span>
                  ))}
                </div>
                {phrase && phraseAnchor && (
                  <div
                    className="selection-popover"
                    role="toolbar"
                    aria-label="Selected phrase actions"
                    style={{
                      position: 'fixed',
                      top: phraseAnchor.top,
                      left: phraseAnchor.left,
                      transform: phraseAnchor.below ? 'none' : 'translateY(-100%)',
                    }}
                    onPointerDown={(e) => e.preventDefault()}
                  >
                    <button className="secondary" onClick={lookupPhrase}>
                      Look up selection
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Dismiss selected phrase"
                      onClick={() => {
                        window.getSelection()?.removeAllRanges();
                        setPhrase('');
                        setPhraseAnchor(null);
                      }}
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}
                <p className="reading-hint">
                  Tap a word for its meaning. Select a phrase to look it up. Use ▶ to hear one
                  sentence, or the list icon to continue from it.
                </p>
              </article>
            )}
          </>
        )}
      </main>
      {(word || adding) && (
        <div
          className="overlay"
          onClick={() => {
            if (!saving) {
              closeWord();
              closeForm();
            }
          }}
        >
          <div
            className={'sheet ' + (adding ? 'form-sheet' : 'reader-word-sheet')}
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-label={adding ? (editBase ? 'Edit text' : 'Add text') : 'Word meaning'}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close icon-button"
              aria-label="Close"
              onClick={() => {
                if (!saving) {
                  closeWord();
                  closeForm();
                }
              }}
            >
              <X size={20} />
            </button>
            {adding ? (
              <form onSubmit={editBase ? saveEdits : addText}>
                <span className="sheet-label">YOUR READING LIBRARY</span>
                <h2>{editBase ? 'Edit text' : 'Add a text'}</h2>
                {formError && (
                  <p className="alert" role="alert">
                    {formError}
                  </p>
                )}
                <label>
                  Title
                  <input
                    required
                    maxLength={500}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <label>
                  Dutch text
                  <textarea
                    className={editBase ? 'text-editor' : undefined}
                    required
                    maxLength={20000}
                    value={original}
                    onChange={(e) => setOriginal(e.target.value)}
                    placeholder="Paste your Dutch text…"
                  />
                </label>
                <label>
                  Source
                  <input
                    maxLength={500}
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="For example, Delftse methode · Les 9"
                  />
                </label>
                <p className="sheet-footnote">
                  {editBase
                    ? 'Changes may require re-preparing the affected audio fragment. Unchanged translations are kept. Saving does not generate audio.'
                    : 'Your original text is kept. Translation and audio can be prepared after saving.'}
                </p>
                <div className="editor-actions">
                  {editBase && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={saving}
                      onClick={closeForm}
                    >
                      Cancel
                    </button>
                  )}
                  <button className="primary wide" disabled={saving}>
                    {saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{' '}
                    {editBase ? 'Save changes' : 'Save text'}
                  </button>
                </div>
              </form>
            ) : (
              word && (
                <>
                  <span className="sheet-label">
                    {word.segment ? 'FROM YOUR TEXT' : 'DICTIONARY'}
                  </span>
                  {word.back && (
                    <button
                      className="text-action form-back"
                      onClick={() => openWord(word.back!.nl, word.back!.segment)}
                    >
                      <ArrowLeft size={14} />
                      Back to {word.back.nl}
                    </button>
                  )}
                  <div className="word-heading">
                    <h2 lang="nl">
                      <NounTitle
                        title={word.nl}
                        body={{ article: nounArticle(word.nl, word.entry, word.contextLemma) }}
                      />
                    </h2>
                    <button
                      className="pronounce"
                      aria-label="Listen to selected word"
                      onClick={() =>
                        audioReady
                          ? wordPlayer.current?.start(
                              [
                                (nounArticle(word.nl, word.entry, word.contextLemma)
                                  ? nounArticle(word.nl, word.entry, word.contextLemma) + ' '
                                  : '') + word.nl,
                              ],
                              -1,
                            )
                          : notify('Connect ElevenLabs and choose a voice in Settings.')
                      }
                    >
                      <Volume2 size={22} />
                    </button>
                  </div>
                  {word.entry?.partOfSpeech &&
                    (!word.segment ||
                      (word.contextMeaning &&
                        (!word.contextLemma || word.contextLemma === word.entry.lemma))) && (
                      <p className="grammar">{word.entry.partOfSpeech}</p>
                    )}
                  {hasBaseForm && (
                    <div className="base-form-link">
                      {word.formLabel && <span>{word.formLabel} · </span>}Base form{' '}
                      <button
                        onClick={() =>
                          openWord(baseLemma, undefined, { nl: word.nl, segment: word.segment })
                        }
                        lang="nl"
                      >
                        {baseLemma} ↗
                      </button>
                    </div>
                  )}
                  {word.segment && (
                    <section
                      className="selected-form-meaning"
                      aria-label="Meaning of selected form"
                    >
                      <small>MEANING IN THIS SENTENCE</small>
                      {word.contextBusy ? (
                        <p role="status">
                          <LoaderCircle className="spin" size={14} /> Translating “{word.nl}”…
                        </p>
                      ) : word.contextMeaning ? (
                        <div className="reader-meaning">
                          <div>
                            <b>{word.contextMeaning}</b>
                            {word.formLabel && <small>{word.formLabel}</small>}
                          </div>
                          <button
                            className="icon-button"
                            disabled={saving}
                            aria-label="Save selected form"
                            onClick={() => saveMeaning(word.contextMeaning!)}
                          >
                            <Bookmark size={18} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <p role="status">
                            {word.contextError ||
                              (ready
                                ? 'Translation of the selected form is not prepared yet.'
                                : 'Connect OpenAI in Settings to translate the selected form.')}
                          </p>
                          {ready && (
                            <button className="text-action" onClick={() => translateWordForm(word)}>
                              {word.contextError ? 'Retry translation' : 'Translate this form'}
                            </button>
                          )}
                        </>
                      )}
                      <small className="meaning-source">
                        OpenAI contextual translation · original Dutch form is kept
                      </small>
                    </section>
                  )}
                  {word.busy && (
                    <p role="status">
                      <LoaderCircle className="spin" size={15} /> Looking up your Dutch…
                    </p>
                  )}
                  {word.error && <p className="alert">{word.error}</p>}
                  {word.entry?.queryExplanation && <p>{word.entry.queryExplanation}</p>}
                  {hasBaseForm && word.entry?.senses.length ? (
                    <details className="entry-details">
                      <summary>
                        Dictionary meanings · {word.entry?.lemma}
                        <ChevronDown size={14} />
                      </summary>
                      {wordMeanings}
                    </details>
                  ) : (
                    wordMeanings
                  )}
                  {!word.busy &&
                    !word.contextMeaning &&
                    !word.contextBusy &&
                    !word.entry?.senses.length && (
                      <p>
                        No dictionary meaning found. Try another selection or an AI explanation.
                      </p>
                    )}
                  {word.entry?.forms.length &&
                  (!word.segment ||
                    !word.contextLemma ||
                    word.contextLemma === word.entry.lemma) ? (
                    <details className="entry-details" open>
                      <summary>
                        Forms <ChevronDown size={14} />
                      </summary>
                      <WordForms
                        forms={word.entry.forms}
                        partOfSpeech={word.entry.partOfSpeech}
                        lemma={word.entry.lemma}
                        article={word.entry.article}
                        selectedForm={word.nl}
                        onSpeak={speakWord}
                        currentAudio={wordSound.text}
                        audioState={wordSound.state}
                      />
                    </details>
                  ) : null}
                  {word.segment && (
                    <button
                      className="secondary sentence-listen-action"
                      onClick={() => {
                        const index = current.segments.findIndex((s) => s.id === word.segment?.id);
                        if (index >= 0) play(index, true);
                      }}
                    >
                      <Play size={16} />
                      Play this sentence only
                    </button>
                  )}
                  {word.segment && (
                    <button
                      className="secondary sentence-listen-action"
                      onClick={() => {
                        const index = current.segments.findIndex((s) => s.id === word.segment?.id);
                        if (index >= 0) play(index);
                      }}
                    >
                      <Play size={16} />
                      Listen from this sentence
                    </button>
                  )}
                  {word.segment && (
                    <div className="context">
                      <small>IN CONTEXT</small>
                      <p lang="nl">{word.segment.nl}</p>
                      <p>{current.segments.find((s) => s.id === word.segment?.id)?.en || ''}</p>
                    </div>
                  )}
                  <PracticeModeSelect value={practice} onChange={setPractice} />
                  {ready && (
                    <button className="secondary" disabled={word.busy} onClick={explainWord}>
                      {word.segment ? 'Explain in this sentence' : 'Explain this word'}
                    </button>
                  )}
                  {word.segment && (
                    <button
                      className="text-action"
                      disabled={saving}
                      onClick={async () => {
                        let en = currentRef.current.segments.find(
                          (s) => s.id === word.segment?.id,
                        )?.en;
                        if (!en && current.id) {
                          try {
                            await translateBatch(current, [word.segment!]);
                            en = currentRef.current.segments.find(
                              (s) => s.id === word.segment?.id,
                            )?.en;
                          } catch (e) {
                            notify((e as Error).message);
                            return;
                          }
                        }
                        if (en) await saveMeaning(en, true);
                        else notify('Translate this sentence first.');
                      }}
                    >
                      Save the whole sentence
                    </button>
                  )}
                  {word.entry?.source && (
                    <p className="sheet-footnote">
                      {word.entry.source}
                      {word.entry.sourceUrl && (
                        <>
                          {' '}
                          ·{' '}
                          <a href={word.entry.sourceUrl} target="_blank" rel="noreferrer">
                            Source
                          </a>
                        </>
                      )}
                    </p>
                  )}
                </>
              )
            )}
          </div>
        </div>
      )}
      {deleteTarget && (
        <ConfirmTextDelete
          title={deleteTarget.title}
          busy={deleting}
          error={deleteError}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void changeTextArchive(deleteTarget)}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button aria-label="Dismiss" onClick={() => setNotice('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
