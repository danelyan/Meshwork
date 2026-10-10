'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';

import { ApiError } from '@/lib/api';
import { inviteApi } from '@/lib/employer-api';
import { detectRedFlags } from '@/server/employer/antifraud';

import { Button, Field, Notice } from '../ui';
import ui from '../ui.module.css';

import styles from './Employer.module.css';
import { RedFlagNotice } from './RedFlagNotice';

export interface InviteFormProps {
  candidateId: string;
  candidateName: string;
  vacancyId: string | null;
  /** Подстановка вилки — из потребности или черновика помощника. */
  defaultSalaryFrom?: number;
  defaultSalaryTo?: number;
  /** Черновик помощника: текст предложения и форма сразу открыта. */
  initialMessage?: string;
  defaultOpen?: boolean;
}

const parseRub = (v: string) => Number(v.replace(/\s/g, ''));
const isRub = (n: number) => Number.isInteger(n) && n > 0;

/** Приглашение конкретному кандидату (R-E-05, ТЗ 2.2): описание и вилка «от–до» обязательны. */
export function InviteForm({ candidateId, candidateName, vacancyId, defaultSalaryFrom, defaultSalaryTo, initialMessage, defaultOpen }: InviteFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [message, setMessage] = useState(initialMessage ?? '');
  const [salaryFrom, setSalaryFrom] = useState(defaultSalaryFrom ? String(defaultSalaryFrom) : '');
  const [salaryTo, setSalaryTo] = useState(defaultSalaryTo ? String(defaultSalaryTo) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<{ message?: string; salaryFrom?: string; salaryTo?: string }>({});
  const [done, setDone] = useState(false);
  const flags = useMemo(() => detectRedFlags({ texts: [message], salaryFrom: parseRub(salaryFrom), salaryTo: parseRub(salaryTo) }).filter((f) => f.code !== 'vague_text' && f.code !== 'no_salary'), [message, salaryFrom, salaryTo]);

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
    const from = parseRub(salaryFrom);
    const to = parseRub(salaryTo);
    const errs: typeof fieldErr = {};
    if (message.trim().length < 10) errs.message = 'Опиши задачу и команду хотя бы в 10 символах';
    if (!isRub(from)) errs.salaryFrom = 'Укажи сумму в рублях';
    if (!isRub(to)) errs.salaryTo = 'Укажи сумму в рублях';
    else if (isRub(from) && to < from) errs.salaryTo = '«До» не может быть меньше «от»';
    setFieldErr(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError(null);
    try {
      await inviteApi({ candidateId, vacancyId, message: message.trim(), salaryFrom: from, salaryTo: to });
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
      <Field
        label="Что предлагаешь"
        hint="Задачи, команда, формат работы. Кандидат увидит это до принятия вместе с вилкой и контактом компании."
        error={fieldErr.message}
      >
        <textarea className={ui.input} rows={4} value={message} maxLength={2000} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      <div className={styles.salaryRow}>
        <Field label="Зарплата от, ₽ в месяц" error={fieldErr.salaryFrom}>
          <input className={ui.input} inputMode="numeric" value={salaryFrom} onChange={(e) => setSalaryFrom(e.target.value)} />
        </Field>
        <Field label="до, ₽ в месяц" error={fieldErr.salaryTo}>
          <input className={ui.input} inputMode="numeric" value={salaryTo} onChange={(e) => setSalaryTo(e.target.value)} />
        </Field>
      </div>
      <RedFlagNotice flags={flags} />
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
