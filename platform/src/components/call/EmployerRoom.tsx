'use client';

import { useCallback, useEffect, useState } from 'react';

import { VoiceButton } from '@/components/chat/VoiceButton';
import { Button, Notice, cx } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { askQuestionApi, employerAudioFileUrl, employerAudioListApi, joinCallApi, leaveCallApi, muteAiApi, sayApi, type CallSnapshot } from '@/lib/defense-room-api';

import styles from './call.module.css';
import { Transcript, VerdictView } from './Transcript';
import { useCallEvents } from './useCallEvents';
import { useEmployerRecorder } from './useEmployerRecorder';
import { rtcLabel, useRtcAudio } from './useRtcAudio';

const STUN: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/** Текст предупреждения о записи для работодателя (тот же по смыслу, что EMPLOYER_RECORDING_NOTICE на сервере). */
const RECORDING_NOTICE =
  'Живая защита записывается целиком: голос кандидата и ваш голос, а также транскрипт. Запись хранится вместе с записью защиты и доступна вашей компании и кандидату. Без согласия на запись подключиться к защите нельзя.';

/** Начало защиты по транскрипту (at − tMs первой реплики): к нему привязаны смещения сегментов голоса работодателя. */
function startedAtOf(s: CallSnapshot): number | null {
  const e = s.transcript[0];
  const at = e ? Date.parse(e.at) : NaN;
  return Number.isFinite(at) ? at - (e?.tMs ?? 0) : null;
}

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
  const [recordingOk, setRecordingOk] = useState(false);
  const [joinedAt, setJoinedAt] = useState<number | null>(null);
  const getStartedAt = useCallback(() => startedAtOf(s) ?? joinedAt ?? Date.now(), [s, joinedAt]);
  // ADR 0008 п. 3: пишутся обе стороны — работодатель пишет свою дорожку сам; ошибки записи звонок не роняют.
  const rec = useEmployerRecorder({ sessionId, stream: rtc.micStream, enabled: joined && active, getStartedAt });
  const [ownAudio, setOwnAudio] = useState<{ name: string; startMs: number }[]>([]);
  useEffect(() => {
    if (active) return;
    employerAudioListApi(sessionId)
      .then((r) => setOwnAudio(r.segments))
      .catch(() => setOwnAudio([]));
  }, [active, sessionId]);

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
      const r = await joinCallApi(sessionId, recordingOk);
      setJoinedAt(Date.now());
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
        {joined && active && <span className={cx(styles.chip, rec.state === 'recording' && styles.chipOn)} data-testid="room-recording">{rec.state === 'recording' ? 'Идёт запись, включая ваш голос' : 'Идёт запись'}</span>}
        {s.aiMuted && <span className={cx(styles.chip, styles.chipWarn)}>ИИ молчит</span>}
        <span className={styles.meta}>
          Вопрос {s.progress.asked} из {s.progress.total}
        </span>
      </div>
      {active && (
        <div className={styles.toolbar}>
          {!joined ? (
            <>
              <label className={styles.meta}>
                <input type="checkbox" checked={recordingOk} onChange={(e) => setRecordingOk(e.target.checked)} data-testid="room-recording-consent" /> {RECORDING_NOTICE}
              </label>
              <Button onClick={() => void join()} loading={busy} disabled={!recordingOk} data-testid="room-join">
                Подключиться
              </Button>
            </>
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
      {joined && active && rec.error && <Notice>{rec.error}</Notice>}

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

      {!active && ownAudio.length > 0 && (
        <div className={styles.composer} data-testid="employer-audio">
          <span className={styles.who}>Голос работодателя в записи защиты</span>
          {ownAudio.map((a) => (
            <audio key={a.name} controls preload="none" src={employerAudioFileUrl(sessionId, a.name)} />
          ))}
        </div>
      )}

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
