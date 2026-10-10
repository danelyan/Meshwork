'use client';

import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { speechText } from '@/lib/speech-text';

import { COMPANION_SAY_EVENT } from './events';
import { rms } from './level';
import { CLOSED, LipSync, type MouthShape, type SpectrumFeatures, type Viseme } from './lipsync';

/**
 * Голос компаньона: озвучка ответов через `/api/tts` (SpeechKit) и Web Audio. Аудио идёт через
 * AnalyserNode — аватар читает громкость (`getLevel`) в своём кадре и открывает рот.
 *
 * Озвучка выключена по умолчанию: iOS/Chrome пускают звук только после жеста, поэтому AudioContext
 * создаётся и `resume()`-ится на клике «Озвучивать ответы» или «Озвучить» у сообщения. Дальше
 * завершённые ответы (`speak`) играют сами, по очереди; следующий синтез грузится, пока звучит текущий.
 */
export type VoiceStatus = 'idle' | 'thinking' | 'loading' | 'speaking';

export interface CompanionVoice {
  enabled: boolean;
  status: VoiceStatus;
  /** null — ещё не спрашивали сервер; false — озвучка выключена на стенде. */
  available: boolean | null;
  notice: string | null;
  /** Включить/выключить автоозвучку. Вызывать из обработчика клика (разблокирует звук). */
  toggle: () => void;
  /** Завершённый ответ компаньона: озвучить, если автоозвучка включена. */
  speak: (text: string, key?: string) => void;
  /** Озвучить по клику (повтор сообщения, тест) — независимо от переключателя. */
  replay: (text: string, key?: string) => void;
  stop: () => void;
  setThinking: (thinking: boolean) => void;
  /** Текущая громкость (RMS 0…1) звучащей реплики; 0 — тишина. */
  getLevel: () => number;
  /** Форма рта по спектру звучащей реплики (lipsync.ts); в тишине — закрыт. Считать раз в кадр. */
  getMouth: () => MouthShape;
  /** Текущая висема — для отладки и демо-страницы. */
  getViseme: () => Viseme;
  /** Признаки спектра последнего кадра — для калибровки на демо-странице. */
  getFeatures: () => SpectrumFeatures | null;
  /** Исходный текст реплики, которую сейчас готовят или произносят; null — тишина. */
  speakingText: string | null;
  /** Ключ звучащей реплики (id потока), если вызывающий его передал: по нему пузырь отличает одинаковые тексты. */
  speakingKey: string | null;
  /** Прогресс воспроизведения звучащей реплики 0…1 (по часам AudioContext); 0 — тишина или загрузка. */
  getProgress: () => number;
}

export { COMPANION_SAY_EVENT };

const VoiceContext = createContext<CompanionVoice | null>(null);

/** Голос компаньона из ближайшего провайдера; null — вне чата (кнопок озвучки нет). */
export function useCompanionVoice(): CompanionVoice | null {
  return useContext(VoiceContext);
}

type AudioCtor = typeof AudioContext;

interface Pending {
  /** Исходный текст реплики (как пришёл от агента) — по нему лента находит звучащий пузырь. */
  text: string;
  key?: string;
  ctrl: AbortController;
  audio: Promise<AudioBuffer | null>;
}

/**
 * `autoEnable` — озвучка включается сама на первом действии пользователя (клик, касание, клавиша):
 * это снимает запрет autoplay, и ответы звучат без «Озвучивать ответы». Клик по кнопке с
 * `data-voice-toggle` (переключатель «без звука») автоматику не запускает — решает сам переключатель.
 * Без флага (онбординг) озвучка включается только кнопкой.
 */
export function CompanionVoiceProvider({ children, autoEnable = false }: { children: ReactNode; autoEnable?: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [thinking, setThinkingState] = useState(false);
  const [playing, setPlaying] = useState<'loading' | 'speaking' | null>(null);
  const [speakingText, setSpeakingText] = useState<string | null>(null);
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);

  const enabledRef = useRef(false);
  const availableRef = useRef<boolean | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const bufRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const freqRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const lipRef = useRef<LipSync | null>(null);
  const lipAtRef = useRef(0);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const queueRef = useRef<Pending[]>([]);
  const runningRef = useRef(false);
  const startedAtRef = useRef(0);
  const durationRef = useRef(0);

  /** Создать/разбудить AudioContext. Только синхронно из жеста пользователя (политика автозапуска). */
  const unlock = useCallback((): boolean => {
    if (typeof window === 'undefined') return false;
    const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext) as AudioCtor | undefined;
    if (!Ctor) {
      setNotice('Этот браузер не умеет воспроизводить звук');
      return false;
    }
    if (!ctxRef.current) {
      const ctx = new Ctor();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.connect(ctx.destination);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      bufRef.current = new Float32Array(analyser.fftSize);
      freqRef.current = new Uint8Array(analyser.frequencyBinCount);
      lipRef.current = new LipSync(ctx.sampleRate / analyser.fftSize);
    }
    if (ctxRef.current.state === 'suspended') void ctxRef.current.resume().catch(() => undefined);
    return true;
  }, []);

  const fetchAudio = useCallback((text: string): Omit<Pending, 'text'> => {
    const ctrl = new AbortController();
    const audio = (async () => {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        if (res.status === 400) {
          availableRef.current = false;
          setAvailable(false);
        }
        throw new Error(body.error?.message ?? 'Озвучка сейчас недоступна');
      }
      const ctx = ctxRef.current;
      if (!ctx) return null;
      return ctx.decodeAudioData(await res.arrayBuffer());
    })();
    audio.catch(() => undefined);
    return { ctrl, audio };
  }, []);

  const pump = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      for (;;) {
        const next = queueRef.current[0];
        if (!next) break;
        setPlaying('loading');
        setSpeakingText(next.text);
        setSpeakingKey(next.key ?? null);
        let buffer: AudioBuffer | null = null;
        try {
          buffer = await next.audio;
        } catch (e) {
          if (!next.ctrl.signal.aborted) setNotice(e instanceof Error ? e.message : 'Озвучка сейчас недоступна');
        }
        if (queueRef.current[0] !== next) continue; // остановили, пока грузилось
        const ctx = ctxRef.current;
        const analyser = analyserRef.current;
        if (buffer && ctx && analyser) {
          setNotice(null);
          await new Promise<void>((resolve) => {
            const src = ctx.createBufferSource();
            src.buffer = buffer;
            src.connect(analyser);
            src.onended = () => resolve();
            sourceRef.current = src;
            lipRef.current?.reset();
            setPlaying('speaking');
            startedAtRef.current = ctx.currentTime;
            durationRef.current = buffer.duration;
            src.start();
          });
          sourceRef.current = null;
        }
        if (queueRef.current[0] === next) queueRef.current.shift();
      }
    } finally {
      runningRef.current = false;
      setPlaying(null);
      setSpeakingText(null);
      setSpeakingKey(null);
    }
  }, []);

  const enqueue = useCallback(
    (raw: string, key?: string) => {
      const text = speechText(raw);
      if (!text || availableRef.current === false) return;
      queueRef.current.push({ ...fetchAudio(text), text: raw, key });
      void pump();
    },
    [fetchAudio, pump],
  );

  const stop = useCallback(() => {
    for (const p of queueRef.current) p.ctrl.abort();
    queueRef.current = [];
    const src = sourceRef.current;
    sourceRef.current = null;
    if (src) {
      try {
        src.stop();
      } catch {
        /* уже остановлен */
      }
    }
  }, []);

  const checkAvailable = useCallback(async () => {
    if (availableRef.current !== null) return availableRef.current;
    try {
      const res = await fetch('/api/tts');
      const body = (await res.json()) as { mode?: string };
      availableRef.current = body.mode === 'yandex';
    } catch {
      availableRef.current = false;
    }
    setAvailable(availableRef.current);
    return availableRef.current;
  }, []);

  const userMutedRef = useRef(false);

  const toggle = useCallback(() => {
    if (enabledRef.current) {
      enabledRef.current = false;
      userMutedRef.current = true;
      setEnabled(false);
      stop();
      return;
    }
    userMutedRef.current = false;
    if (!unlock()) return;
    enabledRef.current = true;
    setEnabled(true);
    setNotice(null);
    void checkAvailable().then((ok) => {
      if (ok) return;
      enabledRef.current = false;
      setEnabled(false);
      setNotice('Озвучка на этом стенде выключена — ответы остаются текстом');
    });
  }, [unlock, stop, checkAvailable]);

  const speak = useCallback(
    (text: string, key?: string) => {
      if (enabledRef.current) enqueue(text, key);
    },
    [enqueue],
  );

  const replay = useCallback(
    (text: string, key?: string) => {
      if (!unlock()) return;
      stop();
      void checkAvailable().then((ok) => {
        if (ok) enqueue(text, key);
        else setNotice('Озвучка на этом стенде выключена — ответы остаются текстом');
      });
    },
    [unlock, stop, checkAvailable, enqueue],
  );

  const getProgress = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || !sourceRef.current || durationRef.current <= 0) return 0;
    return Math.min(1, Math.max(0, (ctx.currentTime - startedAtRef.current) / durationRef.current));
  }, []);

  const getLevel = useCallback(() => {
    const analyser = analyserRef.current;
    const buf = bufRef.current;
    if (!analyser || !buf || !sourceRef.current) return 0;
    analyser.getFloatTimeDomainData(buf);
    return rms(buf);
  }, []);

  /** Обновляет липсинк не чаще раза на кадр: несколько потребителей за кадр получают одну висему. */
  const tick = useCallback((): LipSync | null => {
    const analyser = analyserRef.current;
    const freq = freqRef.current;
    const lip = lipRef.current;
    if (!analyser || !freq || !lip || !sourceRef.current) return null;
    const now = performance.now();
    if (now - lipAtRef.current >= 8) {
      const dt = lipAtRef.current ? Math.min((now - lipAtRef.current) / 1000, 0.1) : 1 / 60;
      lipAtRef.current = now;
      analyser.getByteFrequencyData(freq);
      lip.update(freq, dt);
    }
    return lip;
  }, []);
  const getMouth = useCallback((): MouthShape => tick()?.shape ?? CLOSED, [tick]);
  const getViseme = useCallback((): Viseme => tick()?.viseme ?? 'sil', [tick]);
  const getFeatures = useCallback((): SpectrumFeatures | null => tick()?.last ?? null, [tick]);

  // Автовключение на первом жесте пользователя (см. `autoEnable`).
  useEffect(() => {
    if (!autoEnable) return;
    const events = ['pointerdown', 'touchend', 'click', 'keydown'] as const;
    const off = () => events.forEach((n) => window.removeEventListener(n, arm, true));
    function arm(e: Event) {
      off();
      if (e.target instanceof Element && e.target.closest('[data-voice-toggle]')) return;
      if (enabledRef.current || userMutedRef.current) return;
      toggle();
    }
    events.forEach((n) => window.addEventListener(n, arm, true));
    return off;
  }, [autoEnable, toggle]);

  useEffect(() => {
    const onSay = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (text) replay(text);
    };
    window.addEventListener(COMPANION_SAY_EVENT, onSay);
    return () => window.removeEventListener(COMPANION_SAY_EVENT, onSay);
  }, [replay]);

  useEffect(
    () => () => {
      stop();
      void ctxRef.current?.close().catch(() => undefined);
      ctxRef.current = null;
    },
    [stop],
  );

  const status: VoiceStatus = playing ?? (thinking ? 'thinking' : 'idle');
  const value = useMemo<CompanionVoice>(
    () => ({ enabled, status, available, notice, toggle, speak, replay, stop, setThinking: setThinkingState, getLevel, getMouth, getViseme, getFeatures, speakingText, speakingKey, getProgress }),
    [enabled, status, available, notice, toggle, speak, replay, stop, getLevel, getMouth, getViseme, getFeatures, speakingText, speakingKey, getProgress],
  );
  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}
