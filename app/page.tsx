'use client';
import {
  Archive,
  ArrowRight,
  Bookmark,
  Check,
  ChevronDown,
  KeyRound,
  LoaderCircle,
  Pause,
  Plus,
  Search,
  ShieldCheck,
  Volume2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioSequence } from '../lib/audio-sequence';
import { clientData, dataChanged, readJson } from '../lib/client-data';
import { localLookup, suggest } from '../lib/local-dictionary';
import { nounArticle } from '../lib/noun-article';
import { practiceMode, PracticeMode } from '../lib/practice-mode';
import { FormTranslation, searchMeaningMaterial } from '../lib/search-form';
import { defaultSentencePreferences, SentencePreferences } from '../lib/sentences';
import type { Entry } from '../lib/server/dictionary';
import type { LearningProgress as Learning } from '../lib/word-progress';
import { defaultWordPreferences, WordPreferences } from '../lib/words';
import AppHeader from './components/app-header';
import BackupControls from './components/backup-controls';
import CollectionDetails from './components/collection-details';
import LearningProgress from './components/learning-progress';
import NounTitle from './components/noun-title';
import Practice from './components/practice';
import PracticeBadge from './components/practice-badge';
import PracticeModeSelect from './components/practice-mode-select';
import SentencesSettings from './components/sentences-settings';
import SpeechSettings from './components/speech-settings';
import TextsReader from './components/texts-reader';
import WordForms from './components/word-forms';
import WordsSettings from './components/words-settings';
type Material = {
  id: string;
  title: string;
  kind: string;
  body: any;
  created: string;
  version: number;
  rank: number;
  practice: boolean;
  last_seen?: string;
  learning?: Learning;
};
type Preferences = {
  sentences: SentencePreferences;
  words: WordPreferences;
  translationModel: string;
  aiEnrichment: 'auto' | 'manual' | 'off';
  voice: string;
  style: string;
  tone: string;
  textModel: string;
  audioModel: string;
  format: string;
};
const defaultPreferences: Preferences = {
  sentences: defaultSentencePreferences,
  words: defaultWordPreferences,
  translationModel: 'same',
  aiEnrichment: 'auto',
  voice: 'marin',
  style: 'natural',
  tone: 'Warm, calm and clear.',
  textModel: 'gpt-4.1-mini',
  audioModel: 'gpt-realtime-2.1-mini',
  format: 'wav',
};
const voices = [
  'marin',
  'cedar',
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
];
async function api(path: string, data?: any, method?: string, signal?: AbortSignal) {
  if (!data && (!method || method === 'GET')) return readJson(path);
  const r = await fetch(path, {
    method: method || (data ? 'POST' : 'GET'),
    headers: data ? { 'Content-Type': 'application/json' } : undefined,
    body: data ? JSON.stringify(data) : undefined,
    signal,
  });
  const j: any = await r.json();
  if (!r.ok) throw Error(j.error || 'Please try again.');
  dataChanged(path);
  return j;
}
export default function App({ initialTab = 'Search' }: { initialTab?: string } = {}) {
  const [audioConfigured, setAudioConfigured] = useState(false),
    [audioScope, setAudioScope] = useState('');
  const [collectionLoading, setCollectionLoading] = useState(
    () => !clientData.peek('/api/materials?kind=phrase&summary=true&archived=false'),
  );
  const [practiceVisited, setPracticeVisited] = useState(false),
    [textsVisited, setTextsVisited] = useState(initialTab === 'Texts');
  const textsUrl = useRef('/texts'),
    mainVisited = useRef(initialTab !== 'Texts');
  const [tab, setTab] = useState(initialTab),
    [query, setQuery] = useState(''),
    [context, setContext] = useState(''),
    [entry, setEntry] = useState<Entry | null>(null),
    [searching, setSearching] = useState(false),
    [error, setError] = useState(''),
    [items, setItems] = useState<Material[]>(
      () => clientData.peek('/api/materials?kind=phrase&summary=true&archived=false') || [],
    ),
    [filter, setFilter] = useState(''),
    [detailsId, setDetailsId] = useState<string | null>(null),
    [visibleCount, setVisibleCount] = useState(50),
    [archived, setArchived] = useState(false),
    [connectionError, setConnectionError] = useState(''),
    [settings, setSettings] = useState<Preferences>(defaultPreferences),
    [keyConfigured, setKeyConfigured] = useState(false),
    [apiKey, setApiKey] = useState(''),
    [settingsBusy, setSettingsBusy] = useState(false),
    [keyMessage, setKeyMessage] = useState(''),
    [notice, setNotice] = useState(''),
    [saving, setSaving] = useState(false),
    [addPractice, setAddPractice] = useState<PracticeMode>('words'),
    [editing, setEditing] = useState<Material | null>(null),
    [form, setForm] = useState(false),
    [editTitle, setEditTitle] = useState(''),
    [editMeaning, setEditMeaning] = useState(''),
    [editExample, setEditExample] = useState(''),
    [editNotes, setEditNotes] = useState(''),
    [editSource, setEditSource] = useState(''),
    [editPractice, setEditPractice] = useState<PracticeMode>('off'),
    [audioState, setAudioState] = useState('idle'),
    [currentAudio, setCurrentAudio] = useState('');
  const [suggestions, setSuggestions] = useState<{ word: string; meaning: string; pos: string }[]>(
      [],
    ),
    [suggestOpen, setSuggestOpen] = useState(false),
    [aiEntry, setAiEntry] = useState<Entry | null>(null),
    [aiBusy, setAiBusy] = useState(false),
    [aiError, setAiError] = useState(''),
    [translating, setTranslating] = useState(false),
    [translationError, setTranslationError] = useState('');
  const [formTranslation, setFormTranslation] = useState<FormTranslation | null>(null),
    [formBusy, setFormBusy] = useState(false),
    [formError, setFormError] = useState('');
  const formRequest = useRef<AbortController | null>(null),
    loadGeneration = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null),
    player = useRef<HTMLAudioElement>(null),
    engine = useRef<AudioSequence | null>(null),
    searchGeneration = useRef(0),
    aiController = useRef<AbortController | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    dialog = useRef<HTMLDivElement>(null);
  function notify(message: string) {
    setNotice(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(''), 6000);
  }
  async function load(force = true) {
    const generation = ++loadGeneration.current;
    const path = '/api/materials?kind=phrase&summary=true&archived=' + archived;
    const cached = clientData.peek<Material[]>(path);
    if (cached) setItems(cached);
    else setItems([]);
    setCollectionLoading(!cached);
    await Promise.allSettled([
      readJson<Material[]>(path, force)
        .then((values) => {
          if (generation !== loadGeneration.current) return;
          setItems(values);
          setCollectionLoading(false);
          setConnectionError('');
        })
        .catch((e) => {
          if (generation !== loadGeneration.current) return;
          setCollectionLoading(false);
          setConnectionError(e.message);
        }),
      readJson('/api/settings', force)
        .then((value) => {
          engine.current?.setCacheScope(value.audioCacheScope || '');
          setAudioScope(value.audioCacheScope || '');
          setKeyConfigured(value.keyConfigured);
          setAudioConfigured(value.audioReady);
          setSettings(value.preferences);
        })
        .catch((e) => setConnectionError(e.message)),
    ]);
  }

  useEffect(() => {
    const selected = new URLSearchParams(window.location.search).get('tab');
    if (selected && ['Search', 'Collection', 'Practice', 'Settings'].includes(selected))
      setTab(selected);
    try {
      const saved = JSON.parse(sessionStorage.getItem('dutch-search-view') || 'null');
      if (saved) {
        setQuery(typeof saved.query === 'string' ? saved.query : '');
        setContext(typeof saved.context === 'string' ? saved.context : '');
        if (saved.formTranslation?.found && typeof saved.formTranslation.english === 'string')
          setFormTranslation(saved.formTranslation);
        if (
          saved.entry?.lemma &&
          Array.isArray(saved.entry.senses) &&
          Array.isArray(saved.entry.forms)
        )
          setEntry(saved.entry);
      }
    } catch {}
  }, []);
  useEffect(() => {
    const back = () => {
      const selected =
        window.location.pathname === '/texts'
          ? 'Texts'
          : new URLSearchParams(window.location.search).get('tab') || 'Search';
      if (selected === 'Texts') setTextsVisited(true);
      setDetailsId(null);
      setTab(selected);
      engine.current?.stop();
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  useEffect(() => {
    const save = () => {
      try {
        sessionStorage.setItem(
          'dutch-search-view',
          JSON.stringify({ query, context, entry, formTranslation }),
        );
      } catch {}
    };
    window.addEventListener('pagehide', save);
    return () => {
      save();
      window.removeEventListener('pagehide', save);
    };
  }, [query, context, entry, formTranslation]);
  useEffect(() => {
    if (!mainVisited.current) return;
    void load(false);
    setVisibleCount(50);
    setDetailsId(null);
  }, [archived]);
  useEffect(() => {
    if (tab !== 'Texts' && !mainVisited.current) {
      mainVisited.current = true;
      void load(false);
    }
  }, [tab]);
  useEffect(() => {
    if (tab === 'Practice') setPracticeVisited(true);
  }, [tab]);
  useEffect(() => {
    const refresh = () => {
      if (tab === 'Collection') void load(true);
      else void readJson('/api/settings', true).catch(() => {});
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [archived, tab]);
  useEffect(() => setVisibleCount(50), [filter]);
  useEffect(() => {
    if (player.current)
      engine.current = new AudioSequence(
        player.current,
        (_index, state) => setAudioState(state),
        notify,
      );
    return () => {
      engine.current?.dispose();
      aiController.current?.abort();
      formRequest.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (!form) return;
    const previous = document.activeElement as HTMLElement;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLElement>('button,input')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setForm(false);
      if (e.key === 'Tab') {
        const controls = Array.from(
            dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input,textarea,select',
            ) || [],
          ),
          first = controls[0],
          last = controls.at(-1);
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
      document.body.style.overflow = '';
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, [form]);
  function navigate(next: string) {
    setDetailsId(null);
    if (tab === 'Texts') textsUrl.current = window.location.pathname + window.location.search;
    if (next === 'Texts') setTextsVisited(true);
    formRequest.current?.abort();
    setFormBusy(false);
    aiController.current?.abort();
    ++searchGeneration.current;
    setSearching(false);
    setAiBusy(false);
    setTranslating(false);
    engine.current?.stop();
    if (next !== 'Collection') setArchived(false);
    setTab(next);
    const url = next === 'Texts' ? textsUrl.current : '/?tab=' + encodeURIComponent(next);
    window.history.pushState(null, '', url);
    setKeyMessage('');
    if (next === 'Collection') void load(false);
  }
  useEffect(() => {
    if (!suggestOpen || !query.trim()) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      suggest(query)
        .then((r) => {
          if (!cancelled) setSuggestions(r);
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        });
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, suggestOpen]);
  async function enrich(base: Entry, n: number, next: string) {
    if (!keyConfigured || settings.aiEnrichment === 'off') return;
    aiController.current?.abort();
    const controller = new AbortController();
    aiController.current = controller;
    setAiBusy(true);
    setAiError('');
    try {
      const result = await api(
        '/api/lookup',
        { query: next, context, evidence: base },
        undefined,
        controller.signal,
      );
      if (n === searchGeneration.current && !controller.signal.aborted) setAiEntry(result);
    } catch (e) {
      if (n === searchGeneration.current && !controller.signal.aborted)
        setAiError((e as Error).message);
    } finally {
      if (n === searchGeneration.current && !controller.signal.aborted) setAiBusy(false);
    }
  }
  async function translateMissing(next: string, n: number) {
    aiController.current?.abort();
    const controller = new AbortController();
    aiController.current = controller;
    setTranslating(true);
    setTranslationError('');
    try {
      const result = await api(
        '/api/lookup',
        { query: next, context, mode: 'translate' },
        undefined,
        controller.signal,
      );
      if (n === searchGeneration.current && !controller.signal.aborted) setEntry(result);
    } catch (e) {
      if (n === searchGeneration.current && !controller.signal.aborted)
        setTranslationError((e as Error).message);
    } finally {
      if (n === searchGeneration.current && !controller.signal.aborted) setTranslating(false);
    }
  }
  async function translateSearchForm(base: Entry, n = searchGeneration.current) {
    if (!base.queryForm) return;
    formRequest.current?.abort();
    const controller = new AbortController();
    formRequest.current = controller;
    setFormBusy(true);
    setFormError('');
    try {
      const result = await api(
        '/api/lookup',
        { mode: 'search-form', query: base.queryForm.text, context, lemma: base.lemma },
        undefined,
        controller.signal,
      );
      if (n === searchGeneration.current && !controller.signal.aborted) {
        setFormTranslation(result);
        if (!result.found) setFormError('This form needs a sentence for a clearer translation.');
      }
    } catch (e) {
      if (n === searchGeneration.current && !controller.signal.aborted)
        setFormError((e as Error).message);
    } finally {
      if (n === searchGeneration.current && !controller.signal.aborted) setFormBusy(false);
    }
  }
  async function search(next = query) {
    formRequest.current?.abort();
    setFormTranslation(null);
    setFormBusy(false);
    setFormError('');
    aiController.current?.abort();
    const n = ++searchGeneration.current;
    setSuggestOpen(false);
    setSuggestions([]);
    setQuery(next);
    setSearching(true);
    setError('');
    setEntry(null);
    setAiEntry(null);
    setAiBusy(false);
    setAiError('');
    setTranslating(false);
    setTranslationError('');
    engine.current?.stop();
    try {
      const result = await localLookup(next);
      if (n !== searchGeneration.current) return;
      setEntry(result);
      setSearching(false);
      if (!result.found) {
        if (keyConfigured && settings.aiEnrichment !== 'off') void translateMissing(next, n);
      } else if (settings.aiEnrichment === 'auto') {
        if (result.queryForm && keyConfigured) void translateSearchForm(result, n);
        else void enrich(result, n, next);
      }
    } catch (e) {
      if (n === searchGeneration.current) {
        setError((e as Error).message);
        setSearching(false);
      }
    }
  }
  function speak(text: string) {
    if (!audioConfigured) {
      notify('Connect ElevenLabs and choose a voice in Settings.');
      return;
    }
    if (!engine.current) {
      notify('Audio is not ready. Please try again.');
      return;
    }
    if (currentAudio === text && audioState === 'loading') {
      engine.current.stop();
      return;
    }
    if (currentAudio === text && audioState === 'playing') {
      engine.current?.pause();
      return;
    }
    if (currentAudio === text && audioState === 'paused') {
      engine.current?.resume();
      return;
    }
    setCurrentAudio(text);
    engine.current?.start([text], -1);
  }
  function clearSearch() {
    formRequest.current?.abort();
    aiController.current?.abort();
    ++searchGeneration.current;
    engine.current?.stop();
    setQuery('');
    setContext('');
    setEntry(null);
    setAiEntry(null);
    setFormTranslation(null);
    setSearching(false);
    setFormBusy(false);
    setFormError('');
    setError('');
    setAiBusy(false);
    setAiError('');
    setTranslating(false);
    setTranslationError('');
    setSuggestions([]);
    setSuggestOpen(false);
    try {
      sessionStorage.removeItem('dutch-search-view');
    } catch {}
    searchInput.current?.focus();
  }
  function audioButton(text: string, label = 'Listen') {
    return (
      <button type="button" className="icon-button" aria-label={label} onClick={() => speak(text)}>
        {currentAudio === text && audioState === 'loading' ? (
          <LoaderCircle size={19} className="spin" />
        ) : currentAudio === text && audioState === 'playing' ? (
          <Pause size={19} />
        ) : (
          <Volume2 size={19} />
        )}
      </button>
    );
  }
  async function saveSense(sense: any, sourceEntry: Entry | null = entry) {
    if (!sourceEntry) return;
    setSaving(true);
    try {
      const material = searchMeaningMaterial(
        sourceEntry,
        sense,
        sourceEntry === entry ? formTranslation : null,
        context,
      );
      const practice = addPractice !== 'off' && !!material.body.en;
      material.body = {
        ...material.body,
        practiceMode: practice ? addPractice : 'off',
      } as typeof material.body;
      const result = await api('/api/materials', { ...material, practice });
      notify(
        result.duplicate
          ? 'Already in your collection.'
          : !material.body.en
            ? 'Saved this form. Add an English meaning to practise it.'
            : 'Saved' + (practice ? ' and added to practice.' : '.'),
      );
      await load();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function openEditor(item?: Material) {
    setEditing(item || null);
    setEditTitle(item?.title || '');
    setEditMeaning(item?.body.en || '');
    setEditExample(item?.body.example || '');
    setEditNotes(item?.body.notes || '');
    setEditSource(item?.body.source || '');
    setEditPractice(item ? practiceMode(item) : 'off');
    setForm(true);
  }
  async function saveEdited(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        ...(editing?.body || {}),
        ...(editing && editTitle !== editing.title
          ? {
              article: '',
              lemma: '',
              partOfSpeech: '',
              formLabel: '',
              selectedForm: editTitle,
              forms: [],
              dictionarySnapshot: null,
            }
          : {}),
        en: editMeaning,
        example: editExample,
        notes: editNotes,
        source: editSource,
        practiceMode: editPractice,
      };
      await api(
        '/api/materials',
        editing
          ? {
              id: editing.id,
              version: editing.version,
              title: editTitle,
              body,
              practice: editPractice !== 'off',
            }
          : { kind: 'phrase', title: editTitle, body, practice: editPractice !== 'off' },
        editing ? 'PATCH' : 'POST',
      );
      setForm(false);
      await load();
      notify('Saved.');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function update(item: Material, change: any) {
    try {
      await api('/api/materials', { id: item.id, version: item.version, ...change }, 'PATCH');
      await load();
      notify(change.archived ? 'Archived. You can restore it from Archive.' : 'Updated.');
    } catch (e) {
      notify((e as Error).message);
      load();
    }
  }
  async function saveKey(action: string) {
    setSettingsBusy(true);
    setKeyMessage('');
    try {
      const result = await api('/api/settings', { action, apiKey, preferences: settings });
      setKeyMessage(result.message || 'Preferences saved.');
      if (result.audioCacheScope) engine.current?.setCacheScope(result.audioCacheScope);
      if (action === 'saveKey') {
        setApiKey('');
        setKeyConfigured(true);
        engine.current?.clearCache();
      }
      if (action === 'savePreferences') {
        engine.current?.clearCache();
        notify('Preferences saved.');
      }
    } catch (e) {
      setKeyMessage((e as Error).message);
    } finally {
      setSettingsBusy(false);
    }
  }
  async function removeKey() {
    setSettingsBusy(true);
    try {
      await api('/api/settings', undefined, 'DELETE');
      setKeyConfigured(false);
      setApiKey('');
      engine.current?.stop();
      setKeyMessage('Saved key removed. Your OpenAI key itself is not revoked.');
    } catch (e) {
      setKeyMessage((e as Error).message);
    } finally {
      setSettingsBusy(false);
    }
  }

  const detailItem = items.find((x) => x.id === detailsId);
  const collection = useMemo(
    () =>
      items
        .filter((x) => x.kind === 'phrase')
        .filter((x) =>
          (x.title + ' ' + JSON.stringify(x.body)).toLowerCase().includes(filter.toLowerCase()),
        ),
    [items, filter],
  );
  return (
    <>
      <div className="app" hidden={tab === 'Texts'}>
        <audio ref={player} preload="auto" />
        <AppHeader active={tab} onNavigate={navigate} />
        <main className="dictionary-main">
          {connectionError && (
            <div className="alert" role="alert">
              {connectionError}
              <button onClick={() => void load()}>Try again</button>
            </div>
          )}
          {tab === 'Search' && (
            <>
              <div className="search-heading">
                <span className="eyebrow">YOUR EVERYDAY DUTCH</span>
                <h1>
                  A word. A phrase.
                  <br />A little more Dutch.
                </h1>
              </div>
              <form
                className="dictionary-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (query.trim()) search();
                }}
              >
                <Search size={22} />
                <input
                  ref={searchInput}
                  aria-label="Search Dutch words or phrases"
                  placeholder="Search a Dutch word or phrase…"
                  value={query}
                  maxLength={240}
                  onFocus={() => setSuggestOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setSuggestOpen(false);
                  }}
                  onChange={(e) => {
                    formRequest.current?.abort();
                    setFormTranslation(null);
                    setFormBusy(false);
                    setFormError('');
                    setQuery(e.target.value);
                    setSuggestOpen(true);
                    setSuggestions([]);
                    ++searchGeneration.current;
                    aiController.current?.abort();
                    setSearching(false);
                    setEntry(null);
                    setAiEntry(null);
                    setAiError('');
                    setAiBusy(false);
                    setTranslating(false);
                    setTranslationError('');
                  }}
                />
                <button
                  type="button"
                  className="clear-search icon-button"
                  aria-label="Clear search"
                  disabled={!query && !context}
                  onClick={clearSearch}
                >
                  <X size={19} />
                </button>
                <button
                  className="search-submit"
                  disabled={searching || !query.trim()}
                  aria-label="Search"
                >
                  {searching ? (
                    <LoaderCircle size={20} className="spin" />
                  ) : (
                    <ArrowRight size={21} />
                  )}
                </button>
              </form>
              {suggestOpen && suggestions.length > 0 && (
                <div className="word-suggestions" aria-label="Suggested Dutch words">
                  {suggestions.map((x) => (
                    <button
                      key={x.word}
                      aria-label={x.word + ' — ' + x.meaning}
                      type="button"
                      onClick={() => search(x.word)}
                    >
                      <b lang="nl">{x.word}</b>
                      <span>{x.meaning}</span>
                    </button>
                  ))}
                </div>
              )}
              <details className="search-context">
                <summary>
                  Add a sentence for context <ChevronDown size={13} />
                </summary>
                <textarea
                  aria-label="Dutch sentence for context"
                  placeholder="Optional: paste the sentence where you found it."
                  maxLength={1500}
                  value={context}
                  onChange={(e) => {
                    formRequest.current?.abort();
                    setFormTranslation(null);
                    setFormBusy(false);
                    setFormError('');
                    setContext(e.target.value);
                  }}
                />
              </details>
              {!keyConfigured && !connectionError && (
                <div className="connect-prompt">
                  <KeyRound size={16} />
                  <span>Connect OpenAI for phrase translations and explanations.</span>
                  <button onClick={() => navigate('Settings')}>
                    Set up <ArrowRight size={14} />
                  </button>
                </div>
              )}
              {error && (
                <div className="alert" role="alert">
                  {error}
                </div>
              )}
              {searching && (
                <div className="lookup-loading">
                  <LoaderCircle size={23} className="spin" />
                  <p>Looking up your Dutch…</p>
                </div>
              )}
              {entry && (
                <section className="dictionary-entry">
                  <div className="entry-header">
                    <div>
                      <div className="entry-type">
                        {entry.queryForm?.partOfSpeech || entry.partOfSpeech || 'Dutch'}{' '}
                        {(entry.queryForm ? entry.queryForm.ipa : entry.ipa) && (
                          <span>{entry.queryForm ? entry.queryForm.ipa : entry.ipa}</span>
                        )}
                      </div>
                      <h2>
                        <NounTitle
                          title={entry.queryForm?.text || entry.lemma}
                          body={{
                            article: entry.queryForm
                              ? nounArticle(entry.queryForm.text, entry, formTranslation?.baseForm)
                              : entry.article,
                          }}
                        />
                      </h2>
                    </div>
                    {audioButton(
                      entry.queryForm?.text ||
                        (entry.article ? entry.article + ' ' : '') + entry.lemma,
                      'Listen to Dutch word',
                    )}
                  </div>
                  {entry.queryForm && (
                    <div className="base-form-link">
                      <span>{entry.queryForm.label} · </span>Base form{' '}
                      <button onClick={() => search(entry.lemma)}>{entry.lemma} ↗</button>
                    </div>
                  )}
                  {entry.queryForm && (
                    <p className="form-base-meaning">
                      Base meaning:{' '}
                      {entry.senses
                        .map((s) => s.meaning)
                        .slice(0, 2)
                        .join('; ')}
                    </p>
                  )}
                  {entry.queryForm && (
                    <div className="search-form-status">
                      {formBusy ? (
                        <p role="status">
                          <LoaderCircle size={14} className="spin" /> Translating this form…
                        </p>
                      ) : (
                        !formTranslation?.found && (
                          <>
                            <p>
                              {formError ||
                                'The dictionary identifies this form. Its English translation can be added separately.'}
                            </p>
                            {keyConfigured ? (
                              <button
                                className="text-action"
                                onClick={() => translateSearchForm(entry)}
                              >
                                Translate this form
                              </button>
                            ) : (
                              <button className="text-action" onClick={() => navigate('Settings')}>
                                Connect OpenAI for a translation
                              </button>
                            )}
                          </>
                        )
                      )}
                      {formTranslation?.found && (
                        <small>OpenAI translation · {formTranslation.formLabel}</small>
                      )}
                    </div>
                  )}
                  {!entry.queryForm && entry.queryExplanation && (
                    <p className="query-explanation">{entry.queryExplanation}</p>
                  )}
                  {!entry.found ? (
                    <p className="unknown">
                      {translating
                        ? 'Translating Dutch → English…'
                        : entry.notes || 'This is not in the dictionary.'}
                      {translating && <LoaderCircle size={18} className="spin" />}
                      {!translating && (
                        <>
                          {translationError && <span role="status"> {translationError}</span>}
                          {keyConfigured ? (
                            <button
                              className="text-action"
                              onClick={() => translateMissing(query, searchGeneration.current)}
                            >
                              Translate with OpenAI
                            </button>
                          ) : (
                            <button className="text-action" onClick={() => navigate('Settings')}>
                              Connect OpenAI to translate this phrase
                            </button>
                          )}
                        </>
                      )}
                    </p>
                  ) : (
                    <>
                      <div className="save-preference">
                        <PracticeModeSelect
                          value={addPractice}
                          onChange={setAddPractice}
                          hasMeaning={!entry.queryForm || !!formTranslation?.found}
                        />
                      </div>
                      <div className="meanings">
                        {(entry.queryForm
                          ? formTranslation?.found
                            ? [
                                {
                                  meaning: formTranslation.english,
                                  usage: formTranslation.formLabel,
                                  example: '',
                                  exampleTranslation: '',
                                },
                              ]
                            : entry.queryForm.senses
                          : entry.senses
                        ).map((sense, i) => (
                          <article className="meaning" key={i}>
                            <span className="meaning-number">{String(i + 1).padStart(2, '0')}</span>
                            <div className="meaning-body">
                              <h3>{sense.meaning}</h3>
                              {sense.usage && <small>{sense.usage}</small>}
                              {sense.example && (
                                <div className="dictionary-example">
                                  <div>
                                    <p lang="nl">{sense.example}</p>
                                    <span>{sense.exampleTranslation}</span>
                                  </div>
                                  {audioButton(sense.example, 'Listen to example ' + (i + 1))}
                                </div>
                              )}
                            </div>
                            <button
                              className="icon-button save-meaning"
                              aria-label={
                                entry.queryForm ? 'Save this form' : 'Save meaning ' + (i + 1)
                              }
                              disabled={saving}
                              onClick={() => saveSense(sense)}
                            >
                              <Bookmark size={18} />
                            </button>
                          </article>
                        ))}
                      </div>
                      {entry.forms.length > 0 && (
                        <details className="entry-details" open>
                          <summary>
                            Forms <ChevronDown size={15} />
                          </summary>
                          <WordForms
                            forms={entry.forms}
                            partOfSpeech={entry.partOfSpeech}
                            lemma={entry.lemma}
                            article={entry.article}
                            selectedForm={entry.queryForm?.text || entry.lemma}
                            onSpeak={speak}
                            currentAudio={currentAudio}
                            audioState={audioState}
                          />
                        </details>
                      )}
                      {entry.related.length > 0 && (
                        <details className="entry-details">
                          <summary>
                            Related words <ChevronDown size={15} />
                          </summary>
                          <div className="related-words">
                            {entry.related.map((r, i) => (
                              <button key={i} onClick={() => search(r.word)}>
                                <b lang="nl">{r.word}</b>
                                {r.meaning && <small>{r.meaning}</small>}
                              </button>
                            ))}
                          </div>
                        </details>
                      )}
                      {entry.notes && <p className="entry-notes">{entry.notes}</p>}
                    </>
                  )}
                  {entry.found && (
                    <footer className="entry-source">
                      <span>
                        {entry.source}
                        {entry.cached ? ' · cached' : ''}
                      </span>
                      {entry.sourceUrl && (
                        <a href={entry.sourceUrl} target="_blank" rel="noreferrer">
                          Dictionary source ↗
                        </a>
                      )}
                    </footer>
                  )}
                  {entry.source?.includes('AI') && (
                    <p className="entry-disclaimer">
                      Examples and explanations include AI-generated content. Check important
                      details and edit saved entries when needed.
                    </p>
                  )}
                </section>
              )}
              {entry &&
                !entry.queryForm &&
                entry.found &&
                keyConfigured &&
                settings.aiEnrichment !== 'off' &&
                entry.source !== 'OpenAI translation' && (
                  <section className="ai-addition">
                    <div className="ai-heading">
                      <h3>AI explanation</h3>
                      {!aiBusy && (
                        <button
                          className="text-action"
                          onClick={() => enrich(entry, searchGeneration.current, query)}
                        >
                          {aiEntry ? 'Refresh' : 'Explain with AI'}
                        </button>
                      )}
                    </div>
                    {aiBusy && (
                      <div role="status" className="ai-skeleton">
                        <span />
                        <span />
                        <small>Adding an explanation… Your dictionary entry is ready to use.</small>
                      </div>
                    )}
                    {aiError && (
                      <p role="status">{aiError} Your dictionary result is still available.</p>
                    )}
                    {aiEntry && (
                      <>
                        <p className="entry-disclaimer">
                          AI-generated · separate from the dictionary
                        </p>
                        {aiEntry.queryExplanation && <p>{aiEntry.queryExplanation}</p>}
                        {aiEntry.senses.map((sense, i) => (
                          <article className="meaning" key={i}>
                            <div className="meaning-body">
                              <h3>{sense.meaning}</h3>
                              {sense.usage && <small>{sense.usage}</small>}
                              {sense.example && (
                                <div className="dictionary-example">
                                  <div>
                                    <p lang="nl">{sense.example}</p>
                                    <span>{sense.exampleTranslation}</span>
                                  </div>
                                  {audioButton(sense.example)}
                                </div>
                              )}
                            </div>
                            <button
                              className="icon-button"
                              aria-label={'Save AI meaning ' + (i + 1)}
                              disabled={saving}
                              onClick={() => saveSense(sense, aiEntry)}
                            >
                              <Bookmark size={18} />
                            </button>
                          </article>
                        ))}
                        {aiEntry.forms.length > 0 && (
                          <details className="entry-details" open>
                            <summary>
                              Additional forms <ChevronDown size={15} />
                            </summary>
                            <WordForms
                              forms={aiEntry.forms}
                              partOfSpeech={aiEntry.partOfSpeech}
                              lemma={aiEntry.lemma}
                              article={aiEntry.article}
                              selectedForm={entry.lemma}
                              onSpeak={speak}
                              currentAudio={currentAudio}
                              audioState={audioState}
                            />
                          </details>
                        )}
                        {aiEntry.notes && <p>{aiEntry.notes}</p>}
                      </>
                    )}
                  </section>
                )}
              {!entry && !searching && !error && (
                <div className="search-suggestions">
                  <span>Try</span>
                  {['opgebeld', 'gezellig', 'dat valt mee'].map((w) => (
                    <button key={w} onClick={() => search(w)}>
                      {w}
                    </button>
                  ))}
                </div>
              )}
              <div className="dictionary-attribution">
                Dictionary evidence from{' '}
                <a href="https://kaikki.org/dictionary/Dutch/" target="_blank" rel="noreferrer">
                  Kaikki / Wiktionary
                </a>{' '}
                ·{' '}
                <a
                  href="https://en.wiktionary.org/wiki/Wiktionary:Copyrights"
                  target="_blank"
                  rel="noreferrer"
                >
                  source licences
                </a>
              </div>
            </>
          )}
          {tab === 'Collection' && (
            <>
              <div className="section-heading">
                <div>
                  <span className="eyebrow">YOUR LIBRARY</span>
                  <h1>{archived ? 'Archive' : 'Collection'}</h1>
                  <p>Useful words. Your meanings. Your examples.</p>
                </div>
                <button className="primary" onClick={() => openEditor()}>
                  <Plus size={17} />
                  Add
                </button>
              </div>
              <label className="search">
                <Search size={18} />
                <input
                  aria-label="Find in collection"
                  placeholder="Find a word or meaning…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </label>
              <div className="collection-tools">
                <button onClick={() => setArchived(!archived)}>
                  <Archive size={14} />
                  {archived ? 'Back to collection' : 'Archive'}
                </button>
                <BackupControls onMessage={notify} onImported={() => void load()} />
                <span>{collection.length} entries</span>
              </div>
              <div className="saved-list">
                {collectionLoading && !collection.length && (
                  <div className="lookup-loading" role="status">
                    <LoaderCircle className="spin" />
                    <p>Loading your collection…</p>
                  </div>
                )}
                {!collectionLoading && !collection.length && (
                  <div className="empty">
                    <span className="empty-icon">
                      <Bookmark size={26} />
                    </span>
                    <h2>{filter ? 'No results' : 'Your collection starts here.'}</h2>
                    <p>Save a meaning from Search or add a phrase from your lesson.</p>
                    <button className="secondary" onClick={() => navigate('Search')}>
                      Find a word <ArrowRight size={15} />
                    </button>
                  </div>
                )}
                {collection.slice(0, visibleCount).map((item) => (
                  <article className="collection-row" key={item.id}>
                    <div className="collection-row-main">
                      {audioButton(item.title, 'Listen to ' + item.title)}
                      <button
                        className="collection-term"
                        aria-haspopup="dialog"
                        aria-label={'Details for ' + item.title}
                        onClick={() => setDetailsId(item.id)}
                      >
                        <strong lang="nl">
                          <NounTitle title={item.title} body={item.body} infer />
                        </strong>
                        <span>{item.body.en || 'English meaning not added yet.'}</span>
                      </button>
                      {item.body.example && (
                        <p className="collection-example" lang="nl">
                          {item.body.example}
                        </p>
                      )}
                      <div className="collection-learning">
                        <PracticeBadge mode={practiceMode(item)} />
                        {practiceMode(item) === 'words' && (
                          <LearningProgress progress={item.learning} showDue />
                        )}
                      </div>
                      <button
                        className="icon-button row-expand"
                        aria-haspopup="dialog"
                        aria-label={'Details for ' + item.title}
                        onClick={() => setDetailsId(item.id)}
                      >
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  </article>
                ))}
                {collection.length > visibleCount && (
                  <button
                    className="secondary show-more-entries"
                    onClick={() => setVisibleCount((n) => n + 50)}
                  >
                    Show {Math.min(50, collection.length - visibleCount)} more · {visibleCount} of{' '}
                    {collection.length}
                  </button>
                )}
              </div>
            </>
          )}
          {(practiceVisited || tab === 'Practice') && (
            <div hidden={tab !== 'Practice'}>
              <Practice
                visible={tab === 'Practice'}
                onCollection={() => navigate('Collection')}
                onChanged={() => void load()}
                onSpeak={speak}
                audioReady={audioConfigured}
                audioScope={audioScope}
              />
            </div>
          )}
          {tab === 'Settings' && (
            <>
              <div className="section-heading">
                <div>
                  <span className="eyebrow">MAKE IT SOUND RIGHT</span>
                  <h1>Settings</h1>
                  <p>Translation and Dutch audio settings.</p>
                </div>
              </div>
              <section className="settings-card">
                <div className="settings-title">
                  <KeyRound size={20} />
                  <h2>OpenAI API key</h2>
                  <span
                    className={keyConfigured ? 'connection-badge connected' : 'connection-badge'}
                  >
                    {keyConfigured ? 'Saved' : 'Not connected'}
                  </span>
                </div>
                <p className="settings-copy">
                  Your key is encrypted on the server, scoped to your account and never returned to
                  this page. API usage is billed to your OpenAI project.
                </p>
                <label>
                  API key
                  <input
                    type="password"
                    aria-label="OpenAI API key"
                    autoComplete="off"
                    spellCheck={false}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={keyConfigured ? 'Enter a replacement key…' : 'sk-…'}
                  />
                </label>
                <div className="key-actions">
                  <button
                    className="primary"
                    disabled={settingsBusy || !apiKey.trim()}
                    onClick={() => saveKey('saveKey')}
                  >
                    {settingsBusy ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <ShieldCheck size={16} />
                    )}
                    Verify & save key
                  </button>
                  {keyConfigured && (
                    <button
                      className="secondary"
                      disabled={settingsBusy}
                      onClick={() => saveKey('testKey')}
                    >
                      Test saved key
                    </button>
                  )}
                </div>
                <p className="sheet-footnote">
                  Verification sends a small real request to the selected text model. Audio access
                  is checked separately below.
                </p>
                {keyMessage && (
                  <div className="settings-result" role="status">
                    {keyMessage}
                  </div>
                )}
                {keyConfigured && (
                  <details className="remove-key">
                    <summary>Manage saved key</summary>
                    <button className="text-action" disabled={settingsBusy} onClick={removeKey}>
                      Remove key from this app
                    </button>
                  </details>
                )}
              </section>
              <section className="settings-card">
                <h2>Dictionary search</h2>
                <label>
                  OpenAI explanations
                  <select
                    value={settings.aiEnrichment}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        aiEnrichment: e.target.value as Preferences['aiEnrichment'],
                      })
                    }
                  >
                    <option value="auto">Automatically after choosing a word</option>
                    <option value="manual">Only when I ask</option>
                    <option value="off">Off — no automatic AI</option>
                  </select>
                </label>
                <p className="settings-copy">
                  Dictionary results appear first. AI explanations load separately and never replace
                  them. If no dictionary entry exists, a short OpenAI translation appears instead.
                  Off disables automatic translation too; you can still request it with a button.
                  API usage uses your OpenAI credit.
                </p>
                <button
                  className="primary"
                  disabled={settingsBusy}
                  onClick={() => saveKey('savePreferences')}
                >
                  Save preferences
                </button>
              </section>
              <section className="settings-card">
                <h2>Translation models</h2>
                <label>
                  Text model
                  <select
                    value={settings.textModel}
                    onChange={(e) => setSettings({ ...settings, textModel: e.target.value })}
                  >
                    {['gpt-6-luna', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini'].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Translation model
                  <select
                    value={settings.translationModel}
                    onChange={(e) => setSettings({ ...settings, translationModel: e.target.value })}
                  >
                    <option value="same">Same as text model</option>
                    {['gpt-6-luna', 'gpt-4.1-mini', 'gpt-4o-mini'].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <button
                  className="primary"
                  onClick={() => saveKey('savePreferences')}
                  disabled={settingsBusy}
                >
                  Save preferences
                </button>
              </section>
              <WordsSettings onSaved={(words) => setSettings((s) => ({ ...s, words }))} />
              <SentencesSettings
                onSaved={(sentences) => setSettings((s) => ({ ...s, sentences }))}
              />
              <SpeechSettings onChanged={() => void load()} />
            </>
          )}
        </main>
        {detailItem && (
          <CollectionDetails
            key={detailItem.id}
            item={detailItem}
            onClose={() => setDetailsId(null)}
            onSpeak={speak}
            currentAudio={currentAudio}
            audioState={audioState}
            onEdit={(selected) => {
              setDetailsId(null);
              openEditor(selected);
            }}
            onArchive={(selected) => {
              setDetailsId(null);
              void update(selected, { archived: !selected.body._archived });
            }}
            onSearch={(value) => {
              setDetailsId(null);
              navigate('Search');
              void search(value);
            }}
            onReset={async () => {
              await load();
              notify('Progress reset to New.');
            }}
            onSaveDetails={async (snapshot, selected) => {
              await api(
                '/api/materials',
                {
                  id: selected.id,
                  version: selected.version,
                  body: { dictionarySnapshot: snapshot },
                },
                'PATCH',
              );
              await load();
              notify('Dictionary details saved.');
            }}
          />
        )}
        {form && (
          <div className="overlay" onClick={() => setForm(false)}>
            <div
              className="sheet form-sheet"
              role="dialog"
              aria-modal="true"
              aria-label={editing ? 'Edit entry' : 'Add entry'}
              ref={dialog}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="close icon-button"
                aria-label="Close"
                onClick={() => setForm(false)}
              >
                <X size={20} />
              </button>
              <form onSubmit={saveEdited}>
                <span className="sheet-label">YOUR COLLECTION</span>
                <h2>{editing ? 'Edit entry' : 'Add an entry'}</h2>
                <label>
                  Dutch word or phrase
                  <input
                    required
                    maxLength={500}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                </label>
                <label>
                  English meaning
                  <textarea value={editMeaning} onChange={(e) => setEditMeaning(e.target.value)} />
                </label>
                <label>
                  Dutch example
                  <input value={editExample} onChange={(e) => setEditExample(e.target.value)} />
                </label>
                <label>
                  Source
                  <input
                    value={editSource}
                    onChange={(e) => setEditSource(e.target.value)}
                    placeholder="Teacher, lesson, conversation…"
                    maxLength={500}
                  />
                </label>
                <label>
                  Notes
                  <textarea
                    className="short"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                  />
                </label>
                <PracticeModeSelect
                  value={editPractice}
                  onChange={setEditPractice}
                  hasMeaning={!!editMeaning.trim()}
                />
                <button className="primary wide" disabled={saving}>
                  <Check size={16} />
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </form>
            </div>
          </div>
        )}
        {notice && (
          <div className="toast" role="status">
            {notice}
            <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
              <X size={15} />
            </button>
          </div>
        )}
      </div>
      {textsVisited && (
        <div hidden={tab !== 'Texts'}>
          <TextsReader visible={tab === 'Texts'} onNavigate={navigate} />
        </div>
      )}
    </>
  );
}
