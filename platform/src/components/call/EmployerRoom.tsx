'use client';

import { useEffect, useState } from 'react';

import { VoiceButton } from '@/components/chat/VoiceButton';
import { Button, Notice, cx } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { askQuestionApi, joinCallApi, leaveCallApi, muteAiApi, sayApi, type CallSnapshot } from '@/lib/defense-room-api';

import styles from './call.module.css';
import { Transcript, VerdictView } from './Transcript';
import { useCallEvents } from './useCallEvents';
import { rtcLabel, useRtcAudio } from './useRtcAudio';

const STUN: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * Комната работодателя (ADR 0003): транскрипт в реальном времени, «Подключиться», «ИИ молчит/говорит»,
 * реплика текстом или голосом (STT → текст) и живое P2P-аудио с кандидатом; не поднялось — текст.
 * Вопрос «на потом» встаёт в очередь и задаётся при следующем входе кандидата.
 */
export function EmployerRoom({ sessionId, initial, candidateId, selfUserId }: { sessionId: string; initial: CallSnapshot; candidateId: string; selfUserId: string }) {
  const [ice, setIce] = useState<RTCIceServer[]>(STUN);
  const rtc = useRtcAudio(sessionId, 'employer', ice, true);
  const { snapshot, connected } = useCallEvents(sessionId, initial, rtc.onSignal);
  const s = snapshot ?? initial;
  const joined = s.participants.some((p) => p.userId === selfUserId);
  const active = s.status === 'active';
  const [text, setText] = useState('');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!active) rtc.closeAll();
  }, [active, rtc]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось');
    } finally {
      setBusy(false);
    }
  };

  const join = () =>
    run(async () => {
      const r = await joinCallApi(sessionId);
      setIce(r.webrtc.iceServers);
      // Звонит работодатель: offer уходит кандидату через сигналинг, ответ — через SSE.
      rtc.connect('candidate');
    });
  const leave = () =>
    run(async () => {
      await leaveCallApi(sessionId);
      rtc.closeAll();
    });
  const toggleMute = () => run(async () => void (await muteAiApi(sessionId, !s.aiMuted)));
  const say = () =>
    run(async () => {
      if (!text.trim()) return;
      await sayApi(sessionId, text);
      setText('');
    });
  const ask = () =>
    run(async () => {
      await askQuestionApi(candidateId, question);
      setQuestion('');
      setNote('Вопрос в очереди: кандидат увидит его при следующем входе в защиту.');
    });

  const audio = rtc.states.candidate;

  return (
    <div className={styles.side} data-testid="employer-room">
      <div className={styles.toolbar}>
        <span className={cx(styles.chip, active && styles.chipOn)}>{active ? 'Идёт сейчас' : 'Завершена'}</span>
        {active && !connected && <span className={styles.chip}>переподключаемся…</span>}
        {joined && <span className={cx(styles.chip, audio === 'failed' && styles.chipWarn)}>{rtcLabel(audio)}</span>}
        {s.aiMuted && <span className={cx(styles.chip, styles.chipWarn)}>ИИ молчит</span>}
        <span className={styles.meta}>
          Вопрос {s.progress.asked} из {s.progress.total}
        </span>
      </div>
      {active && (
        <div className={styles.toolbar}>
          {!joined ? (
            <Button onClick={() => void join()} loading={busy} data-testid="room-join">
              Подключиться
            </Button>
          ) : (
            <>
              <Button variant={s.aiMuted ? 'cta' : 'ghost'} onClick={() => void toggleMute()} disabled={busy} data-testid="room-mute">
                {s.aiMuted ? 'ИИ говорит' : 'ИИ молчит'}
              </Button>
              <Button variant="ghost" onClick={() => void leave()} disabled={busy}>
                Выйти
              </Button>
            </>
          )}
        </div>
      )}
      {rtc.micError && <Notice>{rtc.micError}</Notice>}

      <Transcript entries={s.transcript} selfRole="employer" />

      {active && joined && (
        <div className={styles.composer}>
          <div className={styles.row}>
            <textarea className={styles.input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Реплика или вопрос кандидату - он услышит её голосом" aria-label="Реплика" maxLength={1000} data-testid="room-say-input" />
            <VoiceButton value={text} onChange={setText} disabled={busy} />
            <Button onClick={() => void say()} disabled={busy || !text.trim()} data-testid="room-say">
              Сказать
            </Button>
          </div>
        </div>
      )}

      {s.verdict && <VerdictView verdict={s.verdict} />}

      <div className={styles.composer}>
        <label className={styles.who} htmlFor="ask-later">
          Вопрос на потом
        </label>
        <div className={styles.row}>
          <textarea id="ask-later" className={styles.input} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Задать кандидату при следующем входе в защиту" maxLength={1000} />
          <Button variant="ghost" onClick={() => void ask()} disabled={busy || question.trim().length < 5}>
            В очередь
          </Button>
        </div>
      </div>
      {note && <Notice>{note}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
