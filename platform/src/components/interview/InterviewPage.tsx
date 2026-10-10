'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/lib/api';
import { callApi, subscribeCallEvents } from '@/lib/call-api';
import { isBackchannel } from '@/lib/sentences';
import type { CallVerdict, CallView, PublicCallVerdict, TranscriptEntry } from '@/server/call/types';
import { AXES, AXIS_LABEL, BLOCK_DEFS, type BlockId, blockDef, competencyById } from '@/server/interview/model';
import { INTERVIEW_LIMITS, type InterviewTurn, clarificationHint, stageOf } from '@/server/interview/plan';
import type { InterviewSummary } from '@/server/interview/types';

import { HeadView } from '../avatar/HeadView';
import { CompanionVoiceProvider, useCompanionVoice } from '../avatar/voice';
import { Button, Spinner, cx } from '../ui';

import styles from './InterviewRoom.module.css';
import { type RoomUtterance, useRoomMic } from './useRoomMic';
import { useSentenceSpeech } from './useSentenceSpeech';

type Phase = 'loading' | 'intro' | 'consent' | 'starting' | 'live' | 'finishing' | 'done' | 'error';

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function merge(list: TranscriptEntry[], add: (TranscriptEntry | null | undefined)[]): TranscriptEntry[] {
  const byIndex = new Map(list.map((e) => [e.index, e]));
  for (const e of add) if (e) byIndex.set(e.index, e);
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

/** Пары вопрос → ответ из транскрипта для расчёта этапа (без сервера). */
function turnsOf(transcript: readonly TranscriptEntry[]): InterviewTurn[] {
  const out: InterviewTurn[] = [];
  for (const e of transcript) {
    if (e.role === 'ai' && e.meta?.competencyId && e.meta.block) {
      out.push({ question: e.text, answer: null, competencyId: e.meta.competencyId, block: e.meta.block, level: e.meta.level, ...(e.meta.probe ? { probe: true } : {}) });
    } else if (e.role === 'candidate') {
      const last = out[out.length - 1];
      if (last) last.answer = (last.answer ?? '') + e.text;
    }
  }
  return out;
}

const QUESTION_BLOCKS = BLOCK_DEFS.filter((b) => b.questions.max > 0);

/** Ход этапов: пройденные, текущий, будущие (мокап: ✓ / номер / «сейчас»). */
export function Stages({ current }: { current: BlockId }) {
  const idx = BLOCK_DEFS.findIndex((b) => b.id === current);
  return (
    <div className={styles.stages}>
      {BLOCK_DEFS.map((b, k) => (
        <div key={b.id} className={k < idx ? styles.done : k === idx ? styles.cur : undefined} aria-current={k === idx ? 'step' : undefined}>
          <b>{k < idx ? '✓' : k + 1}</b>
          {b.title}
          <small>{k === idx ? 'сейчас' : k < idx ? '' : b.questions.max ? `${b.questions.min}–${b.questions.max} вопр.` : ''}</small>
        </div>
      ))}
    </div>
  );
}

/** Четыре критерия с полосками: до вердикта — «—», после — проценты по осям. */
export function Criteria({ summary }: { summary: InterviewSummary | null }) {
  return (
    <div className={styles.crit}>
      {AXES.map((axis) => {
        const score = summary?.axes.find((a) => a.axis === axis)?.score ?? null;
        return (
          <div key={axis}>
            <span>
              {AXIS_LABEL[axis]}
              <em>{score === null ? '—' : `${score}%`}</em>
            </span>
            <i role="img" aria-label={`${AXIS_LABEL[axis]}: ${score === null ? 'не проверено' : `${score} из 100`}`}>
              <u style={{ width: `${score ?? 0}%` }} />
            </i>
          </div>
        );
      })}
    </div>
  );
}

function summaryOf(v: CallVerdict | PublicCallVerdict | null | undefined): InterviewSummary | null {
  return v && 'interview' in v && v.interview ? v.interview : null;
}

/** Итоговая карточка (мокап: «Middle подтверждён · итог 84/100» → у нас соответствие по интервью, без вердикта о грейде). */
export function ResultCard({ summary, disclaimer }: { summary: InterviewSummary; disclaimer: string }) {
  const probed = summary.competencies.filter((c) => c.status !== 'not_probed');
  const label = (s: InterviewSummary['competencies'][number]) =>
    s.status === 'confirmed' ? `подтверждено · ${s.demonstrated ?? ''}` : s.status === 'inconclusive' ? 'не определено' : 'не подтверждено';
  return (
    <div className={styles.result} role="status">
      <div className={styles.resultTop}>
        <b>{summary.gradeFit.text}</b>
        <span>{summary.overall === null ? 'итог не рассчитан' : `итог ${summary.overall} / 100`}</span>
      </div>
      <ul>
        {summary.strengths.length > 0 && <li>Сильные стороны: {summary.strengths.join(', ')}</li>}
        {summary.growth.length > 0 && <li>Зона роста: {summary.growth.join(', ')}</li>}
        <li>Проверено компетенций: {probed.length}, подтверждено: {probed.filter((c) => c.status === 'confirmed').length}</li>
      </ul>
      <div className={styles.comp}>
        {probed.map((c) => (
          <div key={c.id} className={c.status === 'confirmed' ? styles.ok : undefined}>
            <span>{c.title}</span>
            <em>{label(c)}</em>
          </div>
        ))}
      </div>
      <div className={styles.acts}>
        <Button variant="cta" href="/profile">
          Открыть профиль →
        </Button>
        <Button variant="ghost" href="/career">
          Вернуться на карту
        </Button>
      </div>
      <p className={styles.disclaimer}>{disclaimer}</p>
    </div>
  );
}

const MicIcon = ({ off }: { off?: boolean }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <rect x="7" y="2" width="6" height="10" />
    <path d="M4 9v1a6 6 0 0012 0V9M10 16v2" />
    {off && <path d="M3 17L17 3" />}
  </svg>
);

/** Провайдер голоса компаньона (озвучка /api/tts, липсинк головы) — включается первым жестом (кнопка «Подключиться»). */
export function InterviewPage() {
  return (
    <CompanionVoiceProvider autoEnable>
      <InterviewRoom />
    </CompanionVoiceProvider>
  );
}

/**
 * ИИнтервью как созвон (docs/competency-model.md): две плитки — ИИ-интервьюер (голова, субтитры) и кандидат
 * (микрофон открыт всё время, речь режет детектор). Кандидат может перебить ИИ голосом: озвучка гаснет по
 * предложению, сервер получает, сколько прозвучало (POST /api/call/{id}/interrupt), в транскрипте остаётся
 * услышанное. Поддакивание («угу», «да») перебиванием не считается — озвучка продолжается. Текст — запасной канал.
 */
function InterviewRoom() {
  const voice = useCompanionVoice();
  const speech = useSentenceSpeech(voice);
  const [phase, setPhase] = useState<Phase>('loading');
  const [consentText, setConsentText] = useState<string[]>([]);
  const [consentVersion, setConsentVersion] = useState('');
  const [consentGiven, setConsentGiven] = useState(false);
  const [call, setCall] = useState<CallView | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [closing, setClosing] = useState(false);
  const [hint, setHint] = useState<{ index: number; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const feed = useRef<HTMLDivElement | null>(null);
  const spoken = useRef(new Set<string>());
  /** Перебивание в процессе: какая реплика ИИ и сколько её частей прозвучало до речи кандидата. */
  const barge = useRef<{ index: number; heard: number; text: string } | null>(null);
  /** Кандидат заговорил, пока ИИ думал: ответ ждёт следующей реплики ИИ. */
  const pending = useRef<{ text: string; audioRef?: string } | null>(null);
  const busyRef = useRef(false);
  const idRef = useRef<string | null>(null);
  const lastAiRef = useRef<TranscriptEntry | null>(null);

  const id = call?.id ?? null;
  idRef.current = id;
  const summary = summaryOf(call?.verdict);
  const lastAi = [...transcript].reverse().find((e) => e.role === 'ai') ?? null;
  lastAiRef.current = lastAi;

  // Открытие: прошлые интервью и согласие; активное — кнопка «Вернуться в созвон» (жест нужен микрофону и звуку).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await callApi.list('interview');
        if (!alive) return;
        setConsentText(list.consent.text);
        setConsentVersion(list.consent.version);
        setConsentGiven(list.consent.given);
        const active = list.calls.find((c) => c.status === 'active');
        if (active) {
          setCall(active);
          setTranscript(active.transcript ?? []);
          for (const e of active.transcript ?? []) if (e.role === 'ai') spoken.current.add(`${active.id}-${e.index}`);
          setPhase('intro');
          return;
        }
        const last = list.calls.find((c) => c.status === 'finished');
        if (last) {
          setCall(last);
          setTranscript(last.transcript ?? []);
          setPhase('done');
          return;
        }
        setPhase('intro');
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'Не удалось загрузить интервью');
        setPhase('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const begin = useCallback(async () => {
    setPhase('starting');
    setError(null);
    setClosing(false);
    setHint(null);
    setDraft('');
    barge.current = null;
    pending.current = null;
    try {
      const r = await callApi.start('interview');
      setCall(r.call);
      setTranscript(r.call.transcript ?? []);
      setPhase('live');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'call_consent_required') return setPhase('consent');
      setError(e instanceof Error ? e.message : 'Не удалось начать интервью');
      setPhase('intro');
    }
  }, []);

  const start = async () => {
    if (!consentGiven) return setPhase('consent');
    await begin();
  };

  const acceptConsent = async () => {
    setError(null);
    try {
      await callApi.consent(consentVersion);
      setConsentGiven(true);
      await begin();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Согласие не записалось');
    }
  };

  useEffect(() => {
    if (!id || phase !== 'live') return;
    return subscribeCallEvents(id, (ev) => {
      if (ev.type === 'utterance') setTranscript((t) => merge(t, [ev.entry]));
      if (ev.type === 'snapshot' && ev.call.transcript) {
        const tr = ev.call.transcript;
        setTranscript((t) => merge(t, tr));
      }
    });
  }, [id, phase]);

  // Новая реплика ИИ — озвучить по предложениям один раз.
  useEffect(() => {
    if (!lastAi || !id || phase !== 'live') return;
    const key = `${id}-${lastAi.index}`;
    if (spoken.current.has(key)) return;
    spoken.current.add(key);
    speech.say(lastAi.index, lastAi.text);
  }, [lastAi, id, phase, speech]);

  useEffect(() => {
    voice?.setThinking(busy);
  }, [busy, voice]);

  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight });
  }, [transcript, typing]);

  useEffect(() => {
    if (phase !== 'live') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const send = useCallback(
    async (input: { text?: string; audioRef?: string }): Promise<void> => {
      const sid = idRef.current;
      if (!sid) return;
      busyRef.current = true;
      setBusy(true);
      setTyping(true);
      setError(null);
      speech.stop();
      let followUp: { text: string; audioRef?: string } | null = null;
      try {
        const r = await callApi.turn(sid, input);
        setTranscript((t) => merge(t, [r.candidate, r.ai]));
        if (r.done) setClosing(true);
        // Кандидат говорил, пока ИИ думал: этот вопрос не прозвучал, ответ уходит сразу.
        const p = pending.current;
        if (p && r.ai?.meta && !r.done) {
          pending.current = null;
          spoken.current.add(`${sid}-${r.ai.index}`);
          await callApi.interrupt(sid, { index: r.ai.index, heardSentences: 0 }).catch(() => undefined);
          followUp = p;
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ответ не отправился - попробуй ещё раз');
      } finally {
        busyRef.current = false;
        setBusy(false);
        setTyping(false);
      }
      if (followUp) await send(followUp);
    },
    [speech],
  );

  const onSpeechStart = useCallback(() => {
    const ai = lastAiRef.current;
    if (!speech.isPlaying() || !ai?.meta) return;
    // Перебивание: гасим озвучку сразу, серверу сообщаем после распознавания (поддакивание — не перебивание).
    barge.current = { index: ai.index, heard: speech.heardOf(ai.index), text: ai.text };
    speech.stop();
  }, [speech]);

  const onUtterance = useCallback(
    async ({ pcm, browserText }: RoomUtterance) => {
      const sid = idRef.current;
      if (!sid) return;
      let audioRef: string | undefined;
      let text = browserText ?? '';
      if (pcm) {
        try {
          const a = await callApi.audio(sid, pcm);
          audioRef = a.audioRef;
          if (!text) text = a.text ?? '';
        } catch (e) {
          if (!text) setError(e instanceof Error ? e.message : 'Запись не сохранилась - ответь текстом');
        }
      }
      const b = barge.current;
      if (!text.trim() || isBackchannel(text)) {
        // Ложное перебивание: ИИ продолжает с непрозвучавшего предложения.
        if (b) {
          barge.current = null;
          speech.resume(b.index, b.text);
        }
        return;
      }
      if (busyRef.current) {
        pending.current = { text, ...(audioRef ? { audioRef } : {}) };
        return;
      }
      const ai = lastAiRef.current;
      if (!ai?.meta) return;
      if (b) {
        barge.current = null;
        if (b.heard < speech.partsOf(b.index)) await callApi.interrupt(sid, { index: b.index, heardSentences: b.heard }).catch(() => undefined);
      }
      await send({ text, ...(audioRef ? { audioRef } : {}) });
    },
    [send, speech],
  );

  const mic = useRoomMic({ isPlaying: speech.isPlaying, onSpeechStart, onUtterance });
  const micRef = useRef(mic);
  micRef.current = mic;

  // Комната открыта — микрофон открыт; закрыта — выключен.
  useEffect(() => {
    if (phase === 'live') void micRef.current.start();
    else micRef.current.stop();
  }, [phase]);

  const finish = async () => {
    const sid = idRef.current;
    if (!sid) return;
    mic.stop();
    speech.stop();
    setPhase('finishing');
    setError(null);
    try {
      const v = await callApi.finish(sid);
      setCall(v);
      setTranscript(v.transcript ?? []);
      if (v.status === 'active') {
        setClosing(false);
        setPhase('live');
        return;
      }
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Оценщик сейчас недоступен - попробуй ещё раз');
      setPhase('live');
    }
  };

  const last = transcript[transcript.length - 1];
  const awaiting = Boolean(last && last.role === 'ai' && last.meta) && !busy && phase === 'live';
  const answered = transcript.filter((e) => e.role === 'candidate').length;
  const stage: BlockId = phase === 'done' ? 'summary' : stageOf(turnsOf(transcript), closing);
  const canFinish = answered > 0 && !busy && phase === 'live';
  const startedAt = call ? Date.parse(call.startedAt) : now;
  const elapsed = phase === 'live' ? now - startedAt : call?.finishedAt ? Date.parse(call.finishedAt) - startedAt : 0;
  const aiSpeaking = voice?.status === 'speaking' || voice?.status === 'loading';
  const candidateLive = mic.state === 'speaking';

  const submitDraft = () => {
    const text = draft.trim();
    if (!text || !awaiting) return;
    setDraft('');
    void send({ text });
  };

  const blockTitle = (e: TranscriptEntry) => (e.meta?.block ? blockDef(e.meta.block).title : null);
  const caption = voice?.speakingText ?? (busy ? 'Думаю над следующим вопросом…' : lastAi && phase === 'live' ? lastAi.text : null);

  return (
    <div className={styles.page} data-screen="interview">
      <div className={styles.top}>
        <div className={styles.title}>
          <b>
            И<i>И</i>нтервью
          </b>
          <small>
            {phase === 'live' || phase === 'finishing'
              ? `${blockDef(stage).title} · вопрос ${Math.min(answered + 1, INTERVIEW_LIMITS.maxQuestions)} из ${INTERVIEW_LIMITS.minQuestions}–${INTERVIEW_LIMITS.maxQuestions}`
              : 'созвон с ИИ-интервьюером'}
          </small>
        </div>
        <span className={cx(styles.rec, phase !== 'live' && styles.idle)} aria-label="Идёт запись">
          {mmss(elapsed)}
        </span>
      </div>

      <div className={styles.shell}>
        <main className={styles.stage} aria-label="Комната ИИнтервью">
          {phase === 'done' ? (
            <div className={styles.resultWrap}>
              {summary && call ? (
                <ResultCard summary={summary} disclaimer={call.disclaimer} />
              ) : (
                <p className={styles.hintLine}>Интервью закрыто без оценки: ответов не было или оценщик был недоступен. Можно начать заново.</p>
              )}
              <div className={styles.bar}>
                <button type="button" className={cx(styles.ctl, styles.primary)} onClick={() => void begin()}>
                  Пройти ещё раз
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.tiles}>
              <section className={styles.tile} data-active={aiSpeaking ? 'true' : 'false'} aria-label="ИИ-интервьюер">
                <div className={styles.head}>
                  <HeadView />
                </div>
                {phase === 'live' && <span className={styles.chip}>{aiSpeaking ? 'говорит' : busy ? 'думает' : 'слушает'}</span>}
                {caption && (phase === 'live' || phase === 'finishing') && (
                  <p className={styles.caption} aria-live="polite">
                    {phase === 'finishing' ? 'Спасибо, это всё! Собираю оценку…' : caption}
                  </p>
                )}
                <div className={styles.nameplate} data-live={aiSpeaking ? 'true' : 'false'}>
                  <i />
                  ИИ-интервьюер
                </div>
              </section>
              <section className={styles.tile} data-active={candidateLive ? 'true' : 'false'} aria-label="Вы">
                <div className={styles.monogram} aria-hidden="true">
                  Я
                </div>
                <div className={styles.ring} style={{ '--level': mic.level.toFixed(2) } as React.CSSProperties} aria-hidden="true" />
                {phase === 'live' && (
                  <span className={styles.chip}>
                    {mic.muted ? 'микрофон выключен' : mic.state === 'speaking' ? 'говорите' : mic.state === 'processing' ? 'распознаю' : mic.state === 'listening' ? 'слушаю' : 'без микрофона'}
                  </span>
                )}
                {mic.interim && (
                  <p className={cx(styles.caption, styles.captionMine)} aria-live="off">
                    {mic.interim}
                  </p>
                )}
                <div className={styles.nameplate} data-live={candidateLive ? 'true' : 'false'}>
                  <i />
                  Вы
                </div>
              </section>
            </div>
          )}

          {(phase === 'live' || phase === 'finishing') && (
            <div className={styles.controls}>
              {hint && lastAi && hint.index === lastAi.index && (
                <p className={styles.hintLine} role="note">
                  {hint.text}
                </p>
              )}
              {(error || mic.error) && (
                <p className={styles.error} role="alert">
                  {error ?? mic.error}
                </p>
              )}
              {closing && <p className={styles.hintLine}>Вопросы закончились - нажми «Завершить», оценщик соберёт результат.</p>}
              <form
                className={styles.typeRow}
                onSubmit={(e) => {
                  e.preventDefault();
                  submitDraft();
                }}
              >
                <textarea
                  rows={1}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submitDraft();
                    }
                  }}
                  placeholder={mic.available && !mic.muted ? 'Отвечай голосом или напиши здесь…' : 'Напиши ответ…'}
                  aria-label="Ответ текстом"
                  disabled={!awaiting || closing}
                />
                <button type="submit" className={styles.ctl} disabled={!awaiting || closing || !draft.trim()}>
                  Отправить
                </button>
              </form>
              <div className={styles.bar}>
                {mic.available && (
                  <button
                    type="button"
                    className={cx(styles.ctl, mic.muted && styles.ctlMuted)}
                    onClick={() => mic.setMuted(!mic.muted)}
                    aria-pressed={!mic.muted}
                    aria-label={mic.muted ? 'Включить микрофон' : 'Выключить микрофон'}
                  >
                    <MicIcon off={mic.muted} />
                    <span>{mic.muted ? 'Микрофон выкл' : 'Микрофон'}</span>
                  </button>
                )}
                {voice && voice.available !== false && (
                  <button type="button" className={cx(styles.ctl, voice.enabled && styles.ctlOn)} data-voice-toggle onClick={voice.toggle} aria-pressed={voice.enabled}>
                    <span>{voice.enabled ? 'Звук вкл' : 'Звук выкл'}</span>
                  </button>
                )}
                <button type="button" className={styles.ctl} disabled={!lastAi || !voice || voice.available === false} onClick={() => lastAi && speech.replay(lastAi.index, lastAi.text)}>
                  Повторить
                </button>
                <button
                  type="button"
                  className={styles.ctl}
                  disabled={!awaiting || closing || !lastAi?.meta?.competencyId}
                  onClick={() => {
                    const c = lastAi?.meta?.competencyId ? competencyById(lastAi.meta.competencyId) : null;
                    if (lastAi && c) setHint({ index: lastAi.index, text: clarificationHint(c, lastAi.meta!.level) });
                  }}
                >
                  Уточнить
                </button>
                <button type="button" className={styles.ctl} disabled={!awaiting || closing} onClick={() => void send({ text: 'Пропускаю этот вопрос.' })}>
                  Пропустить
                </button>
                <button type="button" className={cx(styles.ctl, styles.end)} disabled={!canFinish} onClick={() => void finish()}>
                  {phase === 'finishing' ? <Spinner /> : 'Завершить'}
                </button>
              </div>
            </div>
          )}
          {phase === 'error' && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          {(phase === 'intro' || phase === 'consent' || phase === 'starting' || phase === 'loading') && (
            <div className={styles.intro}>
              <div className={styles.card}>
                {phase === 'loading' ? (
                  <Spinner />
                ) : (
                  <>
                    <div>
                      <span className={styles.kicker}>После теста на грейд</span>
                      <h1>
                        Следующий шаг - И<i>И</i>нтервью
                      </h1>
                    </div>
                    <p>
                      Созвон с ИИ-интервьюером: четыре блока - знакомство, профильные компетенции, системный дизайн, работа в команде. Микрофон открыт
                      всё время, как в обычном звонке: можно перебивать и переспрашивать. Итог - профиль компетенций в кабинете. Категорию интервью не
                      меняет.
                    </p>
                    <div className={styles.rules}>
                      <div>
                        <b>≈ 20 мин</b>
                        <span>длительность</span>
                      </div>
                      <div>
                        <b>{QUESTION_BLOCKS.length}</b>
                        <span>блока вопросов</span>
                      </div>
                      <div>
                        <b>голос / текст</b>
                        <span>как удобнее</span>
                      </div>
                      <div>
                        <b>без камеры</b>
                        <span>только звук</span>
                      </div>
                    </div>
                    {phase === 'consent' && (
                      <div className={styles.consent}>
                        <b>Согласие на запись</b>
                        {consentText.map((p, i) => (
                          <span key={i}>{p}</span>
                        ))}
                      </div>
                    )}
                    {error && (
                      <p className={styles.cardError} role="alert">
                        {error}
                      </p>
                    )}
                    {phase === 'consent' ? (
                      <button type="button" className={styles.go} onClick={() => void acceptConsent()}>
                        Согласен, подключиться <span aria-hidden="true">→</span>
                      </button>
                    ) : (
                      <button type="button" className={styles.go} onClick={() => void (call?.status === 'active' ? setPhase('live') : start())} disabled={phase === 'starting'}>
                        {phase === 'starting' ? <Spinner /> : call?.status === 'active' ? 'Вернуться в созвон' : 'Подключиться'} <span aria-hidden="true">→</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </main>

        <aside className={styles.side} aria-label="Ход интервью">
          <div>
            <h3>Транскрипт</h3>
            <div className={styles.feed} ref={feed} aria-live="polite">
              {transcript.map((e) => (
                <div key={e.index} className={cx(styles.msg, e.role === 'ai' ? styles.ai : styles.me)}>
                  <span className={styles.av} aria-hidden="true">
                    {e.role === 'ai' ? 'ИИ' : 'Я'}
                  </span>
                  <div className={styles.bubble}>
                    {e.role === 'ai' && blockTitle(e) && <span className={styles.stage}>{blockTitle(e)}</span>}
                    {e.text}
                  </div>
                </div>
              ))}
              {typing && (
                <div className={cx(styles.msg, styles.ai)} aria-label="ИИ думает">
                  <span className={styles.av} aria-hidden="true">
                    ИИ
                  </span>
                  <div className={styles.bubble}>…</div>
                </div>
              )}
            </div>
          </div>
          <div>
            <h3>Этапы</h3>
            <Stages current={stage} />
          </div>
          <div>
            <h3>Что оценивается</h3>
            <Criteria summary={summary} />
          </div>
          <p className={styles.note}>
            Интервью ведёт ИИ-интервьюер, оценку ставит отдельный слепой оценщик. Работодатели до принятого приглашения видят только оценки по
            компетенциям, без переписки и записи.
          </p>
        </aside>
      </div>
    </div>
  );
}
