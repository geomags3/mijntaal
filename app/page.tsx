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
import { localCandidates, localLookup, suggest } from '../lib/local-dictionary';
import { nounArticle } from '../lib/noun-article';
import { practiceMode, PracticeMode } from '../lib/practice-mode';
import { FormTranslation, searchMeaningMaterial } from '../lib/search-form';
import { defaultSentencePreferences, SentencePreferences } from '../lib/sentences';
import type { Entry } from '../lib/server/dictionary';
import type { LearningProgress as Learning } from '../lib/word-progress';
import { defaultWordPreferences, WordPreferences } from '../lib/words';
import AppHeader from './components/app-header';
import BackupControls from './components/backup-controls';
import AzureSettings from './components/azure-settings';
import CollectionDetails from './components/collection-details';
import LearningProgress from './components/learning-progress';
import ConnectionHeading from './components/connection-heading';
import LiveTranslation, { type LiveTranslationResult } from './components/live-translation';
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
    [selectedEntry, setEntry] = useState<Entry | null>(null),
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
  const [searchLanguage, setSearchLanguage] = useState<'nl' | 'en' | 'ru'>('nl');
  const [candidates, setCandidates] = useState<Entry[]>([]);
  const [azureConfigured, setAzureConfigured] = useState(false);
  const [azureRegion, setAzureRegion] = useState('');
  const [azureError, setAzureError] = useState('');
  const [userScope, setUserScope] = useState('');
  const [composing, setComposing] = useState(false);
  const [azureRevision, setAzureRevision] = useState(0);
  const [liveSuggestion, setLiveSuggestion] = useState<LiveTranslationResult | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState<string | null>(null);
  const currentLiveSuggestion =
    azureConfigured &&
    settings.aiEnrichment !== 'off' &&
    !composing &&
    liveSuggestion?.input === query.trim().normalize('NFC') &&
    liveSuggestion.language === searchLanguage &&
    liveSuggestion.context === context &&
    liveSuggestion.scope === userScope + ':' + azureRevision
      ? liveSuggestion
      : null;
  const [liveDictionary, setLiveDictionary] = useState<{
    result: LiveTranslationResult;
    entry: Entry;
  } | null>(null);
  useEffect(() => {
    if (!currentLiveSuggestion) return;
    let current = true;
    const result = currentLiveSuggestion;
    void localLookup(searchLanguage === 'nl' ? result.input : result.entry.lemma)
      .then((dictionary) => {
        if (current && dictionary.found)
          setLiveDictionary({
            result,
            entry: {
              ...dictionary,
              originalInput: result.input,
              sourceLanguage: result.language,
            },
          });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [currentLiveSuggestion, searchLanguage]);
  const matchingLiveDictionary =
    liveDictionary?.result === currentLiveSuggestion ? liveDictionary?.entry : null;
  const entry =
    selectedEntry === currentLiveSuggestion?.entry && matchingLiveDictionary
      ? matchingLiveDictionary
      : selectedEntry ||
        (!searching && currentLiveSuggestion
          ? matchingLiveDictionary || currentLiveSuggestion.entry
          : null);
  const normalizeSuggestion = (value: string) =>
    value.trim().normalize('NFC').toLocaleLowerCase('nl');
  const matchingDictionarySuggestion =
    currentLiveSuggestion &&
    suggestions.some(
      (suggestion) =>
        normalizeSuggestion(suggestion.word) === normalizeSuggestion(currentLiveSuggestion.input) &&
        (searchLanguage === 'nl' ||
          normalizeSuggestion(suggestion.meaning) ===
            normalizeSuggestion(currentLiveSuggestion.entry.lemma)),
    );
  const searchOptions = [
    ...(currentLiveSuggestion && !matchingDictionarySuggestion
      ? [
          {
            id: 'azure:' + currentLiveSuggestion.key,
            word: currentLiveSuggestion.input,
            meaning:
              searchLanguage === 'nl'
                ? currentLiveSuggestion.entry.senses[0]?.meaning || ''
                : currentLiveSuggestion.entry.lemma,
            entry: currentLiveSuggestion.entry,
            azure: true,
          },
        ]
      : []),
    ...suggestions.map((suggestion) => ({
      ...suggestion,
      id: 'dictionary:' + searchLanguage + ':' + suggestion.word,
      entry: undefined as Entry | undefined,
      azure: false,
    })),
  ];
  const activeSuggestionIndex = searchOptions.findIndex((option) => option.id === activeSuggestion);
  function chooseSuggestion(option: (typeof searchOptions)[number]) {
    setActiveSuggestion(null);
    setSuggestOpen(false);
    if (!option.entry) {
      void search(option.word);
      return;
    }
    formRequest.current?.abort();
    aiController.current?.abort();
    ++searchGeneration.current;
    engine.current?.stop();
    setEntry(
      liveDictionary?.result === currentLiveSuggestion ? liveDictionary.entry : option.entry,
    );
    setAiEntry(null);
    setAiBusy(false);
    setFormTranslation(null);
    setFormBusy(false);
    setSearching(false);
    setTranslating(false);
    setTranslationError('');
    setError('');
    setCandidates([]);
  }
  const translationReady = keyConfigured || azureConfigured;
  const searchLabel =
    searchLanguage === 'nl'
      ? 'Search Dutch words or phrases'
      : searchLanguage === 'en'
        ? 'Translate English into Dutch'
        : 'Translate Russian into Dutch';
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
          setAzureConfigured(!!value.azureConfigured);
          setAzureRegion(value.azureRegion || '');
          setAzureError(value.azureError || '');
          setUserScope(value.userScope || '');
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
        if (['nl', 'en', 'ru'].includes(saved.searchLanguage))
          setSearchLanguage(saved.searchLanguage);
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
          JSON.stringify({ query, context, entry: selectedEntry, formTranslation, searchLanguage }),
        );
      } catch {}
    };
    window.addEventListener('pagehide', save);
    return () => {
      save();
      window.removeEventListener('pagehide', save);
    };
  }, [query, context, selectedEntry, formTranslation, searchLanguage]);
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
      (searchLanguage === 'ru' ? Promise.resolve([]) : suggest(query, searchLanguage))
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
  }, [query, suggestOpen, searchLanguage]);
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
  async function translateMissing(next: string, n: number, language = searchLanguage) {
    aiController.current?.abort();
    const controller = new AbortController();
    aiController.current = controller;
    setTranslating(true);
    setTranslationError('');
    try {
      const result = await api(
        '/api/lookup',
        {
          query: next,
          context,
          mode: 'translate',
          sourceLanguage: language,
          targetLanguage: language === 'nl' ? 'en' : 'nl',
        },
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
  async function search(next = query, language = searchLanguage) {
    if (language !== searchLanguage) setSearchLanguage(language);
    setCandidates([]);
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
      const choices = language === 'en' ? await localCandidates(next, 'en') : [];
      const result: Entry =
        language === 'ru'
          ? {
              found: false,
              lemma: next,
              queryExplanation: '',
              partOfSpeech: '',
              article: '',
              ipa: '',
              forms: [],
              senses: [],
              related: [],
              notes: '',
            }
          : language === 'en'
            ? choices[0] || {
                found: false,
                lemma: next,
                queryExplanation: '',
                partOfSpeech: '',
                article: '',
                ipa: '',
                forms: [],
                senses: [],
                related: [],
                notes: '',
              }
            : await localLookup(next);

      if (n !== searchGeneration.current) return;
      setEntry(result);
      setCandidates(choices);
      setSearching(false);
      if (!result.found) {
        if (translationReady && settings.aiEnrichment !== 'off')
          void translateMissing(next, n, language);
      } else if (language === 'nl' && settings.aiEnrichment === 'auto') {
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
    setLiveSuggestion(null);
    setActiveSuggestion(null);
    setCandidates([]);
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
      let selectedSense = sense;
      if (sourceEntry.englishReferencePending) {
        const reference: Entry = await api('/api/lookup', {
          mode: 'translate',
          query: sourceEntry.lemma,
          sourceLanguage: 'nl',
          targetLanguage: 'en',
        });
        if (!reference.found || !reference.senses[0]?.meaning)
          throw Error('Add an English meaning before saving this translation.');
        selectedSense = { ...sense, meaning: reference.senses[0].meaning };
      }
      const material = searchMeaningMaterial(
        sourceEntry,
        selectedSense,
        sourceEntry === entry ? formTranslation : null,
        context,
      );
      const practice = addPractice !== 'off' && !!material.body.en;
      material.body = {
        ...material.body,
        ...(sourceEntry.originalInput
          ? { originalInput: sourceEntry.originalInput, sourceLanguage: sourceEntry.sourceLanguage }
          : {}),
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
              <div className={'search-heading' + (entry || formTranslation ? ' has-results' : '')}>
                <span className="eyebrow">YOUR EVERYDAY DUTCH</span>
                <h1>
                  A word. A phrase.
                  <br /> A little more Dutch.
                </h1>
              </div>
              <label className="search-language">
                Translate or look up
                <select
                  aria-label="Search language"
                  value={searchLanguage}
                  onChange={(e) => {
                    clearSearch();
                    setSearchLanguage(e.target.value as 'nl' | 'en' | 'ru');
                  }}
                >
                  <option value="nl">Dutch → English</option>
                  <option value="en">English → Dutch</option>
                  <option value="ru">Russian → Dutch</option>
                </select>
              </label>
              <form
                className="dictionary-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (query.trim() && !composing) search();
                }}
              >
                <Search size={22} />
                <input
                  ref={searchInput}
                  aria-label={searchLabel}
                  placeholder={
                    searchLanguage === 'nl'
                      ? 'Search a Dutch word or phrase…'
                      : searchLanguage === 'en'
                        ? 'What would you like to say in Dutch?'
                        : 'Enter a Russian word or phrase…'
                  }
                  value={query}
                  maxLength={240}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={suggestOpen && searchOptions.length > 0}
                  aria-controls={
                    suggestOpen && searchOptions.length > 0 ? 'search-suggestions' : undefined
                  }
                  aria-activedescendant={
                    suggestOpen && activeSuggestionIndex >= 0
                      ? 'search-option-' + activeSuggestionIndex
                      : undefined
                  }
                  onFocus={() => setSuggestOpen(true)}
                  onCompositionStart={() => setComposing(true)}
                  onCompositionEnd={() => setComposing(false)}
                  onKeyDown={(e) => {
                    if (composing || e.nativeEvent?.isComposing) {
                      if (e.key === 'Enter') e.preventDefault();
                      return;
                    }
                    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && searchOptions.length) {
                      e.preventDefault();
                      const next =
                        !suggestOpen || activeSuggestionIndex < 0
                          ? e.key === 'ArrowDown'
                            ? 0
                            : searchOptions.length - 1
                          : (activeSuggestionIndex +
                              (e.key === 'ArrowDown' ? 1 : -1) +
                              searchOptions.length) %
                            searchOptions.length;
                      setSuggestOpen(true);
                      setActiveSuggestion(searchOptions[next].id);
                      searchInput.current?.ownerDocument
                        ?.getElementById('search-option-' + next)
                        ?.scrollIntoView?.({ block: 'nearest' });
                    } else if (e.key === 'Enter' && suggestOpen && activeSuggestionIndex >= 0) {
                      e.preventDefault();
                      chooseSuggestion(searchOptions[activeSuggestionIndex]);
                    } else if (e.key === 'Escape') {
                      setSuggestOpen(false);
                      setActiveSuggestion(null);
                    }
                  }}
                  onChange={(e) => {
                    formRequest.current?.abort();
                    setFormTranslation(null);
                    setFormBusy(false);
                    setFormError('');
                    setQuery(e.target.value);
                    setActiveSuggestion(null);
                    setSuggestOpen(true);
                    setSuggestions([]);
                    ++searchGeneration.current;
                    aiController.current?.abort();
                    setSearching(false);
                    setEntry(null);
                    setCandidates([]);
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
              {suggestOpen && searchOptions.length > 0 && (
                <div
                  id="search-suggestions"
                  role="listbox"
                  className="word-suggestions"
                  aria-label="Translation and dictionary suggestions"
                >
                  {searchOptions.map((x, i) => (
                    <button
                      key={x.id}
                      id={'search-option-' + i}
                      role="option"
                      aria-selected={x.id === activeSuggestion}
                      tabIndex={-1}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActiveSuggestion(x.id)}
                      aria-label={x.word + ' — ' + x.meaning}
                      type="button"
                      onClick={() => chooseSuggestion(x)}
                    >
                      <b lang={searchLanguage}>{x.word}</b>
                      <span lang={searchLanguage === 'nl' ? 'en' : 'nl'}>{x.meaning}</span>
                      {x.azure && <small className="suggestion-provider">Translator</small>}
                    </button>
                  ))}
                </div>
              )}
              <details className="search-context">
                <summary>
                  Add a sentence for context <ChevronDown size={13} />
                </summary>
                <textarea
                  aria-label={
                    searchLanguage === 'nl' ? 'Dutch sentence for context' : 'Translation context'
                  }
                  placeholder="Optional: add a sentence or surrounding text."
                  maxLength={1500}
                  value={context}
                  onChange={(e) => {
                    formRequest.current?.abort();
                    setFormTranslation(null);
                    setFormBusy(false);
                    setFormError('');
                    aiController.current?.abort();
                    ++searchGeneration.current;
                    setSearching(false);
                    setTranslating(false);
                    setAiBusy(false);
                    setEntry(null);
                    setAiEntry(null);
                    setContext(e.target.value);
                  }}
                />
              </details>
              <LiveTranslation
                key={userScope + ':' + azureRevision}
                scope={userScope + ':' + azureRevision}
                onResult={setLiveSuggestion}
                inSuggestions={suggestOpen && !!currentLiveSuggestion}
                query={query}
                context={context}
                language={searchLanguage}
                enabled={azureConfigured && settings.aiEnrichment !== 'off'}
                paused={composing || searching || translating}
                coveredBySearch={
                  !!selectedEntry?.translationProvider &&
                  selectedEntry.originalInput === query.trim().normalize('NFC') &&
                  selectedEntry.sourceLanguage === searchLanguage
                }
                onSearch={() => {
                  void search();
                }}
              />
              {!translationReady && !connectionError && (
                <div className="connect-prompt">
                  <KeyRound size={16} />
                  <span>Connect Azure or OpenAI for phrase translations.</span>
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
                  <p>
                    {searchLanguage === 'nl'
                      ? 'Looking up your Dutch…'
                      : 'Finding Dutch translations…'}
                  </p>
                </div>
              )}
              {candidates.length > 1 && (
                <div className="translation-candidates" aria-label="Dutch dictionary alternatives">
                  <p>Choose the Dutch word that fits your meaning.</p>
                  {candidates.map((candidate, i) => (
                    <button
                      type="button"
                      key={i}
                      aria-pressed={entry === candidate}
                      onClick={() => {
                        setEntry(candidate);
                        setAiEntry(null);
                        setFormTranslation(null);
                      }}
                    >
                      <strong lang="nl">
                        {candidate.article ? candidate.article + ' ' : ''}
                        {candidate.lemma}
                      </strong>
                      <span>{candidate.senses[0]?.meaning}</span>
                    </button>
                  ))}
                </div>
              )}
              {entry && (
                <section className="dictionary-entry">
                  {(entry.found || searchLanguage === 'nl') && (
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
                                ? nounArticle(
                                    entry.queryForm.text,
                                    entry,
                                    formTranslation?.baseForm,
                                  )
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
                  )}
                  {entry.queryForm && (
                    <div className="base-form-link">
                      <span>{entry.queryForm.label} · </span>Base form{' '}
                      <button onClick={() => search(entry.lemma, 'nl')}>{entry.lemma} ↗</button>
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
                        ? searchLanguage === 'nl'
                          ? 'Translating Dutch → English…'
                          : 'Translating into Dutch…'
                        : entry.notes || 'This is not in the dictionary.'}
                      {translating && <LoaderCircle size={18} className="spin" />}
                      {!translating && (
                        <>
                          {translationError && <span role="status"> {translationError}</span>}
                          {translationReady ? (
                            <button
                              className="text-action"
                              onClick={() => translateMissing(query, searchGeneration.current)}
                            >
                              Translate phrase
                            </button>
                          ) : (
                            <button className="text-action" onClick={() => navigate('Settings')}>
                              Connect Azure or OpenAI to translate this phrase
                            </button>
                          )}
                        </>
                      )}
                    </p>
                  ) : (
                    <>
                      {entry.originalInput && searchLanguage !== 'nl' && (
                        <p className="translation-original" lang={entry.sourceLanguage}>
                          {entry.originalInput}
                        </p>
                      )}
                      <button
                        type="button"
                        className="text-action"
                        onClick={() => {
                          navigator.clipboard
                            .writeText(entry.queryForm?.text || entry.lemma)
                            .then(() => notify('Dutch copied.'))
                            .catch(() =>
                              notify('Copy was unavailable. Select and copy the Dutch text.'),
                            );
                        }}
                      >
                        Copy Dutch
                      </button>
                      <div className="save-preference">
                        <PracticeModeSelect
                          value={addPractice}
                          onChange={setAddPractice}
                          hasMeaning={
                            !entry.englishReferencePending &&
                            (!entry.queryForm || !!formTranslation?.found)
                          }
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
                              <h3>
                                {entry.englishReferencePending
                                  ? 'English meaning will be added when you save.'
                                  : sense.meaning}
                              </h3>
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
                              <button key={i} onClick={() => search(r.word, 'nl')}>
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
                        {entry.translationProvider ? 'Translator' : entry.source}
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
                !entry.translationProvider && (
                  <section className="ai-addition">
                    <div className="ai-heading">
                      <h3>AI explanation</h3>
                      {!aiBusy && (
                        <button
                          className="text-action"
                          onClick={() =>
                            enrich(
                              entry,
                              searchGeneration.current,
                              searchLanguage === 'nl' ? query : entry.lemma,
                            )
                          }
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
                              <h3>
                                {entry.englishReferencePending
                                  ? 'English meaning will be added when you save.'
                                  : sense.meaning}
                              </h3>
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
                <a href="https://www.wikdict.com/page/download" target="_blank" rel="noreferrer">
                  WikDict / DBnary
                </a>{' '}
                ·{' '}
                <a
                  href="https://creativecommons.org/licenses/by-sa/4.0/"
                  target="_blank"
                  rel="noreferrer"
                >
                  CC BY-SA 4.0
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
                  <span className="eyebrow">MAKE IT YOURS</span>
                  <h1>Settings</h1>
                  <p>Connections, translations and practice preferences.</p>
                </div>
              </div>
              <AzureSettings
                key={userScope}
                configured={azureConfigured}
                error={azureError}
                region={azureRegion}
                onChanged={() => {
                  setAzureRevision((revision) => revision + 1);
                  void load(true);
                }}
              />
              <section className="settings-card">
                <ConnectionHeading title="OpenAI" configured={keyConfigured} />
                <p className="settings-copy">
                  Grammar analysis, dictionary explanations and fallback translations. Your key is
                  encrypted and scoped to your account. API usage is billed to your OpenAI project.
                </p>
                <label>
                  API key
                  <input
                    type="password"
                    aria-label="OpenAI API key"
                    autoComplete="off"
                    spellCheck={false}
                    value={apiKey}
                    disabled={settingsBusy}
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
                  <button
                    className="secondary"
                    disabled={settingsBusy || !keyConfigured}
                    onClick={() => saveKey('testKey')}
                  >
                    Test connection
                  </button>
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
              <SpeechSettings onChanged={() => void load()} />
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
                  Dictionary results appear first. AI explanations load separately. When no entry
                  exists, Azure translates first, with OpenAI as fallback when configured. Off
                  disables automatic translation too; you can still request it with a button. AI
                  explanations and fallback translation use your OpenAI credit.
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
              void search(value, 'nl');
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
