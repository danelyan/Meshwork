'use client';

import { useCallback, useEffect, useRef } from 'react';

import { parseKey, ttsParts, keyOf, sentencesHeard, type TtsPart } from '@/lib/tts-parts';

import type { CompanionVoice } from '../avatar/voice';

// Нарезка на части вынесена в общий модуль (панель созвона консультанта озвучивает так же): lib/tts-parts.ts.
export { MAX_TTS_PARTS, keyOf, parseKey, sentencesHeard, ttsParts, type TtsPart } from '@/lib/tts-parts';

/**
 * Озвучка реплик ИИ по предложениям поверх голоса компаньона (/api/tts, тот же липсинк головы): каждое
 * предложение — отдельная озвучка в очереди, так перебивание режет реплику по предложениям и сервер
 * получает, сколько их прозвучало (POST /api/call/{id}/interrupt). Ложное перебивание (поддакивание)
 * продолжает с первого непрозвучавшего предложения. Принцип — moko pipeline.py + player.ts.
 */
export function useSentenceSpeech(voice: CompanionVoice | null) {
  const parts = useRef(new Map<number, TtsPart[]>());
  /** Сколько частей реплики начало звучать (по speakingKey при status=speaking). */
  const heard = useRef(new Map<number, number>());
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  useEffect(() => {
    if (!voice || voice.status !== 'speaking') return;
    const k = parseKey(voice.speakingKey);
    if (!k) return;
    heard.current.set(k.index, Math.max(heard.current.get(k.index) ?? 0, k.part + 1));
  }, [voice, voice?.speakingKey, voice?.status]);

  const say = useCallback((index: number, text: string, from = 0) => {
    const v = voiceRef.current;
    const list = parts.current.get(index) ?? ttsParts(text);
    parts.current.set(index, list);
    if (from === 0) heard.current.set(index, 0);
    if (!v) return;
    for (let i = from; i < list.length; i++) if (list[i]!.text) v.speak(list[i]!.text, keyOf(index, i));
  }, []);

  const replay = useCallback((index: number, text: string) => {
    const v = voiceRef.current;
    if (!v) return;
    v.stop();
    const list = parts.current.get(index) ?? ttsParts(text);
    parts.current.set(index, list);
    heard.current.set(index, 0);
    list.forEach((p, i) => (i === 0 ? v.replay(p.text, keyOf(index, 0)) : v.speak(p.text, keyOf(index, i))));
  }, []);

  const stop = useCallback(() => voiceRef.current?.stop(), []);

  /**
   * Продолжить реплику после ложного перебивания. Часть, на которой остановились, уже посчитана начатой,
   * но не доиграна — её повторяем целиком, дальше по очереди.
   */
  const resume = useCallback(
    (index: number, text: string) => {
      const started = heard.current.get(index) ?? 0;
      const from = Math.max(0, started - 1);
      heard.current.set(index, from);
      say(index, text, from);
    },
    [say],
  );

  /** Сколько частей начало звучать (как moko: начатый чанк — услышанный). */
  const heardOf = useCallback((index: number) => heard.current.get(index) ?? 0, []);
  /** Сколько предложений сервера прозвучало — для POST /interrupt. */
  const heardSentencesOf = useCallback((index: number) => sentencesHeard(parts.current.get(index) ?? [], heard.current.get(index) ?? 0), []);
  const partsOf = useCallback((index: number) => parts.current.get(index)?.length ?? 0, []);
  const isPlaying = useCallback(() => {
    const s = voiceRef.current?.status;
    return s === 'speaking' || s === 'loading';
  }, []);

  return { say, replay, stop, resume, heardOf, heardSentencesOf, partsOf, isPlaying };
}
