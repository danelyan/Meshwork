'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { callApi, subscribeCallEvents } from '@/lib/call-api';
import type { CallView, TranscriptEntry } from '@/server/call/types';
import { AXES, AXIS_LABEL, BLOCK_DEFS, type BlockId, blockDef, competencyById } from '@/server/interview/model';
import { INTERVIEW_LIMITS, clarificationHint, stageOf } from '@/server/interview/plan';
import type { InterviewSummary } from '@/server/interview/types';

import { useCallMic } from '../call/useCallMic';
import { Button, Spinner, cx } from '../ui';

import { SKIP_ANSWER, summaryOf, turnsOf } from './helpers';
import styles from './InterviewPage.module.css';
import { useSpeech } from './useSpeech';

type Phase = 'loading' | 'intro' | 'live' | 'finishing' | 'done' | 'error';

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function merge(list: TranscriptEntry[], add: (TranscriptEntry | null | undefined)[]): TranscriptEntry[] {
  const byIndex = new Map(list.map((e) => [e.index, e]));
  for (const e of add) if (e) byIndex.set(e.index, e);
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

/** Вход в ИИнтервью: консультант с сразу открытым режимом созвона. */
export const CONSULTANT_CALL_HREF = '/consultant?call=1';
/** Старая комната звонка (components/interview/InterviewRoom): перебивание голосом теперь есть в созвоне с Кирой, с заставки не ведём. */
export const ROOM_HREF = '/interview/room';

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

/** Четыре критерия с полосками: до вердикта – «–», после – проценты по осям. */
export function Criteria({ summary }: { summary: InterviewSummary | null }) {
  return (
    <div className={styles.crit}>
      {AXES.map((axis) => {
        const score = summary?.axes.find((a) => a.axis === axis)?.score ?? null;
        return (
          <div key={axis}>
            <span>
              {AXIS_LABEL[axis]}
              <em>{score === null ? '–' : `${score}%`}</em>
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

const MicIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <rect x="7" y="2" width="6" height="10" />
    <path d="M4 9v1a6 6 0 0012 0V9M10 16v2" />
  </svg>
);

/**
 * ИИнтервью (docs/competency-model.md): просмотр результата и истории. Новое интервью проходит в консультанте
 * (режим созвона, решение владельца 10.10); стартовая карточка ведёт туда. Уже идущее интервью можно
 * продолжить здесь: лента вопросов, ответ текстом или голосом, озвучка через /api/tts, «Завершить».
 */
export function InterviewPage() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [call, setCall] = useState<CallView | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [closing, setClosing] = useState(false);
  /** Подсказка «Уточнить вопрос» к реплике ИИ с этим index (клиент, не ответ). */
  const [hint, setHint] = useState<{ index: number; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const feed = useRef<HTMLDivElement | null>(null);
  const spoken = useRef(new Set<string>());
  const speech = useSpeech();
  const speechRef = useRef(speech);
  speechRef.current = speech;

  const id = call?.id ?? null;
  const summary = summaryOf(call?.verdict);

  // Без интервью страница не нужна: созвон идёт в консультанте (решение владельца 10.10 и 11.10) –
  // сразу туда; карточка ниже остаётся на мгновение загрузки и для браузеров без JS-перехода.
  useEffect(() => {
    if (phase !== 'intro' || process.env.NODE_ENV === 'test') return;
    window.location.replace(CONSULTANT_CALL_HREF);
  }, [phase]);
  // Открытие: прошлые интервью и согласие; активное – продолжаем сразу, иначе стартовая карточка.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await callApi.list('interview');
        if (!alive) return;
        const active = list.calls.find((c) => c.status === 'active');
        if (active) {
          setCall(active);
          setTranscript(active.transcript ?? []);
          setPhase('live');
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

  // SSE: реплики могут прийти и не из нашего запроса (второй таб).
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

  // Новая реплика ИИ – озвучить один раз; при открытии уже идущего интервью старые не читаем.
  const lastAi = [...transcript].reverse().find((e) => e.role === 'ai');
  useEffect(() => {
    if (!lastAi || !id || phase !== 'live') return;
    const key = `${id}-${lastAi.index}`;
    if (spoken.current.has(key)) return;
    spoken.current.add(key);
    void speechRef.current.speak(lastAi.text);
  }, [lastAi, id, phase]);

  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight });
  }, [transcript, busy, phase]);

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
      speechRef.current.stop();
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
    speechRef.current.stop();
    setPhase('finishing');
    setError(null);
    try {
      const v = await callApi.finish(id);
      setCall(v);
      setTranscript(v.transcript ?? []);
      if (v.status === 'active') {
        // Оценщик разошёлся по компетенции: интервью продолжается дополнительным вопросом.
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
  const turns = turnsOf(transcript);
  const stage: BlockId = phase === 'done' ? 'summary' : stageOf(turns, closing);
  const canFinish = answered > 0 && !busy && mic.state === 'idle' && phase === 'live';
  const startedAt = call ? Date.parse(call.startedAt) : now;
  const elapsed = phase === 'live' ? now - startedAt : call?.finishedAt ? Date.parse(call.finishedAt) - startedAt : 0;

  const submitDraft = () => {
    const text = draft.trim();
    if (!text || !awaiting) return;
    setDraft('');
    void send({ text });
  };

  const blockTitle = (e: TranscriptEntry) => (e.meta?.block ? blockDef(e.meta.block).title : null);

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
              : 'после теста на грейд'}
          </small>
        </div>
        <span className={cx(styles.rec, phase !== 'live' && styles.idle)} aria-label="Идёт запись">
          {mmss(elapsed)}
        </span>
        {speech.available && (
          <Button variant="ghost" size="sm" onClick={speech.toggle} aria-pressed={speech.enabled}>
            {speech.enabled ? 'Озвучка вкл' : 'Озвучка выкл'}
          </Button>
        )}
        {phase === 'live' && (
          <Button variant="ghost" size="sm" onClick={finish} disabled={!canFinish}>
            Завершить
          </Button>
        )}
      </div>

      <div className={styles.shell}>
        <main className={styles.chat} aria-label="Созвон с ИИ">
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
            {hint && lastAi && hint.index === lastAi.index && phase === 'live' && (
              <div className={cx(styles.msg, styles.ai)} role="note">
                <span className={styles.av} aria-hidden="true">
                  ИИ
                </span>
                <div className={styles.bubble}>{hint.text}</div>
              </div>
            )}
            {busy && (
              <div className={cx(styles.msg, styles.ai, styles.typing)} aria-label="ИИ печатает">
                <span className={styles.av} aria-hidden="true">
                  ИИ
                </span>
                <div className={styles.bubble}>
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            )}
            {phase === 'finishing' && (
              <div className={cx(styles.msg, styles.ai)}>
                <span className={styles.av} aria-hidden="true">
                  ИИ
                </span>
                <div className={styles.bubble}>
                  <span className={styles.stage}>Итоги</span>
                  Спасибо, это всё! Собираю оценку… <Spinner />
                </div>
              </div>
            )}
            {phase === 'done' && summary && call && <ResultCard summary={summary} disclaimer={call.disclaimer} />}
            {phase === 'done' && !summary && (
              <div className={cx(styles.msg, styles.ai)}>
                <span className={styles.av} aria-hidden="true">
                  ИИ
                </span>
                <div className={styles.bubble}>Интервью закрыто без оценки: ответов не было или оценщик был недоступен. Можно начать заново.</div>
              </div>
            )}
          </div>

          {phase === 'done' && (
            <div className={styles.quick}>
              <a href={CONSULTANT_CALL_HREF}>Пройти ещё раз в консультанте</a>
            </div>
          )}

          {(phase === 'live' || phase === 'finishing') && (
            <>
              <div className={styles.quick}>
                <button type="button" disabled={!lastAi || !speech.available} onClick={() => lastAi && void speech.replay(lastAi.text)}>
                  Повторить вопрос
                </button>
                <button
                  type="button"
                  disabled={!awaiting || closing || !lastAi?.meta?.competencyId}
                  onClick={() => {
                    const c = lastAi?.meta?.competencyId ? competencyById(lastAi.meta.competencyId) : null;
                    if (lastAi && c) setHint({ index: lastAi.index, text: clarificationHint(c, lastAi.meta!.level) });
                  }}
                >
                  Уточнить вопрос
                </button>
                <button type="button" disabled={!awaiting || closing} onClick={() => void send({ text: SKIP_ANSWER })}>
                  Пропустить
                </button>
              </div>
              {(error || mic.error) && (
                <p className={styles.error} role="alert">
                  {error ?? mic.error}
                </p>
              )}
              <form
                className={styles.composer}
                onSubmit={(e) => {
                  e.preventDefault();
                  submitDraft();
                }}
              >
                {mic.state === 'recording' ? (
                  <div className={styles.wave} aria-hidden="true">
                    {Array.from({ length: 10 }, (_, k) => (
                      <i key={k} style={{ animationDelay: `${k * 0.08}s`, height: `${6 + Math.round(mic.level * 22)}px` }} />
                    ))}
                    <span>{mic.interim || `слушаю… ${mmss(mic.elapsed)}`}</span>
                  </div>
                ) : (
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
                    placeholder={closing ? 'Вопросы закончились - нажми «Завершить»' : 'Ответьте текстом или нажмите микрофон…'}
                    aria-label="Ваш ответ"
                    disabled={!awaiting || closing}
                  />
                )}
                {mic.available && (
                  <button
                    type="button"
                    className={cx(styles.mic, mic.state === 'recording' && styles.on)}
                    onClick={() => (mic.state === 'recording' ? mic.stop() : void mic.start())}
                    disabled={(!awaiting && mic.state !== 'recording') || mic.state === 'processing' || closing}
                    aria-pressed={mic.state === 'recording'}
                    aria-label={mic.state === 'recording' ? 'Закончить ответ' : 'Ответить голосом'}
                  >
                    {mic.state === 'processing' ? <Spinner /> : <MicIcon />}
                  </button>
                )}
                <button type="submit" className={styles.send} disabled={!awaiting || closing || !draft.trim()}>
                  Ответить
                </button>
              </form>
            </>
          )}
          {phase === 'error' && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </main>

        <aside className={styles.side} aria-label="Ход интервью">
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

      {(phase === 'intro' || phase === 'loading') && (
        <div className={styles.intro}>
          <div className={styles.card}>
            {phase === 'loading' ? (
              <Spinner />
            ) : (
              <>
                <div>
                  <span className={styles.note} style={{ padding: 0, border: 0, background: 'transparent' }}>
                    После теста на грейд
                  </span>
                  <h1>
                    Следующий шаг - Созвон с ИИ
                  </h1>
                </div>
                <p>
                  ИИ-интервьюер пройдёт с тобой четыре блока: знакомство, разбор профильных компетенций, системный дизайн и работу в команде. Итог -
                  профиль компетенций в кабинете и подтверждённые утверждения в профиле. Категорию интервью не меняет. Интервью проходит в консультанте,
                  в режиме созвона с Кирой - переходим туда; здесь остаётся результат и история.
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
                    <b>текст / голос</b>
                    <span>как удобнее</span>
                  </div>
                  <div>
                    <b>камера</b>
                    <span>по желанию</span>
                  </div>
                </div>
                {error && (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                )}
                <a className={styles.go} href={CONSULTANT_CALL_HREF}>
                  Пройти в консультанте <span aria-hidden="true">→</span>
                </a>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
