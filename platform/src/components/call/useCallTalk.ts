'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { type AiStatus, decideInterrupt, type InterruptDecision } from '../../lib/interrupt';
import type { CompanionVoice } from '../avatar/voice';
import { type RoomUtterance, useRoomMic } from '../interview/useRoomMic';

/**
 * Созвон с Кирой как живой разговор (владелец, 11.10): без кнопки «Ответить». Микрофон открыт весь созвон,
 * фразы режет детектор речи (lib/vad.ts через useRoomMic – тот же конвейер, что в комнате интервью):
 * speech_start → копим PCM, speech_end → фраза уходит вызывающему (STT + ход). Пока Кира звучит, порог детектора
 * выше (playbackMargin, bargeInMs) – эхо из колонок не перебивает. Начало речи поверх Киры её только приглушает
 * (duck), а не останавливает: решение принимается по тексту фразы (lib/interrupt.ts). Поддакивание или шум –
 * громкость возвращается, Кира не прерывалась. Команда «стоп/подождите» – замолчать всегда, ходом не отправлять.
 * Осмысленная речь поверх звучащей Киры – озвучка останавливается, остаток потока и реплика не озвучиваются
 * («тишина», hushed) до следующего хода; пока Кира думает/грузит – не рвать, фраза уходит следующим ходом.
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

/** Потолок фразы: сервер распознаёт до STT_MAX_SECONDS = 30 с (server/stt) – режем с запасом и шлём сказанное. */
export const CALL_PHRASE_MAX_MS = 28_000;

export interface CallTalkOptions {
  /** Созвон идёт голосом (фаза live, не текстовый режим). */
  active: boolean;
  voice: CompanionVoice | null;
  /** Ход отправлен, ждём ответ Киры. */
  busy: boolean;
  /**
   * Фраза кандидата: распознать, затем спросить decide(text) и действовать по решению: ignore/hard – не отправлять,
   * queue – отложить до конца ответа Киры, interrupt/turn – отправить (или в очередь, если ход ещё идёт).
   * Возврат: true – ответ принят, false – нет.
   */
  onPhrase: (u: RoomUtterance, decide: (text: string) => InterruptDecision) => Promise<boolean> | boolean;
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
  /** Статус Киры в начале текущей фразы, если она звучала/готовилась (null – молчала). */
  const barged = useRef<AiStatus | null>(null);
  /** Кира приглушена (duck) на время фразы и её распознавания. */
  const ducked = useRef(false);

  const isPlaying = useCallback(() => {
    const s = optsRef.current.voice?.status;
    return s === 'speaking' || s === 'loading';
  }, []);

  const aiStatus = useCallback((): AiStatus => {
    const o = optsRef.current;
    const s = o.voice?.status;
    if (s === 'speaking' || s === 'loading') return s;
    return o.busy || s === 'thinking' ? 'thinking' : 'idle';
  }, []);

  const unduck = useCallback(() => {
    if (!ducked.current) return;
    ducked.current = false;
    optsRef.current.voice?.duck(false);
  }, []);

  const onSpeechStart = useCallback(() => {
    const st = aiStatus();
    if (st === 'idle') return;
    barged.current = st;
    // Не рвать сразу: приглушить, пока не ясно, что сказано (поддакивание, команда или ответ).
    if (isPlaying()) {
      ducked.current = true;
      optsRef.current.voice?.duck(true);
    }
  }, [aiStatus, isPlaying]);

  const onUtterance = useCallback(
    async (u: RoomUtterance) => {
      const started = barged.current;
      barged.current = null;
      if (mutedRef.current) {
        unduck();
        return;
      }
      let decided = false;
      const decide = (text: string): InterruptDecision => {
        decided = true;
        const now = aiStatus();
        // Кира договорила, пока шло распознавание, – фраза всё равно была сказана поверх неё.
        const d = decideInterrupt({ text, aiStatus: now === 'idle' && started ? started : now });
        if (d === 'hard' || d === 'interrupt') {
          ducked.current = false;
          hush.current = true;
          optsRef.current.voice?.stop();
        } else unduck();
        return d;
      };
      try {
        await optsRef.current.onPhrase(u, decide);
      } finally {
        // Текста не было (шум, кашель): Кира не прерывалась – просто вернуть громкость.
        if (!decided) unduck();
      }
    },
    [aiStatus, unduck],
  );

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
    barged.current = null;
    unduck();
    setMutedState(m);
  }, [unduck]);

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
