'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/lib/api';
import { callApi, subscribeCallEvents } from '@/lib/call-api';
import type { CallVerdict, CallView, TranscriptEntry } from '@/server/call/types';
import { blockDef, competencyById } from '@/server/interview/model';
import { INTERVIEW_LIMITS, clarificationHint, stageOf } from '@/server/interview/plan';


import { HeadView } from '../avatar/HeadView';
import { MuteToggle, StateChip } from '../avatar/Speaking';
import { useCompanionVoice } from '../avatar/voice';
import { Criteria, ResultCard, Stages } from '../interview/InterviewPage';
import { SKIP_ANSWER, summaryOf, turnsOf } from '../interview/helpers';
import { Spinner, cx } from '../ui';

import styles from './CallPanel.module.css';
import { useCallMode } from './CallContext';
import { DepthMap } from './DepthMap';
import { DevicePreflight } from './DevicePreflight';
import { TALK_LABEL, useCallTalk } from './useCallTalk';
import { useReplySpeech } from './useReplySpeech';
import { ObjectionButton } from '../consent/ObjectionButton';

type Phase = 'loading' | 'consent' | 'devices' | 'starting' | 'live' | 'finishing' | 'done' | 'error';

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
  const kind = mode?.kind ?? 'qualifying';
  const interview = kind === 'interview';
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
  /** Согласие на запись отозвано (ADR 0005): созвон без записи голоса, ответы только текстом. */
  const [textOnly, setTextOnly] = useState(false);
  /** Причина текстового режима: отозванное согласие или выбор/отказ на шаге проверки устройств. */
  const [textWhy, setTextWhy] = useState<'consent' | 'devices'>('consent');
  const textOnlyRef = useRef(false);
  /** Шаг проверки устройств пройден в этой панели (повторно перед «Пройти ещё раз» не показываем). */
  const devicesDone = useRef(false);
  /** Микрофон вообще не нужен (голос выключен на сервере или нет поддержки) - проверку пропускаем. */
  const micUnneeded = useRef(false);
  const [draft, setDraft] = useState('');
  const [closing, setClosing] = useState(false);
  /** Идут дополнительные вопросы по темам, где оценщик не определился. */
  const [extra, setExtra] = useState(false);
  /** ИИнтервью: подсказка «Уточнить вопрос» к реплике ИИ с этим index (клиент, не ответ кандидата). */
  const [hint, setHint] = useState<{ index: number; text: string } | null>(null);
  const replays = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  const spoken = useRef(new Set<string>());

  const begin = useCallback(async () => {
    setPhase('starting');
    setError(null);
    setClosing(false);
    setHint(null);
    if (interview) {
      // Новое интервью после завершённого: сбросить состояние прошлого.
      setCall(null);
      setTranscript([]);
    }
    try {
      const r = await callApi.start(kind);
      setCall(r.call);
      setTranscript(r.call.transcript ?? []);
      setPhase('live');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'call_consent_required') return setPhase('consent');
      setError(e instanceof Error ? e.message : 'Не удалось начать созвон');
      setPhase('error');
    }
  }, [kind, interview]);

  // После согласия: проверка устройств → старт. Текстовый режим по согласию и «голос выключен» шаг пропускают.
  const proceed = useCallback(async () => {
    if (textOnlyRef.current || devicesDone.current || micUnneeded.current) return begin();
    setPhase('devices');
  }, [begin]);

  // Открытие: согласие → старт (или продолжение активного созвона).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await callApi.list(kind);
        if (!alive) return;
        setConsentText(list.consent.text);
        setConsentVersion(list.consent.version);
        // ИИнтервью: уже пройденное показываем итогом (кнопка «Пройти ещё раз»), а не стартуем заново.
        const lastDone = interview && !list.calls.some((c) => c.status === 'active') ? list.calls.find((c) => c.status === 'finished') : null;
        if (lastDone) {
          setCall(lastDone);
          setTranscript(lastDone.transcript ?? []);
          return setPhase('done');
        }
        if (list.consent.mode === 'text') {
          textOnlyRef.current = true;
          setTextOnly(true);
          setTyping(true);
        } else if (!list.consent.given) return setPhase('consent');
        await proceed();
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'Созвон сейчас недоступен');
        setPhase('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [begin, proceed, kind, interview]);

  // События созвона: реплики из других вкладок и (позже) работодателя в комнате.
  const id = call?.id;
  const reply = useReplySpeech(voice, id);
  const onDelta = reply.onDelta;
  const markSpeechEnd = reply.markSpeechEnd;

  // Свободный разговор: микрофон открыт весь созвон, фразы режет детектор речи (useCallTalk).
  const busyRef = useRef(false);
  busyRef.current = busy;
  const sendRef = useRef<(input: { text?: string; audioRef?: string }) => Promise<void>>(async () => {});
  const pending = useRef<{ text: string; audioRef?: string } | null>(null);
  const talk = useCallTalk({
    active: phase === 'live' && !textOnly,
    voice,
    busy,
    onPhrase: async ({ pcm, browserText }) => {
      if (!id) return false;
      markSpeechEnd();
      let audioRef: string | undefined;
      let text = browserText ?? '';
      if (pcm) {
        try {
          const a = await callApi.audio(id, pcm);
          audioRef = a.audioRef;
          if (!text) text = a.text ?? '';
        } catch (e) {
          if (!text) setError(e instanceof Error ? e.message : 'Запись не сохранилась - ответь текстом');
        }
      }
      // Шум без слов — не ответ: молча слушаем дальше.
      if (!text.trim()) return false;
      if (busyRef.current) {
        // Кира ещё думает: договорённое уходит следующим ходом.
        const p = pending.current;
        pending.current = { text: p ? `${p.text} ${text}` : text, ...((p?.audioRef ?? audioRef) ? { audioRef: p?.audioRef ?? audioRef } : {}) };
        return true;
      }
      await sendRef.current({ text, ...(audioRef ? { audioRef } : {}) });
      return true;
    },
    onResume: () => {
      const ai = lastAiRef.current;
      if (busyRef.current || !ai || !id) return;
      replays.current += 1;
      voiceRef.current?.speak(ai.text, `call-${id}-${ai.index}-again${replays.current}`);
    },
  });
  const hushed = talk.hushed;
  const unhush = talk.unhush;
  useEffect(() => {
    if (!id) return;
    return subscribeCallEvents(id, (ev) => {
      if (ev.type === 'utterance_delta' && !hushed()) onDelta(ev.afterIndex, ev.n, ev.text);
      if (ev.type === 'utterance') setTranscript((t) => merge(t, [ev.entry]));
      if (ev.type === 'snapshot' && ev.call.transcript) {
        const tr = ev.call.transcript;
        setTranscript((t) => merge(t, tr));
      }
    });
  }, [id, onDelta, hushed]);

  // Новая реплика ИИ — озвучить один раз (ключ = созвон + номер реплики), по предложениям (useReplySpeech).
  const speakEntry = reply.speakEntry;
  const lastAi = [...transcript].reverse().find((e) => e.role === 'ai');
  const lastAiRef = useRef(lastAi);
  lastAiRef.current = lastAi;
  useEffect(() => {
    if (!lastAi || !id) return;
    const key = `call-${id}-${lastAi.index}`;
    if (spoken.current.has(key)) return;
    spoken.current.add(key);
    if (hushed()) return; // кандидат перебил — ответ виден текстом, но не звучит поверх него
    speakEntry(lastAi);
  }, [lastAi, id, speakEntry, hushed]);

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
      if (!input.audioRef) markSpeechEnd(); // текстом: конец «речи» — отправка
      unhush();
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
    [id, markSpeechEnd, unhush],
  );
  sendRef.current = send;

  const finish = async () => {
    if (!id) return;
    talk.stop();
    pending.current = null;
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
        setExtra(!interview);
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
      await proceed();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Согласие не записалось');
    }
  };

  micUnneeded.current = talk.ready && !talk.available;
  // Голос выключен на сервере / нет поддержки (стало известно уже на шаге проверки) - проверять нечего.
  const micIdle = talk.ready && !talk.available;
  useEffect(() => {
    if (phase === 'devices' && micIdle) {
      devicesDone.current = true;
      void begin();
    }
  }, [phase, micIdle, begin]);

  const last = transcript[transcript.length - 1];
  const awaiting = Boolean(last && last.role === 'ai' && last.meta) && !busy;
  const answered = transcript.filter((e) => e.role === 'candidate').length;
  const lastCandidate = [...transcript].reverse().find((e) => e.role === 'candidate');
  const startedAt = call ? new Date(call.startedAt).getTime() : now;
  const canFinish = answered > 0 && !busy;
  const canAnswer = Boolean(last && last.role === 'ai' && last.meta) && !closing && phase === 'live';
  // Фраза, сказанная пока Кира думала, уходит, как только ответ пришёл.
  useEffect(() => {
    if (busy || !canAnswer || !pending.current) return;
    const p = pending.current;
    pending.current = null;
    void send(p);
  }, [busy, canAnswer, send]);
  const progress = call?.progress;
  const summary = interview ? summaryOf(call?.verdict) : null;
  const stage = phase === 'done' ? 'summary' : stageOf(turnsOf(transcript), closing);
  const aiBlock = (e: TranscriptEntry | undefined) => (interview && e?.meta?.block ? blockDef(e.meta.block).title : null);
  const canAct = awaiting && !closing && phase === 'live';
  const replay = () => {
    if (!lastAi) return;
    replays.current += 1;
    voice?.replay(lastAi.text, `call-${id}-${lastAi.index}-r${replays.current}`);
  };
  const clarify = () => {
    const c = lastAi?.meta?.competencyId ? competencyById(lastAi.meta.competencyId) : null;
    if (lastAi && c) setHint({ index: lastAi.index, text: clarificationHint(c, lastAi.meta!.level) });
  };

  return (
    <section className={styles.panel} aria-label="Созвон с ИИ-интервьюером" data-testid="call-panel" data-phase={phase}>
      <header className={styles.top}>
        <span className={styles.badge}>{'Созвон с ИИ'}</span>
        {(phase === 'live' || phase === 'finishing') && (
          <span className={styles.rec} role="status" data-testid="call-rec">
            <i className={styles.recDot} aria-hidden="true" />
            Запись {mmss(now - startedAt)}
          </span>
        )}
        {phase === 'live' && interview && (
          <span className={styles.count} data-testid="interview-progress">
            {blockDef(stage).title} · вопрос {Math.min(answered + 1, INTERVIEW_LIMITS.maxQuestions)} из {INTERVIEW_LIMITS.minQuestions}–{INTERVIEW_LIMITS.maxQuestions}
          </span>
        )}
        {phase === 'live' && !interview && progress && (
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

        {phase === 'devices' && (
          <DevicePreflight
            primaryClass={styles.primary}
            ghostClass={styles.ghost}
            onReady={() => {
              devicesDone.current = true;
              void begin();
            }}
            onTextOnly={() => {
              devicesDone.current = true;
              textOnlyRef.current = true;
              setTextWhy('devices');
              setTextOnly(true);
              setTyping(true);
              void begin();
            }}
            onCancel={mode?.close}
          />
        )}

        {phase === 'consent' && (
          <div className={styles.consent} data-testid="call-consent">
            <b>{interview ? 'Перед созвоном с ИИ - согласие на запись' : 'Перед первым созвоном - согласие на запись'}</b>
            {mode?.reason && <p className={styles.reason}>{mode.reason}</p>}
            {/* Коротко — суть; полный текст свёрнут (владелец 11.10: «компактно и просто ссылки на оферту») */}
            <ul className={styles.consentList}>
              <li>Голос и расшифровка записываются только для оценки ответов; по голосу личность не определяется.</li>
              <li>Работодатель до принятого приглашения видит только оценки по темам; запись и транскрипт — после твоего «да».</li>
              <li>Аудио хранится 90 дней; согласие можно отозвать в настройках («Мои согласия»).</li>
            </ul>
            <div className={styles.consentLinks}>
              <details className={styles.consentFull}>
                <summary>Полный текст согласия</summary>
                {consentText.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </details>
              <a href="/consent" target="_blank" rel="noreferrer">Условия обработки данных</a>
            </div>
            <div className={styles.row}>
              <button type="button" className={styles.primary} onClick={() => void acceptConsent()}>
                Согласиться и начать созвон
              </button>
              <button type="button" className={styles.ghost} onClick={mode?.close}>
                Не сейчас
              </button>
            </div>
          </div>
        )}

        {(phase === 'live' || phase === 'finishing') && (
          <>
            {!busy && aiBlock(lastAi) && (
              <p className={styles.stage} data-testid="call-block">
                {aiBlock(lastAi)}
              </p>
            )}
            <p className={styles.line} aria-live="polite" data-testid="call-ai-line">
              {busy ? 'Интервьюер думает…' : lastAi?.text}
            </p>
            {interview && !busy && hint && lastAi && hint.index === lastAi.index && (
              <p className={styles.hint} role="note" data-testid="call-hint">
                {hint.text}
              </p>
            )}
            {interview && (
              <details className={styles.steps} data-testid="interview-steps">
                <summary>Этапы и критерии · сейчас: {blockDef(stage).title}</summary>
                <div className={styles.sheet}>
                  <Stages current={stage} />
                  <Criteria summary={summary} />
                </div>
              </details>
            )}
            {talk.available && !textOnly && phase === 'live' && (
              <p className={styles.hint} role="status" data-testid="call-talk-state" data-state={talk.state}>
                {TALK_LABEL[talk.state]}
              </p>
            )}
            {talk.state === 'user' && talk.interim ? (
              <p className={styles.mine}>{talk.interim}</p>
            ) : lastCandidate && !awaiting && busy ? (
              <p className={styles.mine}>{lastCandidate.text}</p>
            ) : null}
            {extra && !closing && <p className={styles.hint}>Ещё вопрос: по одной из тем ответы пока не дают однозначной оценки.</p>}
            {closing && <p className={styles.hint}>Вопросы закончились - нажми «Завершить».</p>}
            {phase === 'finishing' && (
              <p className={styles.wait}>
                <Spinner /> {interview ? 'Собираю оценку по компетенциям…' : 'Оценщик разбирает ответы (три независимых прогона, при расхождении - пять)…'}
              </p>
            )}
          </>
        )}

        {phase === 'done' && interview && summary && call && (
          <div className={styles.sheet} data-testid="interview-result">
            <ResultCard summary={summary} disclaimer={call.disclaimer} />
            <Criteria summary={summary} />
            <div className={styles.row}>
              <button type="button" className={styles.sheetBtn} onClick={() => void proceed()}>
                Пройти ещё раз
              </button>
              <button type="button" className={styles.sheetBtn} onClick={mode?.close}>
                Вернуться в чат
              </button>
            </div>
          </div>
        )}
        {phase === 'done' && interview && !summary && (
          <>
            <p className={styles.hint}>Интервью закрыто без оценки: ответов не было или оценщик был недоступен.</p>
            <div className={styles.row}>
              <button type="button" className={styles.primary} onClick={() => void proceed()}>
                Пройти ещё раз
              </button>
              <button type="button" className={styles.ghost} onClick={mode?.close}>
                Вернуться в чат
              </button>
            </div>
          </>
        )}
        {phase === 'done' && !interview && call?.verdict && (
          <div className={styles.result}>
            <b>Карта глубины</b>
            <DepthMap verdict={call.verdict as CallVerdict} dark />
            {(call.verdict as CallVerdict).upgradedCatalogIds?.length ? (
              <p className={styles.hint}>Подтверждённые утверждения получили уровень «проверено платформой».</p>
            ) : null}
            <div className={styles.hint}>
              <ObjectionButton subject={call.kind === 'defense' ? 'defense' : 'call'} subjectId={call.id} />
            </div>
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
        {phase === 'done' && !interview && !call?.verdict && <p className={styles.hint}>Ответов не было - созвон закрыт без оценки.</p>}

        {textOnly && (phase === 'live' || phase === 'starting') && (
          <p className={styles.hint} data-testid="call-text-mode">
            {textWhy === 'consent' ? 'Запись голоса отключена в «Моих согласиях» - созвон идёт текстом, аудио не сохраняется.' : 'Созвон идёт текстом: микрофон не проверен или недоступен. Голос можно включить, начав созвон заново.'}
          </p>
        )}
        {(error || talk.error) && (
          <p className={styles.error} role="alert">
            {error ?? talk.error}
            {/consent|согласи/i.test(error ?? '') && (
              <>
                {' '}
                <a href="/settings#consents">Мои согласия</a>
              </>
            )}
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
          {interview && (
            <div className={styles.quick} data-testid="interview-quick">
              <button type="button" className={styles.chip} disabled={!lastAi || !voice} onClick={replay}>
                Повторить вопрос
              </button>
              <button type="button" className={styles.chip} disabled={!canAct || !lastAi?.meta?.competencyId} onClick={clarify}>
                Уточнить вопрос
              </button>
              <button type="button" className={styles.chip} disabled={!canAct} onClick={() => void send({ text: SKIP_ANSWER })}>
                Пропустить
              </button>
            </div>
          )}
          <div className={styles.bar}>
            {talk.available && !textOnly && (
              <button
                type="button"
                className={cx(styles.ctl, styles.mic, talk.state === 'user' && styles.recording)}
                onClick={() => talk.setMuted(!talk.muted)}
                disabled={phase === 'finishing'}
                aria-pressed={!talk.muted}
                aria-label={talk.muted ? 'Включить микрофон' : 'Выключить микрофон'}
                style={{ '--level': talk.level.toFixed(2) } as React.CSSProperties}
                data-testid="call-mic"
              >
                <MicIcon />
                <span>{talk.muted ? 'Микрофон выкл' : 'Микрофон вкл'}</span>
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
