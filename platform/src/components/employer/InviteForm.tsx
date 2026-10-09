'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { ApiError } from '@/lib/api';
import { inviteApi } from '@/lib/employer-api';

import { Button, Field, Notice } from '../ui';
import ui from '../ui.module.css';

import styles from './Employer.module.css';

export interface InviteFormProps {
  candidateId: string;
  candidateName: string;
  vacancyId: string | null;
  /** Подстановка зарплаты — нижняя граница вилки потребности. */
  defaultSalary?: number;
}

/** Приглашение конкретному кандидату (R-E-05): описание и зарплата обязательны. */
export function InviteForm({ candidateId, candidateName, vacancyId, defaultSalary }: InviteFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [salary, setSalary] = useState(defaultSalary ? String(defaultSalary) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<{ message?: string; salary?: string }>({});
  const [done, setDone] = useState(false);

  if (done) return <Notice>Приглашение отправлено. Статус - в разделе «Приглашения».</Notice>;
  if (!open) {
    return (
      <div>
        <Button variant="cta" size="sm" onClick={() => setOpen(true)} aria-label={`Пригласить: ${candidateName}`}>
          Пригласить
        </Button>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const salaryOffer = Number(salary.replace(/\s/g, ''));
    const errs: typeof fieldErr = {};
    if (message.trim().length < 10) errs.message = 'Опиши задачу и команду хотя бы в 10 символах';
    if (!Number.isInteger(salaryOffer) || salaryOffer <= 0) errs.salary = 'Укажи зарплату в рублях';
    setFieldErr(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError(null);
    try {
      await inviteApi({ candidateId, vacancyId, message: message.trim(), salaryOffer });
      setDone(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось отправить приглашение');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.inviteBox} onSubmit={submit} noValidate aria-label={`Приглашение: ${candidateName}`}>
      <Field label="Что предлагаешь" hint="Задачи, команда, формат работы. Кандидат увидит это вместе с зарплатой." error={fieldErr.message}>
        <textarea className={ui.input} rows={4} value={message} maxLength={2000} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      <Field label="Зарплата, ₽ в месяц" error={fieldErr.salary}>
        <input className={ui.input} inputMode="numeric" value={salary} onChange={(e) => setSalary(e.target.value)} />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <div className={styles.actions}>
        <Button type="submit" variant="cta" size="sm" loading={busy}>
          Отправить приглашение
        </Button>
        <Button size="sm" onClick={() => setOpen(false)} disabled={busy}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
