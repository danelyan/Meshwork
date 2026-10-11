'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/lib/api';
import { callApi, subscribeCallEvents } from '@/lib/call-api';
import type { CallVerdict, CallView, TranscriptEntry } from '@/server/call/types';
import { blockDef, competencyById } from '@/server/interview/model';
import { INTERVIEW_LIMITS, clarificationHint, stageOf } from '@/server/interview/plan';


import { HeadView } from '../avatar/HeadView';
import { StateChip } from '../avatar/Speaking';
import { useCompanionVoice } from '../avatar/voice';
import { Criteria, ResultCard, Stages } from '../interview/InterviewPage';
import { SKIP_ANSWER, summaryOf, turnsOf } from '../interview/helpers';
import { useFaceTracking } from '../interview/useFaceTracking';
import { Spinner, cx } from '../ui';

import styles from './CallPanel.module.css';
import { useCallMode } from './CallContext';
import { DepthMap } from './DepthMap';
import { DevicePreflight } from './DevicePreflight';
import { useAck } from './useAck';
import { TALK_LABEL, useCallTalk } from './useCallTalk';
import { useReplySpeech } from './useReplySpeech';
import { ObjectionButton } from '../consent/ObjectionButton';
import { useCamera } from '../interview/useCamera';

type Phase = 'loading' | 'consent' | 'devices' | 'starting' | 'live' | 'finishing' | 'done' | 'error';
/** Лимит созвона по времени: подсказка и автозавершение (владелец 11.10). */
export const CALL_SOFT_LIMIT_MS = 12 * 60_000;
export const CALL_HARD_LIMIT_MS = 15 * 60_000;

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
  // Созвон живёт внутри общего провайдера консультанта: пока панель открыта, синтез идёт быстрой моделью.
  const setRealtime = voice?.setRealtime;
  useEffect(() => {
    setRealtime?.(true);
    return () => setRealtime?.(false);
  }, [setRealtime]);
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
  /** Камера в созвоне: выбор со шага проверки устройств (по умолчанию выключена) — включается, когда созвон пошёл. */
  const wantCamera = useRef(false);
  /** Согласие на запись действует (Г2): без него видео не пишем, кнопки камеры нет (сервер тоже отвергает). */
  const [recordingConsent, setRecordingConsent] = useState(true);
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
          setRecordingConsent(false);
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
    onPhrase: async ({ pcm, browserText }, decide) => {
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
      // Семантический фильтр (lib/interrupt.ts): поддакивание поверх Киры и команда «стоп» — не ход.
      const d = decide(text);
      if (d === 'ignore' || d === 'hard') return false;
      if (busyRef.current || d === 'queue') {
        // Кира ещё думает или готовит озвучку: договорённое уходит следующим ходом, ответ звучит целиком.
        const p = pending.current;
        pending.current = { text: p ? `${p.text} ${text}` : text, ...((p?.audioRef ?? audioRef) ? { audioRef: p?.audioRef ?? audioRef } : {}) };
        return true;
      }
      await sendRef.current({ text, ...(audioRef ? { audioRef } : {}) });
      return true;
    },
  });
  const ack = useAck({ voice, enabled: phase === 'live' && !textOnly, userSpeaking: talk.state === 'user' });
  const onAckTurn = ack.onTurn;
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

  // Камера кандидата (созвон с Кирой): тот же хук и тот же маршрут POST /api/call/{id}/video, что в комнате интервью.
  const callRef = useRef(call);
  callRef.current = call;
  const cameraAllowed = kind === 'qualifying' && recordingConsent;
  const camera = useCamera({
    getCallId: () => callRef.current?.id ?? null,
    getStartedAt: () => (callRef.current ? Date.parse(callRef.current.startedAt) : null),
    deniedText: 'Нет доступа к камере - разреши её в настройках браузера. Созвон идёт без видео.',
  });
  const startCamera = camera.start;
  // Голова Киры поворачивается за лицом кандидата с камеры (как в комнате интервью); только на его экране.
  useFaceTracking(camera.getVideo, camera.state === 'on' && phase === 'live');
  useEffect(() => {
    if (phase !== 'live' || !id || !wantCamera.current || !cameraAllowed) return;
    wantCamera.current = false;
    void startCamera();
  }, [phase, id, cameraAllowed, startCamera]);

  const send = useCallback(
    async (input: { text?: string; audioRef?: string }) => {
      if (!id) return;
      if (!input.audioRef) markSpeechEnd(); // текстом: конец «речи» — отправка
      unhush();
      setBusy(true);
      setError(null);
      voiceRef.current?.stop();
      if (input.text) onAckTurn(input.text);
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
    [id, markSpeechEnd, unhush, onAckTurn],
  );
  sendRef.current = send;

  const finish = async () => {
    if (!id) return;
    talk.stop();
    ack.cancel();
    pending.current = null;
    voiceRef.current?.stop();
    // Последний сегмент видео дописываем, пока созвон ещё активен (после finish сервер видео не примет).
    await camera.stop();
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
  // Лимит по времени (решение владельца 11.10): с 12 минут - подсказка завершить, в 15 завершаем сами,
  // когда кандидат не говорит и Кира не думает; оценка строится по уже данным ответам.
  const elapsedMs = now - startedAt;
  const overSoft = phase === 'live' && elapsedMs > CALL_SOFT_LIMIT_MS;
  const overHard = phase === 'live' && elapsedMs > CALL_HARD_LIMIT_MS;
  const canAnswer = Boolean(last && last.role === 'ai' && last.meta) && !closing && phase === 'live';
  // Фраза, сказанная пока Кира думала, уходит, когда ответ пришёл и прозвучал (send() останавливает озвучку).
  // Пауза — чтобы озвучка ответа успела начаться (статус loading), прежде чем решить, что Кира молчит.
  const voiceStatus = voice?.status;
  useEffect(() => {
    if (busy || !canAnswer || !pending.current) return;
    if (voiceStatus === 'speaking' || voiceStatus === 'loading') return;
    const t = setTimeout(() => {
      const s = voiceRef.current?.status;
      if (s === 'speaking' || s === 'loading' || !pending.current) return;
      const p = pending.current;
      pending.current = null;
      void send(p);
    }, 150);
    return () => clearTimeout(t);
  }, [busy, canAnswer, send, voiceStatus]);
  const talkState = talk.state;
  useEffect(() => {
    if (!overHard || !canFinish || busy || talkState === 'user') return;
    void finish();
    // finish стабилен по id созвона; зависимости - только условия
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overHard, canFinish, busy, talkState]);
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
            {/* Текстовый режим: аудио не сохраняется (подсказка ниже) - только таймер, без точки и слова «Запись». */}
            {!textOnly && <i className={styles.recDot} aria-hidden="true" />}
            {textOnly ? mmss(now - startedAt) : `Запись ${mmss(now - startedAt)}`} / {mmss(CALL_HARD_LIMIT_MS)}
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
          <button type="button" className={styles.close} onClick={mode?.close} aria-label="Свернуть звонок" title="Свернуть: созвон останется активным">
            ×
          </button>
        </span>
      </header>

      <div className={styles.head}>
        <HeadView />
        {(camera.state === 'on' || camera.state === 'starting') && (phase === 'live' || phase === 'finishing') && (
          <video ref={camera.attach} className={styles.selfView} muted playsInline autoPlay aria-label="Ваша камера" data-testid="call-camera-preview" />
        )}
      </div>

      <div className={styles.body}>
        {phase === 'loading' || phase === 'starting' ? (
          <p className={styles.wait}>
            <Spinner /> {phase === 'loading' ? 'Подключаюсь…' : 'Интервьюер готовит первый вопрос…'}
          </p>
        ) : null}

        {phase === 'devices' && (
          <DevicePreflight
            withCamera={cameraAllowed}
            cameraJoinsCall
            primaryClass={styles.primary}
            ghostClass={styles.ghost}
            onReady={(o) => {
              wantCamera.current = Boolean(o?.camera);
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
            {camera.error && (
              <p className={styles.hint} role="status" data-testid="call-camera-error">
                {camera.error}
              </p>
            )}
            {extra && !closing && <p className={styles.hint}>Ещё вопрос: по одной из тем ответы пока не дают однозначной оценки.</p>}
            {closing && <p className={styles.hint}>Вопросы закончились - нажми «Завершить».</p>}
            {overSoft && !closing && (
              <p className={styles.hint} role="status" data-testid="call-time-hint">
                Созвон идёт дольше {Math.round(CALL_SOFT_LIMIT_MS / 60000)} минут - лучше завершить: оценка строится по уже данным ответам. В {Math.round(CALL_HARD_LIMIT_MS / 60000)} минут завершу сама.
              </p>
            )}
            {phase === 'finishing' && (
              <p className={styles.wait}>
                <Spinner /> Подвожу итоги созвона - обычно это меньше минуты…
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
            <b>Созвон завершён - карта глубины</b>
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
            {cameraAllowed && camera.supported && (
              <button
                type="button"
                className={cx(styles.ctl, camera.state === 'on' && styles.ctlOn)}
                onClick={() => void (camera.state === 'on' ? camera.stop() : camera.start())}
                disabled={camera.state === 'starting' || phase !== 'live'}
                aria-pressed={camera.state === 'on'}
                title="Видео записывается вместе с аудио созвона; никакая модель его не анализирует"
                data-testid="call-camera"
              >
                <CameraIcon />
                <span>{camera.state === 'on' ? 'Камера вкл' : 'Камера'}</span>
              </button>
            )}
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
function CameraIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="7" width="12" height="10" />
      <path d="M15 11l6-3v8l-6-3z" strokeLinejoin="round" />
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
