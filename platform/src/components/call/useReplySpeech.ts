'use client';

import { useCallback, useEffect, useRef } from 'react';

import { splitSentences } from '@/lib/sentences';
import { MAX_TTS_PARTS, groupParts, type TtsPart } from '@/lib/tts-parts';
import type { TranscriptEntry } from '@/server/call/types';

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

/** Замер «конец речи → первый звук» в браузере: последние значения — в window.__fspCallLatency (DevTools). */
export interface LatencySample {
  /** От конца речи (стоп записи / отправка текста) до старта воспроизведения, мс. */
  endToSoundMs: number;
  /** До первого предложения из потока; null — потока не было. */
  endToFirstDeltaMs: number | null;
  /** До прихода реплики целиком (ответ /turn или utterance). */
  endToReplyMs: number | null;
  /** Первый звук был из потока (до реплики целиком). */
  streamed: boolean;
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
export function useReplySpeech(voice: CompanionVoice | null, callId: string | undefined) {
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  /** Предложения из потока по index реплики кандидата, на которую отвечает ИИ. */
  const streams = useRef(new Map<number, { sentences: string[]; broken: boolean }>());
  const mark = useRef<{ at: number; firstDelta: number | null; reply: number | null; streamed: boolean } | null>(null);
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
      if (mark.current && mark.current.reply === null) mark.current.reply = performance.now() - mark.current.at;
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
    mark.current = { at: performance.now(), firstDelta: null, reply: null, streamed: false };
  }, []);

  const status = voice?.status;
  useEffect(() => {
    const m = mark.current;
    if (status !== 'speaking' || !m) return;
    mark.current = null;
    const sample: LatencySample = { endToSoundMs: Math.round(performance.now() - m.at), endToFirstDeltaMs: m.firstDelta === null ? null : Math.round(m.firstDelta), endToReplyMs: m.reply === null ? null : Math.round(m.reply), streamed: m.streamed };
    if (typeof window !== 'undefined') window.__fspCallLatency = [...(window.__fspCallLatency ?? []).slice(-19), sample];
    console.info('[call] задержка конец речи → первый звук', sample);
  }, [status]);

  return { onDelta, speakEntry, markSpeechEnd };
}
