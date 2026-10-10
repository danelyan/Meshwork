'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/lib/api';
import { callApi, subscribeCallEvents } from '@/lib/call-api';
import type { CallVerdict, CallView, TranscriptEntry } from '@/server/call/types';

import { HeadView } from '../avatar/HeadView';
import { MuteToggle, StateChip } from '../avatar/Speaking';
import { useCompanionVoice } from '../avatar/voice';
import { Spinner, cx } from '../ui';

import styles from './CallPanel.module.css';
import { useCallMode } from './CallContext';
import { DepthMap } from './DepthMap';
import { useCallMic } from './useCallMic';

type Phase = 'loading' | 'consent' | 'starting' | 'live' | 'finishing' | 'done' | 'error';

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function merge(list: TranscriptEntry[], add: (TranscriptEntry | null | undefined)[]): TranscriptEntry[] {
  const byIndex = new Map(list.map((e) => [e.index, e]));
  for (const e of add) if (e) byIndex.set(e.index, e);
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

/**
 * Режим звонка в сцене консультанта (ADR 0003, ступень 1). Согласие на запись перед первым звонком,
 * затем: голова говорит вопрос ИИ (тот же голос и липсинк — /api/tts), текст реплики снизу, микрофон
 * (запись сегмента + распознавание), «Текстом», индикатор записи, «Завершить» → карта глубины.
 */
export function CallPanel() {
  const mode = useCallMode();
  const voice = useCompanionVoice();
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const [phase, setPhase] = useState<Phase>('loading');
  const [consentText, setConsentText] = useState<string[]>([]);
  const [consentVersion, setConsentVersion] = useState('');
  const [call, setCall] = useState<CallView | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [closing, setClosing] = useState(false);
  /** Идут дополнительные вопросы по темам, где оценщик не определился. */
  const [extra, setExtra] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const spoken = useRef(new Set<string>());

  const begin = useCallback(async () => {
    setPhase('starting');
    setError(null);
    try {
      const r = await callApi.start();
      setCall(r.call);
      setTranscript(r.call.transcript ?? []);
      setPhase('live');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'call_consent_required') return setPhase('consent');
      setError(e instanceof Error ? e.message : 'Не удалось начать созвон');
      setPhase('error');
    }
  }, []);

  // Открытие: согласие → старт (или продолжение активного созвона).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await callApi.list();
        if (!alive) return;
        setConsentText(list.consent.text);
        setConsentVersion(list.consent.version);
        if (!list.consent.given) return setPhase('consent');
        await begin();
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'Созвон сейчас недоступен');
        setPhase('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [begin]);

  // События созвона: реплики из других вкладок и (позже) работодателя в комнате.
  const id = call?.id;
  useEffect(() => {
    if (!id) return;
    return subscribeCallEvents(id, (ev) => {
      if (ev.type === 'utterance') setTranscript((t) => merge(t, [ev.entry]));
      if (ev.type === 'snapshot' && ev.call.transcript) {
        const tr = ev.call.transcript;
        setTranscript((t) => merge(t, tr));
      }
    });
  }, [id]);

  // Новая реплика ИИ — озвучить один раз (ключ = созвон + номер реплики).
  const lastAi = [...transcript].reverse().find((e) => e.role === 'ai');
  useEffect(() => {
    if (!lastAi || !id) return;
    const key = `call-${id}-${lastAi.index}`;
    if (spoken.current.has(key)) return;
    spoken.current.add(key);
    voiceRef.current?.speak(lastAi.text, key);
  }, [lastAi, id]);

  useEffect(() => {
    voice?.setThinking(busy);
  }, [busy, voice]);

  useEffect(() => {
    if (phase !== 'live') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const send = useCallback(
    async (input: { text?: string; audioRef?: string }) => {
      if (!id) return;
      setBusy(true);
      setError(null);
      voiceRef.current?.stop();
      try {
        const r = await callApi.turn(id, input);
        setTranscript((t) => merge(t, [r.candidate, r.ai]));
        if (r.done) setClosing(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ответ не отправился - попробуй ещё раз');
      } finally {
        setBusy(false);
      }
    },
    [id],
  );

  const mic = useCallMic(async ({ pcm, browserText }) => {
    if (!id) return;
    let audioRef: string | undefined;
    let text = browserText ?? '';
    if (pcm) {
      try {
        const a = await callApi.audio(id, pcm);
        audioRef = a.audioRef;
        if (!text) text = a.text ?? '';
      } catch (e) {
        if (!text) {
          setError(e instanceof Error ? e.message : 'Запись не сохранилась - ответь текстом');
          return;
        }
      }
    }
    if (!text.trim()) {
      setError('Не расслышал ответ - скажи ещё раз или ответь текстом.');
      return;
    }
    await send({ text, ...(audioRef ? { audioRef } : {}) });
  });

  const finish = async () => {
    if (!id) return;
    mic.stop();
    voiceRef.current?.stop();
    setPhase('finishing');
    setError(null);
    try {
      const v = await callApi.finish(id);
      setCall(v);
      if (v.status === 'active') {
        // Оценщик разошёлся по какой-то теме: созвон продолжается дополнительным вопросом.
        setTranscript((t) => merge(t, v.transcript ?? []));
        setClosing(false);
        setExtra(true);
        setPhase('live');
        return;
      }
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Оценщик сейчас недоступен - попробуй ещё раз');
      setPhase('live');
    }
  };

  const acceptConsent = async () => {
    setError(null);
    try {
      await callApi.consent(consentVersion);
      await begin();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Согласие не записалось');
    }
  };

  const last = transcript[transcript.length - 1];
  const awaiting = Boolean(last && last.role === 'ai' && last.meta) && !busy;
  const answered = transcript.filter((e) => e.role === 'candidate').length;
  const lastCandidate = [...transcript].reverse().find((e) => e.role === 'candidate');
  const startedAt = call ? new Date(call.startedAt).getTime() : now;
  const canFinish = answered > 0 && !busy && mic.state === 'idle';
  const progress = call?.progress;

  return (
    <section className={styles.panel} aria-label="Созвон с ИИ-интервьюером" data-testid="call-panel" data-phase={phase}>
      <header className={styles.top}>
        <span className={styles.badge}>Квалифицирующий созвон</span>
        {(phase === 'live' || phase === 'finishing') && (
          <span className={styles.rec} role="status" data-testid="call-rec">
            <i className={styles.recDot} aria-hidden="true" />
            Запись {mmss(now - startedAt)}
          </span>
        )}
        {phase === 'live' && progress && (
          <span className={styles.count}>
            ответов {answered} · вопросов {progress.minQuestions}–{progress.maxQuestions}
          </span>
        )}
        <span className={styles.topRight}>
          {phase === 'live' && <StateChip />}
          <MuteToggle />
          <button type="button" className={styles.close} onClick={mode?.close} aria-label="Свернуть звонок" title="Свернуть: созвон останется активным">
            ×
          </button>
        </span>
      </header>

      <div className={styles.head}>
        <HeadView />
      </div>

      <div className={styles.body}>
        {phase === 'loading' || phase === 'starting' ? (
          <p className={styles.wait}>
            <Spinner /> {phase === 'loading' ? 'Подключаюсь…' : 'Интервьюер готовит первый вопрос…'}
          </p>
        ) : null}

        {phase === 'consent' && (
          <div className={styles.consent} data-testid="call-consent">
            <b>Перед первым созвоном - согласие на запись</b>
            {mode?.reason && <p className={styles.reason}>{mode.reason}</p>}
            {consentText.map((p) => (
              <p key={p}>{p}</p>
            ))}
            <div className={styles.row}>
              <button type="button" className={styles.primary} onClick={() => void acceptConsent()}>
                Согласен, начать созвон
              </button>
              <button type="button" className={styles.ghost} onClick={mode?.close}>
                Не сейчас
              </button>
            </div>
          </div>
        )}

        {(phase === 'live' || phase === 'finishing') && (
          <>
            <p className={styles.line} aria-live="polite" data-testid="call-ai-line">
              {busy ? 'Интервьюер думает…' : lastAi?.text}
            </p>
            {mic.state === 'recording' && mic.interim ? (
              <p className={styles.mine}>{mic.interim}</p>
            ) : lastCandidate && !awaiting && busy ? (
              <p className={styles.mine}>{lastCandidate.text}</p>
            ) : null}
            {extra && !closing && <p className={styles.hint}>Ещё вопрос: по одной из тем ответы пока не дают однозначной оценки.</p>}
            {closing && <p className={styles.hint}>Вопросы закончились - нажми «Завершить».</p>}
            {phase === 'finishing' && (
              <p className={styles.wait}>
                <Spinner /> Оценщик разбирает ответы (три независимых прогона, при расхождении - пять)…
              </p>
            )}
          </>
        )}

        {phase === 'done' && call?.verdict && (
          <div className={styles.result}>
            <b>Карта глубины</b>
            <DepthMap verdict={call.verdict as CallVerdict} dark />
            {(call.verdict as CallVerdict).upgradedCatalogIds?.length ? (
              <p className={styles.hint}>Подтверждённые утверждения получили уровень «проверено платформой».</p>
            ) : null}
            <div className={styles.row}>
              <a className={styles.primary} href="/profile">
                Открыть профиль
              </a>
              <button type="button" className={styles.ghost} onClick={mode?.close}>
                Вернуться в чат
              </button>
            </div>
          </div>
        )}
        {phase === 'done' && !call?.verdict && <p className={styles.hint}>Ответов не было - созвон закрыт без оценки.</p>}

        {(error || mic.error) && (
          <p className={styles.error} role="alert">
            {error ?? mic.error}
          </p>
        )}
        {phase === 'error' && (
          <div className={styles.row}>
            <button type="button" className={styles.ghost} onClick={() => void begin()}>
              Повторить
            </button>
          </div>
        )}
      </div>

      {(phase === 'live' || phase === 'finishing') && (
        <footer className={styles.controls}>
          {typing && (
            <form
              className={styles.typeRow}
              onSubmit={(e) => {
                e.preventDefault();
                const t = draft.trim();
                if (!t || !awaiting) return;
                setDraft('');
                void send({ text: t });
              }}
            >
              <label className={styles.srOnly} htmlFor="call-answer">
                Ответ текстом
              </label>
              <input id="call-answer" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ответ текстом" maxLength={4000} autoComplete="off" />
              <button type="submit" className={styles.primary} disabled={!awaiting || !draft.trim()}>
                Ответить
              </button>
            </form>
          )}
          <div className={styles.bar}>
            {mic.available && (
              <button
                type="button"
                className={cx(styles.ctl, styles.mic, mic.state === 'recording' && styles.recording)}
                onClick={() => (mic.state === 'recording' ? mic.stop() : void mic.start())}
                disabled={(!awaiting && mic.state !== 'recording') || mic.state === 'processing' || phase === 'finishing'}
                aria-pressed={mic.state === 'recording'}
                aria-label={mic.state === 'recording' ? 'Закончить ответ' : 'Ответить голосом'}
                style={{ '--level': mic.level.toFixed(2) } as React.CSSProperties}
                data-testid="call-mic"
              >
                {mic.state === 'processing' ? <Spinner /> : <MicIcon />}
                <span>{mic.state === 'recording' ? `Готово ${mmss(mic.elapsed)}` : 'Ответить'}</span>
              </button>
            )}
            <button type="button" className={cx(styles.ctl, typing && styles.ctlOn)} onClick={() => setTyping((v) => !v)} aria-pressed={typing}>
              <KeyboardIcon />
              <span>Текстом</span>
            </button>
            <button type="button" className={cx(styles.ctl, styles.end)} onClick={() => void finish()} disabled={!canFinish || phase === 'finishing'} data-testid="call-finish">
              <EndIcon />
              <span>Завершить</span>
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}

function MicIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="square" />
    </svg>
  );
}
function KeyboardIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" />
      <path d="M7 10h1M11 10h1M15 10h1M7 14h10" strokeLinecap="square" />
    </svg>
  );
}
function EndIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 14c5-4 13-4 18 0l-2 3-4-1v-3c-2-.6-4-.6-6 0v3l-4 1z" strokeLinejoin="round" />
    </svg>
  );
}
