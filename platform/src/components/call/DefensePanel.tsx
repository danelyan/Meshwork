'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { HeadView } from '@/components/avatar/HeadView';
import { CompanionVoiceProvider, useCompanionVoice } from '@/components/avatar/voice';
import { VoiceButton } from '@/components/chat/VoiceButton';
import { Button, Notice, cx } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { defenseFinishApi, defenseTurnApi, type CallSnapshot, type DefenseRoomVerdict } from '@/lib/defense-room-api';

import styles from './call.module.css';
import { Transcript, VerdictView } from './Transcript';
import { useCallEvents } from './useCallEvents';
import { useEmployerVoice } from './useEmployerVoice';
import { rtcLabel, useRtcAudio } from './useRtcAudio';

/**
 * Режим звонка защиты проекта для кандидата (ADR 0003, ступень 3). Минимальная версия до слияния с
 * `CallPanel` лейна call: аватар с озвучкой ИИ (/api/tts), реплики, микрофон (/api/stt → текст в поле),
 * реплики работодателя вторым голосом (или вживую по WebRTC P2P), итог оценщика.
 */
export function DefensePanel(props: { sessionId: string; initial: CallSnapshot; iceServers: RTCIceServer[] }) {
  return (
    <CompanionVoiceProvider autoEnable realtime>
      <Panel {...props} />
    </CompanionVoiceProvider>
  );
}

function Panel({ sessionId, initial, iceServers }: { sessionId: string; initial: CallSnapshot; iceServers: RTCIceServer[] }) {
  const voice = useCompanionVoice();
  const sayEmployer = useEmployerVoice();
  const rtc = useRtcAudio(sessionId, 'candidate', iceServers, true);
  const { close: closePeer } = rtc;
  // Вход и выход работодателя (и повторный вход) — старое соединение с ним закрывается: новое придёт новым offer.
  const onParticipant = useCallback((userId: string) => closePeer(`employer:${userId}`), [closePeer]);
  const { snapshot, lastEntry, connected, aiThinking } = useCallEvents(sessionId, initial, rtc.onSignal, onParticipant);

  useEffect(() => {
    voice?.setThinking(aiThinking);
  }, [voice, aiThinking]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<DefenseRoomVerdict | null>(initial.verdict);
  const [done, setDone] = useState(initial.transcript.at(-1)?.defense?.kind === 'closing');
  const spoken = useRef(new Set<number>(initial.transcript.map((e) => e.index)));

  const s = snapshot ?? initial;
  const finished = s.status !== 'active' || verdict !== null;
  const employer = s.participants[0];

  // Озвучить свежие реплики: ИИ — голосом аватара, работодателя — вторым голосом, если нет живого аудио.
  useEffect(() => {
    if (!lastEntry || spoken.current.has(lastEntry.index)) return;
    spoken.current.add(lastEntry.index);
    if (lastEntry.role === 'ai') voice?.speak(lastEntry.text, String(lastEntry.index));
    if (lastEntry.role === 'employer' && !rtc.anyConnected) sayEmployer(lastEntry.text);
    if (lastEntry.defense?.kind === 'closing') setDone(true);
  }, [lastEntry, voice, sayEmployer, rtc.anyConnected]);

  // Работодатель вышел — закрыть его аудио.
  const peersKey = s.participants.map((p) => p.userId).join(',');
  useEffect(() => {
    for (const [peer, st] of Object.entries(rtc.states)) if (st !== 'off' && peer.startsWith('employer:') && !peersKey.split(',').includes(peer.slice(9))) rtc.close(peer);
  }, [peersKey, rtc]);

  useEffect(() => {
    if (s.verdict) setVerdict(s.verdict);
  }, [s.verdict]);

  async function send() {
    if (busy || finished) return;
    setBusy(true);
    setError(null);
    try {
      const r = await defenseTurnApi(sessionId, text);
      setText('');
      if (r.done) setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось отправить ответ');
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      setVerdict((await defenseFinishApi(sessionId)).verdict);
      rtc.closeAll();
      voice?.stop();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Оценщик недоступен - повтори через минуту');
    } finally {
      setBusy(false);
    }
  }

  const last = [...s.transcript].reverse().find((e) => e.role !== 'candidate');
  const peerState = employer ? rtc.states[`employer:${employer.userId}`] : undefined;

  return (
    <div className={styles.page} data-testid="defense-panel">
      <div className={styles.stage}>
        <div className={styles.head}>
          <HeadView />
        </div>
        <div className={styles.side}>
          <div className={styles.chips}>
            {!finished && (
              <span className={styles.chip}>
                <span className={styles.rec} aria-hidden="true" />
                {s.mode === 'project' ? 'ИИ-защита проекта' : 'Вопросы работодателей'} · {s.progress.asked}/{s.progress.total}
              </span>
            )}
            {employer && <span className={cx(styles.chip, styles.chipOn)}>Подключился работодатель · {employer.companyName}</span>}
            {employer && <span className={cx(styles.chip, peerState === 'failed' && styles.chipWarn)}>{rtcLabel(peerState)}</span>}
            {s.aiMuted && <span className={cx(styles.chip, styles.chipWarn)}>ИИ молчит - говорит работодатель</span>}
            {!connected && !finished && <span className={styles.chip}>переподключаемся…</span>}
          </div>
          <p className={styles.subtitle} aria-live="polite">
            {last?.text ?? ''}
          </p>
          {voice && !voice.enabled && (
            <Button variant="ghost" size="sm" onClick={voice.toggle} data-voice-toggle>
              Включить голос интервьюера
            </Button>
          )}
          {employer && !rtc.micOn && !finished && (
            <Button variant="ghost" size="sm" onClick={rtc.enableMic} data-testid="defense-mic">
              Включить микрофон
            </Button>
          )}
          {rtc.micError && <Notice>{rtc.micError}</Notice>}
        </div>
      </div>

      <Transcript entries={s.transcript} selfRole="candidate" />

      {verdict ? (
        <VerdictView verdict={verdict} />
      ) : (
        <div className={styles.composer}>
          <div className={styles.row}>
            <textarea
              className={styles.input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={done ? 'Вопросы закончились - заверши защиту' : 'Ответь своими словами или надиктуй'}
              aria-label="Ответ"
              maxLength={4000}
              disabled={busy || done}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
              }}
              data-testid="defense-answer"
            />
            <VoiceButton value={text} onChange={setText} disabled={busy || done} />
            <Button onClick={() => void send()} loading={busy && !done} disabled={done} data-testid="defense-send">
              Ответить
            </Button>
          </div>
          <div className={styles.toolbar}>
            <Button variant={done ? 'cta' : 'ghost'} size="sm" onClick={() => void finish()} loading={busy && done} data-testid="defense-finish">
              {done ? 'Завершить и получить оценку' : 'Завершить досрочно'}
            </Button>
            <span className={styles.meta}>Оценку ставит отдельный оценщик по транскрипту. Защита проверяет понимание кода сейчас, а не авторство.</span>
          </div>
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
