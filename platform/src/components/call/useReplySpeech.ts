'use client';

import { useCallback, useEffect, useRef } from 'react';

import { splitSentences } from '@/lib/sentences';
import { MAX_TTS_PARTS, groupParts, type TtsPart } from '@/lib/tts-parts';
import type { ClientTurnTiming, TranscriptEntry } from '@/server/call/types';

import type { CompanionVoice } from '../avatar/voice';

/**
 * Что ещё озвучить из реплики ИИ, если первые предложения уже прозвучали потоком (SSE utterance_delta).
 * Сервер гарантирует, что реплика начинается с отданных предложений (server/call/stream.ts); если нет —
 * `mismatch`, и озвучивается всё после уже сказанного по счёту (лучше договорить, чем повторить).
 * Остаток укладывается в бюджет частей: лимит /api/tts — 20 запросов в минуту на сессию.
 */
export function planRest(text: string, streamed: readonly string[], maxParts = MAX_TTS_PARTS): { from: number; parts: TtsPart[]; mismatch: boolean } {
  const all = splitSentences(text);
  const from = Math.min(streamed.length, all.length);
  const mismatch = streamed.some((s, i) => all[i] !== s);
  const budget = Math.max(1, maxParts - from);
  return { from, parts: groupParts(all.slice(from), budget), mismatch };
}

/**
 * Замер «конец речи → первый звук» в браузере (телеметрия созвона): водопад ClientTurnTiming плюс index реплики ИИ,
 * которая зазвучала. Последние значения — в window.__fspCallLatency (DevTools); панель шлёт их в
 * POST /api/call/{id}/telemetry (onSample).
 */
export interface LatencySample extends ClientTurnTiming {
  /** Реплика ИИ, которой принадлежит первый звук; -1 — неизвестно (звук из потока до ответа /turn). */
  index: number;
}

declare global {
  interface Window {
    __fspCallLatency?: LatencySample[];
  }
}

/**
 * Озвучка реплик ИИ в панели созвона консультанта по предложениям (лейн call-speed, 11.10): каждое предложение —
 * отдельная озвучка в очереди голоса компаньона (voice.tsx: синтез следующего грузится, пока звучит текущее;
 * все части играют через тот же AnalyserNode — липсинк головы работает как раньше). В потоковом режиме
 * (CALL_STREAMING) предложения приходят по SSE до конца генерации и звучат сразу, реплика целиком
 * досказывает остаток.
 */
export function useReplySpeech(voice: CompanionVoice | null, callId: string | undefined, onSample?: (s: LatencySample) => void) {
  const onSampleRef = useRef(onSample);
  onSampleRef.current = onSample;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  /** Предложения из потока по index реплики кандидата, на которую отвечает ИИ. */
  const streams = useRef(new Map<number, { sentences: string[]; broken: boolean }>());
  const mark = useRef<{ at: number; upload: number | null; firstDelta: number | null; reply: number | null; streamed: boolean; ack: number | null; index: number } | null>(null);
  /** index последней озвученной реплики ИИ целиком: дельты к более ранним репликам кандидата опоздали. */
  const lastEntry = useRef(-1);

  const onDelta = useCallback(
    (afterIndex: number, n: number, text: string) => {
      // Дельта пришла по SSE позже ответа /turn (разные соединения): реплика уже озвучена целиком — не повторять.
      if (afterIndex < lastEntry.current) return;
      const cur = streams.current.get(afterIndex) ?? { sentences: [], broken: false };
      streams.current.set(afterIndex, cur);
      // Пропуск в нумерации (обрыв SSE): дальше поток не озвучиваем, остаток доскажет реплика целиком.
      if (cur.broken || n !== cur.sentences.length) {
        cur.broken = true;
        return;
      }
      cur.sentences.push(text);
      if (mark.current && mark.current.firstDelta === null) {
        mark.current.firstDelta = performance.now() - mark.current.at;
        mark.current.streamed = true;
        if (mark.current.index < 0) mark.current.index = afterIndex + 1; // реплика ИИ идёт сразу за репликой кандидата
      }
      voiceRef.current?.speak(text, `call-${callId}-${afterIndex}-s${n}`);
    },
    [callId],
  );

  const speakEntry = useCallback(
    (entry: TranscriptEntry) => {
      const v = voiceRef.current;
      lastEntry.current = Math.max(lastEntry.current, entry.index);
      // Поток этой реплики — последний по index кандидата, который раньше неё.
      let after = -1;
      for (const k of streams.current.keys()) if (k < entry.index && k > after) after = k;
      const streamed = after >= 0 ? streams.current.get(after)!.sentences : [];
      for (const k of [...streams.current.keys()]) if (k <= after) streams.current.delete(k);
      if (mark.current && mark.current.reply === null) {
        mark.current.reply = performance.now() - mark.current.at;
        mark.current.index = entry.index;
      }
      const plan = planRest(entry.text, streamed);
      if (plan.mismatch) console.warn('[call] поток и реплика разошлись — досказываю по счёту');
      plan.parts.forEach((p, i) => {
        if (p.text) v?.speak(p.text, `call-${callId}-${entry.index}-p${plan.from + i}`);
      });
    },
    [callId],
  );

  /** Кандидат закончил говорить (стоп записи) или отправил текст: с этого момента меряем задержку. */
  const markSpeechEnd = useCallback(() => {
    mark.current = { at: performance.now(), upload: null, firstDelta: null, reply: null, streamed: false, ack: null, index: -1 };
  }, []);
  /** Сегмент загружен и распознан (/audio вернул ответ). */
  const markUploaded = useCallback(() => {
    if (mark.current && mark.current.upload === null) mark.current.upload = performance.now() - mark.current.at;
  }, []);
  /** Сыграл мгновенный ack из банка (useAck). */
  const markAck = useCallback(() => {
    if (mark.current && mark.current.ack === null) mark.current.ack = performance.now() - mark.current.at;
  }, []);

  const status = voice?.status;
  useEffect(() => {
    const m = mark.current;
    if (status !== 'speaking' || !m) return;
    mark.current = null;
    const r = (v: number | null) => (v === null ? null : Math.round(v));
    const sample: LatencySample = {
      index: m.index,
      uploadMs: r(m.upload),
      endToFirstDeltaMs: r(m.firstDelta),
      endToReplyMs: r(m.reply),
      endToSoundMs: Math.round(performance.now() - m.at),
      streamed: m.streamed,
      ackMs: r(m.ack),
    };
    if (typeof window !== 'undefined') window.__fspCallLatency = [...(window.__fspCallLatency ?? []).slice(-19), sample];
    console.info('[call] задержка конец речи → первый звук', sample);
    onSampleRef.current?.(sample);
  }, [status]);

  return { onDelta, speakEntry, markSpeechEnd, markUploaded, markAck };
}
