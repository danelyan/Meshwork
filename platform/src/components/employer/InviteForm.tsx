'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { ApiError } from '@/lib/api';
import { inviteApi, type InviteBody } from '@/lib/employer-api';
import { detectRedFlags } from '@/server/employer/antifraud';

import { Button, Field, Notice } from '../ui';
import ui from '../ui.module.css';

import styles from './Employer.module.css';
import { useInviteContact } from './InviteContactContext';
import { RedFlagNotice } from './RedFlagNotice';

export interface InviteFormProps {
  candidateId: string;
  candidateName: string;
  vacancyId: string | null;
  /** Подстановка вилки – из потребности или черновика помощника. */
  defaultSalaryFrom?: number;
  defaultSalaryTo?: number;
  /** Черновик помощника: текст предложения и форма сразу открыта. */
  initialMessage?: string;
  defaultOpen?: boolean;
  /** lane admin (E-08): позиция кандидата в подборке/поиске (1 = первый) и откуда отправлено – для метрики «принятые из топ-N». */
  matchRank?: number | null;
  matchSource?: InviteBody['matchSource'];
}

const parseRub = (v: string) => Number(v.replace(/\s/g, ''));
const isRub = (n: number) => Number.isInteger(n) && n > 0;

function InvitationDialog({ children, close, busy, name }: { children: ReactNode; close: () => void; busy: boolean; name: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { dialog.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={styles.invitationDialog} aria-label={`Приглашение: ${name}`} onCancel={(event) => { event.preventDefault(); if (!busy) close(); }} onClick={(event) => { if (event.target === event.currentTarget && !busy) close(); }}><div className={styles.dialogHeading}><span className={styles.status}>Приглашение кандидату</span><Button size="sm" onClick={close} disabled={busy} aria-label="Закрыть приглашение">×</Button></div><h2>{name}</h2>{children}</dialog>;
}

/** Текст у формы, когда у компании нет способа связи (E05): отправка закрыта, пока контакт не указан. */
export const NO_COMPANY_CONTACT_NOTICE = 'Кандидат должен видеть, как с вами связаться. Укажите почту или Telegram компании';

/**
 * Приглашение конкретному кандидату (R-E-05, ТЗ 2.2): описание и вилка «от–до» обязательны. Без способа связи компании
 * (InviteContactContext: null) кнопка отправки закрыта – сервер в этом случае всё равно ответит 422 company_contact_required.
 */
export function InviteForm({ candidateId, candidateName, vacancyId, defaultSalaryFrom, defaultSalaryTo, initialMessage, defaultOpen, matchRank, matchSource }: InviteFormProps) {
  const router = useRouter();
  const contactMissing = useInviteContact() === null;
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
        <Button variant="cta" className={styles.inviteTrigger} onClick={() => setOpen(true)} aria-label={`Пригласить: ${candidateName}`}>
          Пригласить с вилкой →
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
      await inviteApi({ candidateId, vacancyId, message: message.trim(), salaryFrom: from, salaryTo: to, matchRank: matchRank && Number.isInteger(matchRank) && matchRank >= 1 && matchRank <= 1000 ? matchRank : null, matchSource: matchSource ?? null });
      setDone(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось отправить приглашение');
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <form className={styles.inviteBox} onSubmit={submit} noValidate aria-label={`Приглашение: ${candidateName}`}>
      <Field
        label="Почему именно этот кандидат"
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
      {contactMissing && (
        <Notice tone="error">
          {NO_COMPANY_CONTACT_NOTICE} на странице <Link href="/employer/company">«Компания»</Link>.
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <div className={styles.actions}>
        <Button type="submit" variant="cta" size="sm" loading={busy} disabled={contactMissing}>
          Отправить приглашение
        </Button>
        <Button size="sm" onClick={() => setOpen(false)} disabled={busy}>
          Отмена
        </Button>
      </div>
    </form>
  );
  // Assistant drafts are part of the restored conversation, not requests to open a modal.
  // Keep their original inline behavior even when a historical draft is reopened.
  return defaultOpen ? form : <InvitationDialog name={candidateName} busy={busy} close={() => setOpen(false)}>{form}</InvitationDialog>;
}
