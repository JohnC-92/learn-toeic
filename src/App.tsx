import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import vocabRaw from '../toeic_vocab_ecdict.csv?raw';

type VocabItem = {
  english: string;
  chinese: string;
  checkStatus: string;
  ecdictZh: string;
  ecdictPos: string;
  englishKey: string;
};

type VoiceOption = {
  name: string;
  lang: string;
  voiceURI: string;
};

type DictionaryEntry = {
  zh: string;
  pos: string;
};

type DictionaryMap = Record<string, DictionaryEntry>;

const parseCsvLine = (line: string) => {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
};

const alignRow = (parts: string[], headerLength: number) => {
  if (parts.length === headerLength) {
    return parts;
  }

  if (parts.length < headerLength) {
    return [...parts, ...Array(headerLength - parts.length).fill('')];
  }

  if (headerLength <= 2) {
    return parts.slice(0, headerLength);
  }

  const tailLength = headerLength - 2;
  const chinese = parts.slice(1, parts.length - tailLength).join(',');
  return [parts[0], chinese, ...parts.slice(parts.length - tailLength)];
};

const normalizeLookup = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*\([^)]*\)\s*$/, '');

const parseVocab = (raw: string): VocabItem[] => {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return [];
  }

  const header = parseCsvLine(lines[0]);
  const headerLength = header.length;
  const indexMap = new Map(header.map((name, index) => [name, index]));

  const englishIndex = indexMap.get('English') ?? 0;
  const chineseIndex = indexMap.get('Chinese Meanings') ?? 1;
  const wordWithPosIndex = indexMap.get('word_with_pos') ?? englishIndex;
  const checkStatusIndex = indexMap.get('check_status') ?? -1;
  const ecdictZhIndex = indexMap.get('ecdict_zh') ?? -1;
  const ecdictPosIndex = indexMap.get('ecdict_pos') ?? -1;

  return lines.slice(1).reduce<VocabItem[]>((items, line) => {
    const parts = alignRow(parseCsvLine(line), headerLength);
    const englishKey = parts[englishIndex]?.trim() ?? '';
    const wordWithPos = parts[wordWithPosIndex]?.trim() ?? englishKey;
    const chinese = parts[chineseIndex]?.trim() ?? '';
    const checkStatus = checkStatusIndex >= 0 ? parts[checkStatusIndex]?.trim() ?? '' : '';
    const ecdictZh = ecdictZhIndex >= 0 ? parts[ecdictZhIndex]?.trim() ?? '' : '';
    const ecdictPos = ecdictPosIndex >= 0 ? parts[ecdictPosIndex]?.trim() ?? '' : '';

    if (wordWithPos && chinese) {
      items.push({
        english: wordWithPos,
        chinese,
        checkStatus,
        ecdictZh,
        ecdictPos,
        englishKey,
      });
    }

    return items;
  }, []);
};

const vocabItems = parseVocab(vocabRaw);

const getRandomIndex = (length: number) => {
  if (length <= 1) {
    return 0;
  }

  return Math.floor(Math.random() * length);
};

const pickNextIndex = (currentIndex: number, length: number) => {
  if (length <= 1) {
    return 0;
  }

  let nextIndex = currentIndex;
  while (nextIndex === currentIndex) {
    nextIndex = getRandomIndex(length);
  }

  return nextIndex;
};

const getVoiceOptions = (): VoiceOption[] => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return [];
  }

  return window.speechSynthesis.getVoices().map((voice) => ({
    name: voice.name,
    lang: voice.lang,
    voiceURI: voice.voiceURI,
  }));
};

const pickDefaultVoice = (voices: VoiceOption[], prefix: string) => {
  const preferred = voices.find((voice) => voice.lang.toLowerCase().startsWith(prefix));
  return preferred?.voiceURI ?? voices[0]?.voiceURI ?? '';
};

const pickTaiwanVoice = (voices: VoiceOption[]) => {
  const rocko = voices.find(
    (voice) =>
      voice.name.toLowerCase().includes('rocko') &&
      voice.lang.toLowerCase().startsWith('zh-tw')
  );
  if (rocko) {
    return rocko.voiceURI;
  }

  return pickDefaultVoice(voices, 'zh-');
};

const resolveVoice = (voiceMap: Map<string, VoiceOption>, voiceURI: string) => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return undefined;
  }

  const selected = voiceMap.get(voiceURI);
  if (!selected) {
    return undefined;
  }

  return window.speechSynthesis.getVoices().find((voice) => voice.voiceURI === selected.voiceURI);
};

const speakText = (
  text: string,
  lang: string,
  voiceMap: Map<string, VoiceOption>,
  voiceURI: string,
  speechSupported: boolean,
  rate: number
) => {
  if (!speechSupported) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = rate;
    const voice = resolveVoice(voiceMap, voiceURI);
    if (voice) {
      utterance.voice = voice;
    }
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
};

const clampPause = (durationMs: number) => Math.max(200, durationMs);

const wait = (durationMs: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, durationMs);
  });

export default function App() {
  const [currentIndex, setCurrentIndex] = useState(() => getRandomIndex(vocabItems.length));
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState('');
  const [selectedChineseVoiceURI, setSelectedChineseVoiceURI] = useState('');
  const [autoMode, setAutoMode] = useState(false);
  const [speechRate, setSpeechRate] = useState(1);
  const [dictionary, setDictionary] = useState<DictionaryMap>({});
  const [lookupTerm, setLookupTerm] = useState('');
  const [lookupResult, setLookupResult] = useState<DictionaryEntry | null>(null);
  const [lookupMessage, setLookupMessage] = useState('');
  const current = vocabItems[currentIndex];
  const total = vocabItems.length;
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const dictionaryReady = Object.keys(dictionary).length > 0;
  const currentIndexRef = useRef(currentIndex);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    if (!speechSupported) {
      return;
    }

    const loadVoices = () => {
      const available = getVoiceOptions();
      setVoices(available);
      setSelectedVoiceURI((prev) => prev || pickDefaultVoice(available, 'en-'));
      setSelectedChineseVoiceURI((prev) => prev || pickTaiwanVoice(available));
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [speechSupported]);

  useEffect(() => {
    const controller = new AbortController();
    const loadDictionary = async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}dict/ecdict.json`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as DictionaryMap;
        setDictionary(data);
      } catch (error) {
        // Ignore dictionary load errors.
      }
    };

    loadDictionary();

    return () => controller.abort();
  }, []);

  const voiceMap = useMemo(() => {
    return new Map(voices.map((voice) => [voice.voiceURI, voice]));
  }, [voices]);

  useEffect(() => {
    if (!autoMode || !speechSupported || total === 0) {
      return;
    }

    let cancelled = false;

    const runSequence = async () => {
      let index = currentIndexRef.current;

      while (!cancelled) {
        const item = vocabItems[index];
        if (!item) {
          break;
        }

        window.speechSynthesis.cancel();
        await speakText(
          item.english,
          'en-US',
          voiceMap,
          selectedVoiceURI,
          speechSupported,
          speechRate
        );
        if (cancelled) break;
        await wait(clampPause(700 / speechRate));
        if (cancelled) break;
        await speakText(
          item.chinese,
          'zh-TW',
          voiceMap,
          selectedChineseVoiceURI,
          speechSupported,
          speechRate
        );
        if (cancelled) break;
        await wait(clampPause(700 / speechRate));
        if (cancelled) break;
        await speakText(
          item.english,
          'en-US',
          voiceMap,
          selectedVoiceURI,
          speechSupported,
          speechRate
        );
        if (cancelled) break;
        await wait(clampPause(700 / speechRate));
        if (cancelled) break;
        await speakText(
          item.chinese,
          'zh-TW',
          voiceMap,
          selectedChineseVoiceURI,
          speechSupported,
          speechRate
        );
        if (cancelled) break;
        await wait(clampPause(900 / speechRate));
        if (cancelled) break;

        index = pickNextIndex(index, total);
        setCurrentIndex(index);
      }
    };

    runSequence();

    return () => {
      cancelled = true;
      window.speechSynthesis.cancel();
    };
  }, [autoMode, selectedVoiceURI, selectedChineseVoiceURI, speechRate, speechSupported, total, voiceMap]);

  const handleNext = () => {
    if (!total) {
      return;
    }

    setCurrentIndex((index) => pickNextIndex(index, total));
  };

  const handleSpeakEnglish = () => {
    if (!current || !speechSupported) {
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(current.english);
    utterance.lang = 'en-US';
    utterance.rate = speechRate;
    const voice = resolveVoice(voiceMap, selectedVoiceURI);
    if (voice) {
      utterance.voice = voice;
    }
    window.speechSynthesis.speak(utterance);
  };

  const handleSpeakChinese = () => {
    if (!current || !speechSupported) {
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(current.chinese);
    utterance.lang = 'zh-TW';
    utterance.rate = speechRate;
    const voice = resolveVoice(voiceMap, selectedChineseVoiceURI);
    if (voice) {
      utterance.voice = voice;
    }
    window.speechSynthesis.speak(utterance);
  };

  const handleToggleAuto = () => {
    setAutoMode((prev) => !prev);
  };

  const handleLookup = () => {
    if (!dictionaryReady) {
      setLookupResult(null);
      setLookupMessage('Dictionary is still loading.');
      return;
    }

    const key = normalizeLookup(lookupTerm);
    if (!key) {
      setLookupResult(null);
      setLookupMessage('Enter a word to look up.');
      return;
    }

    const entry = dictionary[key];
    if (!entry) {
      setLookupResult(null);
      setLookupMessage('No dictionary match found.');
      return;
    }

    setLookupResult(entry);
    setLookupMessage('');
  };

  const handleLookupKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleLookup();
    }
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-4 py-10 sm:px-8 sm:py-16">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muji-accent">
            TOEIC Vocabulary
          </p>
          <h1 className="text-3xl font-semibold text-muji-ink sm:text-4xl">
            Study a new word with a calm, Muji-inspired palette.
          </h1>
          <p className="text-sm text-muji-ink/70">
            {total ? `${currentIndex + 1} / ${total} words` : 'No vocabulary loaded yet.'}
          </p>
        </header>

        <section className="mt-10 flex-1">
          <div className="rounded-3xl border border-muji-wood/50 bg-muji-card p-6 shadow-soft sm:p-10">
            {current ? (
              <div className="space-y-8">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muji-accent">
                    English
                  </p>
                  <p className="mt-3 text-3xl font-semibold text-muji-ink sm:text-4xl">
                    {current.english}
                  </p>
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muji-accent">
                      Chinese Meaning
                    </p>
                    {current.checkStatus && current.checkStatus !== 'OK' && (
                      <span className="rounded-full border border-amber-300/70 bg-amber-100/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-700">
                        Possible error
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xl text-muji-ink/90 sm:text-2xl">
                    {current.chinese}
                  </p>
                  {(current.ecdictZh || current.ecdictPos) && (
                    <div className="mt-4 rounded-2xl border border-muji-wood/40 bg-white/60 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-muji-accent">
                        <span>Dictionary</span>
                        {current.ecdictPos && (
                          <span className="rounded-full border border-muji-wood/50 bg-muji-paper px-2 py-1 text-[10px] text-muji-ink">
                            {current.ecdictPos}
                          </span>
                        )}
                      </div>
                      {current.ecdictZh && (
                        <p className="mt-2 text-sm text-muji-ink/80">
                          {current.ecdictZh}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-lg text-muji-ink/70">
                No entries available. Check the CSV file for valid rows.
              </p>
            )}
          </div>

          <div className="mt-8 flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                className="rounded-full bg-muji-accent px-6 py-3 text-sm font-semibold text-white shadow-soft transition hover:bg-muji-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-muji-accent/50 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleNext}
                type="button"
                disabled={!current || autoMode}
              >
                Next Random
              </button>
              <button
                className="rounded-full border border-muji-wood/60 bg-white/70 px-6 py-3 text-sm font-semibold text-muji-ink shadow-soft transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-muji-wood/60 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleSpeakEnglish}
                type="button"
                disabled={!current || !speechSupported || autoMode}
              >
                Read English
              </button>
              <button
                className="rounded-full border border-muji-wood/60 bg-white/70 px-6 py-3 text-sm font-semibold text-muji-ink shadow-soft transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-muji-wood/60 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleSpeakChinese}
                type="button"
                disabled={!current || !speechSupported || autoMode}
              >
                Read Chinese
              </button>
              <button
                className="rounded-full border border-muji-accent/50 bg-muji-accent/10 px-6 py-3 text-sm font-semibold text-muji-ink shadow-soft transition hover:bg-muji-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-muji-accent/50 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleToggleAuto}
                type="button"
                disabled={!current || !speechSupported}
              >
                {autoMode ? 'Stop Auto' : 'Auto Mode'}
              </button>
            </div>
            {speechSupported && voices.length > 0 && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.3em] text-muji-accent">
                      English Voice
                    </label>
                    <div className="relative">
                      <select
                        className="w-full appearance-none rounded-2xl border border-muji-wood/60 bg-white/70 px-4 py-3 text-sm text-muji-ink shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-muji-wood/60"
                        value={selectedVoiceURI}
                        onChange={(event) => setSelectedVoiceURI(event.target.value)}
                      >
                        {voices.map((voice) => (
                          <option key={voice.voiceURI} value={voice.voiceURI}>
                            {voice.name} ({voice.lang})
                          </option>
                        ))}
                      </select>
                      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muji-ink/60">
                        ▾
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.3em] text-muji-accent">
                      Chinese Voice
                    </label>
                    <div className="relative">
                      <select
                        className="w-full appearance-none rounded-2xl border border-muji-wood/60 bg-white/70 px-4 py-3 text-sm text-muji-ink shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-muji-wood/60"
                        value={selectedChineseVoiceURI}
                        onChange={(event) => setSelectedChineseVoiceURI(event.target.value)}
                      >
                        {voices.map((voice) => (
                          <option key={voice.voiceURI} value={voice.voiceURI}>
                            {voice.name} ({voice.lang})
                          </option>
                        ))}
                      </select>
                      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muji-ink/60">
                        ▾
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.3em] text-muji-accent">
                    Reading Speed
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      className="h-2 w-full cursor-pointer accent-muji-accent"
                      type="range"
                      min="0.6"
                      max="1.4"
                      step="0.05"
                      value={speechRate}
                      onChange={(event) => setSpeechRate(Number(event.target.value))}
                    />
                    <span className="text-sm text-muji-ink/70 sm:w-20">
                      {speechRate.toFixed(2)}x
                    </span>
                  </div>
                </div>
              </div>
            )}
            <div className="rounded-3xl border border-muji-wood/40 bg-muji-card/70 px-4 py-4 sm:px-6">
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muji-accent">
                  Dictionary Lookup
                </p>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muji-ink/60">
                      English word
                    </label>
                    <input
                      className="mt-2 w-full rounded-2xl border border-muji-wood/50 bg-white/70 px-4 py-3 text-sm text-muji-ink shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-muji-accent/40"
                      placeholder="Type a word (e.g., lumber)"
                      value={lookupTerm}
                      onChange={(event) => {
                        setLookupTerm(event.target.value);
                        setLookupMessage('');
                      }}
                      onKeyDown={handleLookupKeyDown}
                      disabled={!dictionaryReady}
                    />
                  </div>
                  <button
                    className="rounded-full border border-muji-accent/50 bg-muji-accent/10 px-6 py-3 text-sm font-semibold text-muji-ink shadow-soft transition hover:bg-muji-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-muji-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={handleLookup}
                    type="button"
                    disabled={!dictionaryReady}
                  >
                    Look up
                  </button>
                </div>
                {!dictionaryReady && (
                  <p className="text-xs text-muji-ink/60">Loading dictionary data…</p>
                )}
                {lookupMessage && (
                  <p className="text-xs text-muji-ink/60">{lookupMessage}</p>
                )}
                {lookupResult && (
                  <div className="rounded-2xl border border-muji-wood/40 bg-white/70 px-4 py-3 text-sm text-muji-ink/80">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muji-accent">
                      <span>Result</span>
                      {lookupResult.pos && (
                        <span className="rounded-full border border-muji-wood/50 bg-muji-paper px-2 py-1 text-[10px] text-muji-ink">
                          {lookupResult.pos}
                        </span>
                      )}
                    </div>
                    {lookupResult.zh && (
                      <p className="mt-2 text-sm text-muji-ink/80">{lookupResult.zh}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          {!speechSupported && (
            <p className="mt-3 text-xs text-muji-ink/60">
              Speech synthesis is not available in this browser.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
