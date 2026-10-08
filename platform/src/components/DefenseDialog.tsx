'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

import { answerDefenseApi, type DefenseStep, getDefenseSessionApi, startDefenseApi } from '@/lib/api';
import type { DefenseVerdict } from '@/server/defense/types';

import styles from './DefenseDialog.module.css';
import ui from './ui.module.css';

const AXES: { key: keyof DefenseVerdict['scores']; label: string }[] = [
  { key: 'depth', label: 'Глубина деталей' },
  { key: 'why', label: 'Почему так' },
  { key: 'boundary', label: 'Граница знаний' },
  { key: 'completion', label: 'Доводит до конца' },
];

export function VerdictView({ verdict }: { verdict: DefenseVerdict }) {
  return (
    <section className={`${ui.panel} ${styles.verdict}`} aria-label="Вердикт защиты">
      <div>
        <span className={`${ui.tag} ${verdict.passed ? '' : ui.outline}`}>{verdict.passed ? 'защита пройдена' : 'защита не пройдена'}</span>
        <p className={styles.total}>{verdict.total} из 8</p>
      </div>
      <ul className={styles.scores} aria-label="Баллы по осям">
        {AXES.map((a) => (
          <li key={a.key} className={styles.score}>
            <span className={ui.muted}>{a.label}</span>
            <b>{verdict.scores[a.key]} из 2</b>
          </li>
        ))}
      </ul>
      <p>{verdict.explanation}</p>
      {verdict.quotes.length > 0 && (
        <div>
          <span className={styles.label}>Фрагменты ваших ответов, по которым выставлены баллы</span>
          <ul className={styles.quotes}>
            {verdict.quotes.map((q, i) => (
              <li key={i}>«{q}»</li>
            ))}
          </ul>
        </div>
      )}
      <p className={ui.muted} style={{ fontSize: 'var(--fs)' }}>
        {verdict.passed
          ? 'Уровень утверждения поднят до «платформа». Это оценка понимания на сегодня.'
          : 'Уровень утверждения не изменился. Можно подготовиться и пройти защиту позже.'}
      </p>
    </section>
  );
}

type Turn = { question: string; answer?: string };

export function DefenseDialog({ claimId }: { claimId: string }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [verdict, setVerdict] = useState<DefenseVerdict | null>(null);
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | undefined>();
  const fieldId = useId();
  const startedRef = useRef(false);

  function apply(step: DefenseStep) {
    setSessionId(step.sessionId);
    if (step.total) setTotal(step.total);
    if (step.verdict) setVerdict(step.verdict);
    if (step.question) {
      const q = step.question.question;
      setTurns((p) => [...p, { question: q }]);
    }
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    startDefenseApi(claimId)
      .then(async (s) => {
        if (!s.resumed) return apply({ sessionId: s.sessionId, question: s.question });
        // Продолжение активной сессии: восстановить уже отвеченные вопросы.
        setSessionId(s.sessionId);
        const view = await getDefenseSessionApi(s.sessionId);
        setTurns(view.turns.map((t) => ({ question: t.question, ...(t.answer !== null ? { answer: t.answer } : {}) })));
        if (view.verdict) setVerdict(view.verdict);
      })
      .then(
      () => {
        setLoading(false);
      },
      (e: unknown) => {
        setError(e instanceof Error ? e.message : 'Не удалось начать защиту.');
        setLoading(false);
      },
    );
  }, [claimId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = answer.trim();
    if (!text || !sessionId || pending) return;
    setPending(true);
    setError(null);
    try {
      const step = await answerDefenseApi(sessionId, text);
      setTurns((p) => p.map((t, i) => (i === p.length - 1 ? { ...t, answer: text } : t)));
      setAnswer('');
      apply(step);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить ответ.');
    } finally {
      setPending(false);
    }
  }

  const waiting = turns.length > 0 && turns[turns.length - 1]!.answer === undefined && !verdict;

  return (
    <div className={styles.page}>
      <div>
        <h1 style={{ fontSize: 'clamp(24px, 3vw, 34px)' }}>Защита утверждения</h1>
        <p className={ui.muted} style={{ fontSize: 'var(--fs-md)', marginTop: 6 }}>
          Несколько вопросов по вашему утверждению и его источнику.{' '}
          <Link href="/profile" style={{ textDecoration: 'underline' }}>
            Вернуться в профиль
          </Link>
        </p>
      </div>

      <p className={styles.disclaimer} role="note">
        <strong>Что проверяет защита.</strong> Она проверяет понимание сейчас, а не подлинность истории: нельзя по ответам доказать, что вы
        сами делали проект в прошлом.
      </p>

      {loading && (
        <p className={ui.muted} role="status">
          <span className={ui.spinner} aria-hidden="true" /> Готовлю вопросы…
        </p>
      )}

      <ol className={styles.thread} aria-label="Ход защиты" aria-live="polite">
        {turns.map((t, i) => (
          <li key={i} style={{ display: 'grid', gap: 8 }}>
            <div className={styles.q}>
              <span className={styles.label}>
                Вопрос {i + 1}
                {total ? ` из ${total}` : ''}
              </span>
              {t.question}
            </div>
            {t.answer !== undefined && (
              <div className={styles.a}>
                <span className={styles.label}>Ваш ответ</span>
                {t.answer}
              </div>
            )}
          </li>
        ))}
      </ol>

      {verdict && <VerdictView verdict={verdict} />}

      {waiting && (
        <form className={styles.form} onSubmit={submit}>
          <label htmlFor={fieldId} className={ui.label}>
            Ваш ответ
          </label>
          <textarea id={fieldId} value={answer} onChange={(e) => setAnswer(e.target.value)} rows={5} maxLength={4000} disabled={pending} />
          <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={pending || !answer.trim()} style={{ justifySelf: 'start' }}>
            {pending ? 'Отправляю…' : 'Ответить'}
          </button>
        </form>
      )}

      {error && (
        <p className={`${ui.notice} ${ui.errorBox}`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
