'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { CompanionVoice } from '../avatar/voice';
import { type RoomUtterance, useRoomMic } from '../interview/useRoomMic';

/**
 * Созвон с Кирой как живой разговор (владелец, 11.10): без кнопки «Ответить». Микрофон открыт весь созвон,
 * фразы режет детектор речи (lib/vad.ts через useRoomMic — тот же конвейер, что в комнате интервью):
 * speech_start → копим PCM, speech_end → фраза уходит вызывающему (STT + ход). Пока Кира звучит, порог детектора
 * выше (playbackMargin, bargeInMs) — эхо из колонок не перебивает, а голос кандидата перебивает: озвучка
 * останавливается, остаток потока (CALL_STREAMING) и реплика целиком не озвучиваются («тишина», hushed),
 * пока кандидат не ответит. Ложное перебивание (фраза без текста) — Кира повторяет вопрос (onResume).
 * Микрофон закрыт (поток и AudioContext освобождены): вне созвона, в текстовом режиме, при mute, на скрытой вкладке.
 */
export type TalkState = 'off' | 'muted' | 'listening' | 'user' | 'thinking' | 'ai';

export const TALK_LABEL: Record<TalkState, string> = {
  off: 'Микрофон не подключён',
  muted: 'Микрофон выключен',
  listening: 'Слушаю',
  user: 'Вы говорите',
  thinking: 'Кира думает',
  ai: 'Кира говорит',
};

/** Потолок фразы: сервер распознаёт до STT_MAX_SECONDS = 30 с (server/stt) — режем с запасом и шлём сказанное. */
export const CALL_PHRASE_MAX_MS = 28_000;

export interface CallTalkOptions {
  /** Созвон идёт голосом (фаза live, не текстовый режим). */
  active: boolean;
  voice: CompanionVoice | null;
  /** Ход отправлен, ждём ответ Киры. */
  busy: boolean;
  /** Фраза кандидата: распознать и отправить. true — ответ принят (отправлен или поставлен в очередь), false — текста нет. */
  onPhrase: (u: RoomUtterance) => Promise<boolean> | boolean;
  /** Перебивание оказалось ложным (кашель, шум без текста): вернуть Кире слово. */
  onResume?: () => void;
}

function hiddenNow(): boolean {
  return typeof document !== 'undefined' && document.hidden;
}

export function useCallTalk(opts: CallTalkOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const [muted, setMutedState] = useState(false);
  const mutedRef = useRef(false);
  const [hidden, setHidden] = useState(hiddenNow);
  /** Кандидат перебил Киру: озвучка текущего ответа подавлена до следующего хода. */
  const hush = useRef(false);
  /** Текущая фраза началась поверх звучащей/готовящейся Киры. */
  const barged = useRef(false);

  const isPlaying = useCallback(() => {
    const s = optsRef.current.voice?.status;
    return s === 'speaking' || s === 'loading';
  }, []);

  const onSpeechStart = useCallback(() => {
    const o = optsRef.current;
    if (!isPlaying() && !o.busy) return;
    // Перебил: замолчать сразу и не досказывать поток — кандидат говорит.
    barged.current = true;
    hush.current = true;
    o.voice?.stop();
  }, [isPlaying]);

  const onUtterance = useCallback(async (u: RoomUtterance) => {
    const b = barged.current;
    barged.current = false;
    if (mutedRef.current) return;
    const accepted = await optsRef.current.onPhrase(u);
    if (!accepted && b) {
      hush.current = false;
      optsRef.current.onResume?.();
    }
  }, []);

  const mic = useRoomMic({ isPlaying, onSpeechStart, onUtterance, maxPhraseMs: CALL_PHRASE_MAX_MS });
  const micRef = useRef(mic);
  micRef.current = mic;

  useEffect(() => {
    const on = () => setHidden(hiddenNow());
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  const run = opts.active && mic.available && !muted && !hidden;
  useEffect(() => {
    if (run) void micRef.current.start();
    else micRef.current.stop();
  }, [run]);

  const setMuted = useCallback((m: boolean) => {
    mutedRef.current = m;
    barged.current = false;
    setMutedState(m);
  }, []);

  const vs = opts.voice?.status;
  const state: TalkState = !opts.active
    ? 'off'
    : muted
      ? 'muted'
      : mic.state === 'speaking'
        ? 'user'
        : mic.state === 'processing' || opts.busy
          ? 'thinking'
          : vs === 'speaking' || vs === 'loading'
            ? 'ai'
            : mic.state === 'listening'
              ? 'listening'
              : 'off';

  return {
    ready: mic.ready,
    available: mic.available,
    state,
    muted,
    setMuted,
    level: mic.level,
    interim: mic.interim,
    error: mic.error,
    stop: mic.stop,
    /** Озвучка ответа подавлена перебиванием (дельты потока и реплику целиком не озвучивать). */
    hushed: useCallback(() => hush.current, []),
    /** Новый ход кандидата: следующий ответ Киры снова озвучивается. */
    unhush: useCallback(() => {
      hush.current = false;
    }, []),
  };
}
