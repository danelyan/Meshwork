'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { ApiError } from '@/lib/api';
import { askQuestionApi, listQuestionsApi, type EmployerQuestionDto } from '@/lib/employer-api';

import { Button, Field, Notice } from '../ui';
import ui from '../ui.module.css';

import styles from './Employer.module.css';

const STATUS_LABEL: Record<EmployerQuestionDto['status'], string> = {
  queued: 'в очереди',
  asked: 'задан',
  answered: 'есть ответ',
};

/**
 * «Вопросы кандидату» (ADR 0003, ступень 3): работодатель оставляет вопрос, кандидат отвечает ИИ-интервьюеру в
 * защите – сразу, если сейчас на ней, иначе при следующем входе. Только после принятого приглашения (сервер).
 */
export function CandidateQuestions({ candidateId }: { candidateId: string }) {
  const [items, setItems] = useState<EmployerQuestionDto[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await listQuestionsApi(candidateId));
    } catch (e) {
      setItems([]);
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить вопросы');
    }
  }, [candidateId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim().length < 5) {
      setError('Вопрос хотя бы из 5 символов');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await askQuestionApi(candidateId, text.trim());
      setText('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось отправить вопрос');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.stage} aria-label="Вопросы кандидату">
      <h4 className={styles.stageTitle}>Вопросы кандидату</h4>
      {items === null ? (
        <p className={styles.meta}>Загружаем вопросы...</p>
      ) : items.length === 0 ? (
        <p className={styles.meta}>Вопросов пока нет. Кандидат ответит на них голосом в защите проекта.</p>
      ) : (
        <ul className={styles.why} aria-label="Заданные вопросы">
          {items.map((q) => (
            <li key={q.id}>
              <b>{q.text}</b> <span className={styles.status}>{STATUS_LABEL[q.status]}</span>
              {q.answer && <span className={styles.text}> Ответ кандидата: {q.answer}</span>}
            </li>
          ))}
        </ul>
      )}
      <form className={styles.inviteBox} onSubmit={submit} noValidate aria-label="Новый вопрос кандидату">
        <Field label="Ваш вопрос" hint="Кандидат ответит на него в защите проекта; ответ появится здесь.">
          <textarea className={ui.input} rows={2} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <div>
          <Button type="submit" size="sm" disabled={busy}>
            Задать вопрос
          </Button>
        </div>
      </form>
    </section>
  );
}
