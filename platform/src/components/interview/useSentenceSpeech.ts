'use client';

import { useCallback, useEffect, useRef } from 'react';

import { splitSentences } from '@/lib/sentences';
import { speechText } from '@/lib/speech-text';

import type { CompanionVoice } from '../avatar/voice';

/** Предложений на реплику в очереди TTS — не больше: лимит /api/tts — 20 запросов в минуту на сессию. */
export const MAX_TTS_PARTS = 4;

/** Реплика → куски для озвучки: предложения, при избытке соседние склеиваются. */
export function ttsParts(text: string): string[] {
  const s = splitSentences(speechText(text));
  if (s.length <= MAX_TTS_PARTS) return s;
  const per = Math.ceil(s.length / MAX_TTS_PARTS);
  const out: string[] = [];
  for (let i = 0; i < s.length; i += per) out.push(s.slice(i, i + per).join(' '));
  return out;
}

export const keyOf = (index: number, part: number) => `u${index}:${part}`;
export function parseKey(key: string | null): { index: number; part: number } | null {
  const m = key && /^u(\d+):(\d+)$/.exec(key);
  return m ? { index: Number(m[1]), part: Number(m[2]) } : null;
}

/**
 * Озвучка реплик ИИ по предложениям поверх голоса компаньона (/api/tts, тот же липсинк головы): каждое
 * предложение — отдельная озвучка в очереди, так перебивание режет реплику по предложениям и сервер
 * получает, сколько их прозвучало (POST /api/call/{id}/interrupt). Ложное перебивание (поддакивание)
 * продолжает с первого непрозвучавшего предложения. Принцип — moko pipeline.py + player.ts.
 */
export function useSentenceSpeech(voice: CompanionVoice | null) {
  const parts = useRef(new Map<number, string[]>());
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
    for (let i = from; i < list.length; i++) v.speak(list[i]!, keyOf(index, i));
  }, []);

  const replay = useCallback((index: number, text: string) => {
    const v = voiceRef.current;
    if (!v) return;
    v.stop();
    const list = parts.current.get(index) ?? ttsParts(text);
    parts.current.set(index, list);
    heard.current.set(index, 0);
    list.forEach((p, i) => (i === 0 ? v.replay(p, keyOf(index, 0)) : v.speak(p, keyOf(index, i))));
  }, []);

  const stop = useCallback(() => voiceRef.current?.stop(), []);

  /** Продолжить реплику после ложного перебивания — с первого непрозвучавшего предложения. */
  const resume = useCallback(
    (index: number, text: string) => {
      const from = heard.current.get(index) ?? 0;
      say(index, text, from);
    },
    [say],
  );

  const heardOf = useCallback((index: number) => heard.current.get(index) ?? 0, []);
  const partsOf = useCallback((index: number) => parts.current.get(index)?.length ?? 0, []);
  const isPlaying = useCallback(() => {
    const s = voiceRef.current?.status;
    return s === 'speaking' || s === 'loading';
  }, []);

  return { say, replay, stop, resume, heardOf, partsOf, isPlaying };
}
