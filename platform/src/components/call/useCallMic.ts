'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { micDeviceConstraint } from './devicePrefs';
import { readVoiceMode, speechRecognitionCtor, toPcm16, type VoiceMode } from '../chat/voice';

/**
 * Микрофон созвона. Голос всегда пишется через Web Audio в LPCM 16 кГц (SpeechKit v1 не принимает webm
 * из MediaRecorder; тот же путь, что у композера – chat/voice.ts) и уходит сегментом на сервер: это
 * запись созвона. Текст: при STT=yandex распознаёт сервер, при STT=browser – Web Speech API по ходу
 * речи (interim показывается в панели). Нет микрофона – только текст.
 */
export const CALL_MAX_RECORD_MS = 90_000;
const RATE = 16_000;

export type MicState = 'idle' | 'recording' | 'processing';

export interface MicResult {
  /** PCM 16 кГц (null – звук не записан, только Web Speech). */
  pcm: Uint8Array | null;
  /** Текст от браузера (Web Speech); null – распознаёт сервер. */
  browserText: string | null;
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

function audioCtor(): (new () => AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function micSupport(server: VoiceMode | null): { canRecord: boolean; browserStt: boolean; serverStt: boolean } {
  const canRecord = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function' && Boolean(audioCtor());
  const browserStt = server === 'browser' && Boolean(speechRecognitionCtor());
  return { canRecord, browserStt, serverStt: server === 'yandex' && canRecord };
}

export function useCallMic(onDone: (r: MicResult) => void) {
  const [server, setServer] = useState<VoiceMode | null>(null);
  const [state, setState] = useState<MicState>('idle');
  const [interim, setInterim] = useState('');
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<() => void>(() => {});
  const cb = useRef(onDone);
  cb.current = onDone;

  useEffect(() => {
    setServer(readVoiceMode());
    return () => stopRef.current();
  }, []);

  const support = micSupport(server);
  const available = server !== 'off' && (support.serverStt || support.browserStt);

  const start = useCallback(async () => {
    setError(null);
    setInterim('');
    const sup = micSupport(server);
    let stream: MediaStream | null = null;
    if (sup.canRecord) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, ...micDeviceConstraint() } });
      } catch {
        if (!sup.browserStt) {
          setError('Нет доступа к микрофону - разреши его в настройках браузера или ответь текстом.');
          return;
        }
      }
    }
    const chunks: Float32Array[] = [];
    let ctx: AudioContext | null = null;
    let proc: ScriptProcessorNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let raf = 0;
    if (stream) {
      ctx = new (audioCtor()!)();
      source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      // ScriptProcessorNode устарел, но работает во всех браузерах без отдельного модуля worklet.
      proc = ctx.createScriptProcessor(4096, 1, 1);
      proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      source.connect(analyser);
      source.connect(proc);
      proc.connect(ctx.destination);
      const data = new Uint8Array(analyser.fftSize);
      const meter = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
        raf = requestAnimationFrame(meter);
      };
      raf = requestAnimationFrame(meter);
    }

    let rec: RecognitionLike | null = null;
    let finalText = '';
    let recEnded: Promise<void> = Promise.resolve();
    if (sup.browserStt) {
      const Ctor = speechRecognitionCtor() as unknown as new () => RecognitionLike;
      rec = new Ctor();
      rec.lang = 'ru-RU';
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (e) => {
        let live = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]!;
          if (r.isFinal) finalText += `${r[0]!.transcript} `;
          else live += r[0]!.transcript;
        }
        setInterim(`${finalText}${live}`.trim());
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setError('Нет доступа к микрофону - разреши его в настройках браузера.');
      };
      const r = rec;
      recEnded = new Promise((resolve) => {
        r.onend = () => resolve();
      });
      rec.start();
    }

    const t0 = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - t0), 250);
    let stopped = false;
    const stop = async () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      clearTimeout(limit);
      cancelAnimationFrame(raf);
      proc?.disconnect();
      source?.disconnect();
      stream?.getTracks().forEach((t) => t.stop());
      setLevel(0);
      setState('processing');
      if (rec) {
        rec.stop();
        // Web Speech отдаёт последние финальные результаты до onend.
        await Promise.race([recEnded, new Promise((r) => setTimeout(r, 1500))]);
      }
      const pcm = ctx ? toPcm16(chunks, ctx.sampleRate, RATE) : null;
      void ctx?.close();
      setState('idle');
      if (pcm && pcm.byteLength < RATE * 2 * 0.3 && !finalText.trim()) {
        setError('Слишком коротко - нажми и скажи ответ ещё раз.');
        return;
      }
      cb.current({ pcm: pcm && pcm.byteLength >= RATE * 2 * 0.3 ? pcm : null, browserText: rec ? finalText.trim() || null : null });
    };
    const limit = setTimeout(() => void stop(), CALL_MAX_RECORD_MS);
    stopRef.current = () => void stop();
    setElapsed(0);
    setState('recording');
  }, [server]);

  const stop = useCallback(() => stopRef.current(), []);

  return { ready: server !== null, available, mode: server, state, interim, level, elapsed, error, start, stop, clearError: () => setError(null) };
}
