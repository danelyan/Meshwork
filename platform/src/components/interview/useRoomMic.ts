'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { DEFAULT_VAD, MicGate, type VadEvent } from '@/lib/vad';

import { readVoiceMode, speechRecognitionCtor, toPcm16, type VoiceMode } from '../chat/voice';

/**
 * Микрофон комнаты звонка: открыт всё время (как в Zoom), фразы режет детектор речи (lib/vad.ts), а не
 * кнопка. Порог выше, пока ИИ говорит, — так кандидат перебивает голосом, а эхо из колонок нет.
 * Звук фразы (с преролом) уходит сегментом на сервер — это запись созвона и, при STT=yandex, текст.
 * При STT=browser текст даёт непрерывный Web Speech: берутся финальные результаты между speech_start и
 * speech_end (+ небольшая пауза на дозревание). Принцип — moko CallRoom + audio/gate.ts.
 */
export type RoomMicState = 'off' | 'listening' | 'speaking' | 'processing';

export interface RoomUtterance {
  /** PCM 16 кГц фразы (null — звук не писался, только Web Speech). */
  pcm: Uint8Array | null;
  /** Текст от браузера (Web Speech); null — распознаёт сервер. */
  browserText: string | null;
  durationMs: number;
}

export interface RoomMicOptions {
  /** Звучит ли сейчас ИИ (порог детектора выше). */
  isPlaying: () => boolean;
  /** Детектор подтвердил речь кандидата (перебивание решает вызывающий). */
  onSpeechStart: () => void;
  onUtterance: (u: RoomUtterance) => void | Promise<void>;
}

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

const RATE = 16_000;
const BUFFER = 2048;
/** Сколько ждать финальный результат Web Speech после конца фразы. */
const BROWSER_GRACE_MS = 1500;
/** Фраза короче — не ответ (щелчок, вдох). */
const MIN_PHRASE_MS = 300;

function audioCtor(): (new () => AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function useRoomMic(opts: RoomMicOptions) {
  const [server, setServer] = useState<VoiceMode | null>(null);
  const [state, setState] = useState<RoomMicState>('off');
  const [muted, setMutedState] = useState(false);
  const [level, setLevel] = useState(0);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const mutedRef = useRef(false);
  const stopRef = useRef<() => void>(() => {});
  const levelRef = useRef(0);

  useEffect(() => {
    setServer(readVoiceMode());
    return () => stopRef.current();
  }, []);

  const canRecord = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function' && Boolean(audioCtor());
  const browserStt = server === 'browser' && Boolean(speechRecognitionCtor());
  const available = server !== 'off' && canRecord && (server === 'yandex' || browserStt);

  const setMuted = useCallback((m: boolean) => {
    mutedRef.current = m;
    setMutedState(m);
  }, []);

  const start = useCallback(async () => {
    stopRef.current();
    setError(null);
    if (!available) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      setError('Нет доступа к микрофону - разреши его в настройках браузера или отвечай текстом.');
      return;
    }
    const ctx = new (audioCtor()!)();
    const source = ctx.createMediaStreamSource(stream);
    // ScriptProcessorNode устарел, но работает везде без отдельного модуля worklet (как в useCallMic).
    const proc = ctx.createScriptProcessor(BUFFER, 1, 1);
    const gate = new MicGate<Float32Array>({ ...DEFAULT_VAD, frameMs: (BUFFER / ctx.sampleRate) * 1000 });
    let phrase: Float32Array[] = [];
    let phraseStartedAt = 0;
    let finals = '';
    let finalsAt = 0;
    let rec: RecognitionLike | null = null;
    let listening = true;

    if (browserStt) {
      const Ctor = speechRecognitionCtor() as unknown as new () => RecognitionLike;
      rec = new Ctor();
      rec.lang = 'ru-RU';
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (e) => {
        let live = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]!;
          if (r.isFinal) {
            finals += `${r[0]!.transcript} `;
            finalsAt = Date.now();
          } else live += r[0]!.transcript;
        }
        setInterim(`${finals}${live}`.trim());
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setError('Нет доступа к микрофону - разреши его в настройках браузера.');
      };
      // Chrome закрывает распознавание после паузы — пока слушаем, запускаем снова.
      rec.onend = () => {
        if (listening) {
          try {
            rec?.start();
          } catch {
            /* уже запущено */
          }
        }
      };
      try {
        rec.start();
      } catch {
        /* повторный start */
      }
    }

    const finishPhrase = async (frames: Float32Array[], startedAt: number) => {
      const durationMs = Date.now() - startedAt;
      const startFinals = finals;
      setState('processing');
      let pcm: Uint8Array | null = frames.length ? toPcm16(frames, ctx.sampleRate, RATE) : null;
      if (pcm && pcm.byteLength < RATE * 2 * (MIN_PHRASE_MS / 1000)) pcm = null;
      let browserText: string | null = null;
      if (rec) {
        // Финальный результат может прийти чуть позже конца фразы.
        const until = Date.now() + BROWSER_GRACE_MS;
        while (Date.now() < until && (finals === startFinals || Date.now() - finalsAt < 250)) await new Promise((r) => setTimeout(r, 100));
        browserText = finals.trim() || null;
        finals = '';
        setInterim('');
      }
      if (!listening) return;
      setState('listening');
      if (pcm === null && !browserText) return;
      await optsRef.current.onUtterance({ pcm, browserText, durationMs });
    };

    const onEvent = (ev: VadEvent, send: Float32Array[]) => {
      if (ev.kind === 'speech_start') {
        phrase = send;
        phraseStartedAt = Date.now();
        finals = '';
        setState('speaking');
        optsRef.current.onSpeechStart();
      } else if (ev.kind === 'speech_end') {
        phrase.push(...send);
        const frames = phrase;
        phrase = [];
        void finishPhrase(frames, phraseStartedAt);
      }
    };

    proc.onaudioprocess = (e) => {
      if (!listening) return;
      const input = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i]! * input[i]!;
      const rms = Math.sqrt(sum / input.length);
      levelRef.current = Math.min(1, rms * 4);
      if (mutedRef.current) {
        const ended = gate.forceEnd();
        if (ended) {
          const frames = phrase;
          phrase = [];
          void finishPhrase(frames, phraseStartedAt);
        }
        return;
      }
      const frame = new Float32Array(input);
      const r = gate.step(frame, rms, optsRef.current.isPlaying());
      if (r.event) onEvent(r.event, r.send);
      else if (r.send.length) phrase.push(...r.send);
    };
    source.connect(proc);
    proc.connect(ctx.destination);

    let raf = 0;
    const meter = () => {
      setLevel(levelRef.current);
      raf = requestAnimationFrame(meter);
    };
    raf = requestAnimationFrame(meter);
    setState('listening');

    stopRef.current = () => {
      listening = false;
      cancelAnimationFrame(raf);
      proc.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      try {
        rec?.stop();
      } catch {
        /* не запущено */
      }
      void ctx.close();
      setLevel(0);
      setInterim('');
      setState('off');
      stopRef.current = () => {};
    };
  }, [available, browserStt]);

  const stop = useCallback(() => stopRef.current(), []);

  return { ready: server !== null, available, mode: server, state, muted, setMuted, level, interim, error, start, stop, clearError: () => setError(null) };
}
