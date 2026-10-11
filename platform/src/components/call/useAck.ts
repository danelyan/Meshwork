'use client';

import { useCallback, useEffect, useRef } from 'react';

import { classifyAck } from '@/lib/ack-rules';
import type { AckKind, AckManifest } from '@/lib/ack-texts';

import type { CompanionVoice } from '../avatar/voice';

/**
 * Мгновенная реакция Киры («Угу…», «Та-ак…») между концом фразы кандидата и первым звуком ответа (2-5 с на STT + LLM + TTS).
 * Клипы лежат в public/ack (manifest.json, генерирует scripts/gen-ack.mts); нет файлов — молча ничего не играем.
 * Текст клипа в транскрипт не пишется: это не реплика.
 */
export const ACK_COOLDOWN_MS = 7_000;
export const ACK_SOFT_MS = 2_900;
const BASE = '/ack/';

export interface UseAckOptions {
  voice: CompanionVoice | null;
  /** Голосовой созвон идёт (live, не текстовый режим, не завершён). */
  enabled: boolean;
  /** Кандидат сейчас говорит (новая фраза отменяет «мягкий» клип). */
  userSpeaking: boolean;
  /** Подменяется в тестах. */
  random?: () => number;
}

export function useAck(opts: UseAckOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const manifest = useRef<Promise<AckManifest> | null>(null);
  const lastAt = useRef(-Infinity);
  const last = useRef<Record<string, string>>({});
  const own = useRef(false);
  const softTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback((): Promise<AckManifest> => {
    manifest.current ??= (async () => {
      const empty: AckManifest = { think: [], listen: [], soft: [] };
      try {
        const res = await fetch(`${BASE}manifest.json`);
        if (!res.ok) return empty;
        const m = (await res.json()) as Partial<AckManifest>;
        return { think: m.think ?? [], listen: m.listen ?? [], soft: m.soft ?? [] };
      } catch {
        return empty;
      }
    })();
    return manifest.current;
  }, []);

  const kiraSounds = () => {
    const s = optsRef.current.voice?.status;
    return !own.current && (s === 'speaking' || s === 'loading');
  };

  const play = useCallback(
    async (kind: AckKind) => {
      const voice = optsRef.current.voice;
      if (!voice || own.current) return;
      const files = (await load())[kind];
      if (files.length === 0) return;
      // Пока грузился манифест, Кира могла зазвучать, а кандидат - заговорить или созвон закончиться.
      if (!optsRef.current.enabled || kiraSounds() || optsRef.current.userSpeaking) return;
      const pool = files.length > 1 ? files.filter((f) => f !== last.current[kind]) : files;
      const file = pool[Math.floor((optsRef.current.random ?? Math.random)() * pool.length)] ?? pool[0];
      if (!file) return;
      last.current[kind] = file;
      own.current = true;
      try {
        console.debug('[ack]', kind, file);
        await voice.playClip(`${BASE}${file}`);
      } catch {
        /* клип не сыгран - не страшно */
      } finally {
        own.current = false;
      }
    },
    [load],
  );

  const cancel = useCallback(() => {
    if (softTimer.current) clearTimeout(softTimer.current);
    softTimer.current = null;
  }, []);

  /** Ход кандидата отправлен: бросить кубик на ack и взвести «мягкий» таймаут. */
  const onTurn = useCallback(
    (text: string) => {
      const o = optsRef.current;
      cancel();
      if (!o.enabled || !o.voice) return;
      void load(); // греем манифест
      const d = classifyAck(text);
      const now = Date.now();
      if (d.kind && now - lastAt.current >= ACK_COOLDOWN_MS && (o.random ?? Math.random)() < d.p) {
        lastAt.current = now;
        void play(d.kind);
      }
      softTimer.current = setTimeout(() => {
        softTimer.current = null;
        const c = optsRef.current;
        if (!c.enabled || c.userSpeaking || kiraSounds() || own.current) return;
        void play('soft');
      }, ACK_SOFT_MS);
    },
    [cancel, load, play],
  );

  const status = opts.voice?.status;
  useEffect(() => {
    if (status === 'speaking' && !own.current) cancel();
  }, [status, cancel]);
  useEffect(() => {
    if (opts.userSpeaking) cancel();
  }, [opts.userSpeaking, cancel]);
  useEffect(() => {
    if (!opts.enabled) cancel();
  }, [opts.enabled, cancel]);
  useEffect(() => cancel, [cancel]);

  return { onTurn, cancel };
}
