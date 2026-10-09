'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Голосовой ввод композера. Режим приходит с сервера (`<body data-stt>`, env STT_PROVIDER; то же — GET /api/stt):
 *  - yandex — запись через Web Audio в LPCM 16 бит 16 кГц (SpeechKit v1 не принимает webm, который
 *    отдаёт MediaRecorder в Chrome), стоп → POST /api/stt → текст в поле;
 *  - browser — Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`, ru-RU): текст
 *    появляется в поле по ходу речи, распознаёт браузер (в Chrome — облако Google), так и подписываем;
 *  - off — кнопки нет. Браузер без нужного API — кнопка неактивна с объяснением.
 * Микрофон спрашиваем только по клику. Текст не отправляется сам — человек правит и жмёт «Отправить».
 */
export type VoiceMode = 'yandex' | 'browser' | 'off';
export type VoiceState = 'idle' | 'recording' | 'processing';

export const MAX_RECORD_MS = 30_000;
const TARGET_RATE = 16_000;

/** Режим с сервера: `<body data-stt>` (app/layout.tsx); без атрибута — browser (поведение STT_PROVIDER=auto без ключей). */
export function readVoiceMode(): VoiceMode {
  if (typeof document === 'undefined') return 'off';
  const v = document.body?.dataset.stt;
  return v === 'yandex' || v === 'off' ? v : 'browser';
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function audioContextCtor(): (new () => AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Что реально доступно в этом браузере при режиме сервера. */
export function effectiveMode(server: VoiceMode): { mode: VoiceMode; reason?: string } {
  if (server === 'off') return { mode: 'off' };
  if (server === 'yandex') {
    if (typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function' && audioContextCtor()) return { mode: 'yandex' };
    return { mode: 'off', reason: 'Браузер не даёт доступ к микрофону' };
  }
  return speechRecognitionCtor() ? { mode: 'browser' } : { mode: 'off', reason: 'Этот браузер не умеет распознавать речь - попробуй Chrome или Safari' };
}

/** Float32-куски с частотой inRate → LPCM 16 бит little-endian с частотой outRate (усреднение окна). */
export function toPcm16(chunks: Float32Array[], inRate: number, outRate = TARGET_RATE): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.length;
  }
  const ratio = inRate / outRate;
  const outLen = Math.floor(total / ratio);
  const buf = new ArrayBuffer(outLen * 2);
  const view = new DataView(buf);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(total, Math.floor((i + 1) * ratio)) || start + 1;
    let sum = 0;
    for (let j = start; j < end; j++) sum += all[j]!;
    const v = Math.max(-1, Math.min(1, sum / (end - start)));
    view.setInt16(i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/**
 * Хук кнопки микрофона. `onText(text, final)` — распознанный текст (в browser-режиме — по ходу речи).
 * `level` 0..1 — уровень сигнала для простой визуализации (yandex-режим), в browser-режиме — null.
 */
export function useVoiceInput(onText: (text: string, final: boolean) => void) {
  const [server, setServer] = useState<VoiceMode | null>(null);
  const [state, setState] = useState<VoiceState>('idle');
  const [level, setLevel] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const stopRef = useRef<() => void>(() => {});
  const cb = useRef(onText);
  cb.current = onText;

  useEffect(() => {
    setServer(readVoiceMode());
    return () => stopRef.current();
  }, []);

  const avail = server ? effectiveMode(server) : { mode: 'off' as VoiceMode };

  const startBrowser = useCallback(() => {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'ru-RU';
    rec.interimResults = true;
    rec.continuous = true;
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) finalText += r[0]!.transcript;
        else interim += r[0]!.transcript;
      }
      cb.current((finalText + interim).trim(), false);
    };
    rec.onerror = (e) => {
      setError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Нет доступа к микрофону - разреши его в настройках браузера.' : e.error === 'no-speech' ? 'Ничего не услышал - попробуй ещё раз.' : 'Распознавание сорвалось - напиши текстом.');
    };
    rec.onend = () => {
      clearInterval(timer);
      clearTimeout(limit);
      setState('idle');
      if (finalText.trim()) cb.current(finalText.trim(), true);
    };
    const t0 = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - t0), 250);
    const limit = setTimeout(() => rec.stop(), MAX_RECORD_MS);
    stopRef.current = () => rec.stop();
    setElapsed(0);
    setState('recording');
    rec.start();
  }, []);

  const startYandex = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch {
      setError('Нет доступа к микрофону - разреши его в настройках браузера.');
      return;
    }
    const Ctx = audioContextCtor()!;
    const ctx = new Ctx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    // ScriptProcessorNode устарел, но работает везде и не требует отдельного модуля worklet.
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    source.connect(analyser);
    source.connect(proc);
    proc.connect(ctx.destination);
    const data = new Uint8Array(analyser.fftSize);
    let raf = 0;
    const meter = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      raf = requestAnimationFrame(meter);
    };
    raf = requestAnimationFrame(meter);
    const t0 = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - t0), 250);
    let stopped = false;
    const stop = async () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      clearTimeout(limit);
      cancelAnimationFrame(raf);
      proc.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      setLevel(null);
      const pcm = toPcm16(chunks, ctx.sampleRate);
      void ctx.close();
      if (pcm.byteLength < TARGET_RATE * 2 * 0.3) {
        setState('idle');
        setError('Слишком коротко - подержи кнопку подольше.');
        return;
      }
      setState('processing');
      try {
        const res = await fetch('/api/stt', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'audio/l16; rate=16000' }, body: pcm as unknown as BodyInit });
        const body = (await res.json().catch(() => ({}))) as { text?: string; message?: string; error?: { message?: string } };
        if (!res.ok) throw new Error(body.error?.message ?? body.message ?? 'Распознавание сейчас недоступно - напиши текстом.');
        if (body.text) cb.current(body.text, true);
        else setError('Ничего не разобрал - попробуй ещё раз.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Распознавание сейчас недоступно - напиши текстом.');
      } finally {
        setState('idle');
      }
    };
    const limit = setTimeout(() => void stop(), MAX_RECORD_MS);
    stopRef.current = () => void stop();
    setElapsed(0);
    setState('recording');
  }, []);

  const start = useCallback(() => {
    setError(null);
    if (avail.mode === 'browser') startBrowser();
    else if (avail.mode === 'yandex') void startYandex();
  }, [avail.mode, startBrowser, startYandex]);

  const stop = useCallback(() => stopRef.current(), []);

  return { ready: server !== null, mode: avail.mode, reason: avail.reason, hidden: server === 'off', state, level, error, elapsed, start, stop, clearError: () => setError(null) };
}
