'use client';

import { useState, type FormEvent } from 'react';

import { ApiError } from '@/lib/api';
import { complainInvitationApi, type ComplaintReasonValue } from '@/lib/employer-api';

import { Button, Field, Notice } from '../ui';
import ui from '../ui.module.css';

import styles from './Candidate.module.css';

const REASONS: { id: ComplaintReasonValue; label: string }[] = [
  { id: 'spam', label: 'Массовая рассылка, не про меня' },
  { id: 'salary_mismatch', label: 'Вилка не соответствует реальности' },
  { id: 'offensive', label: 'Оскорбительный текст' },
  { id: 'fake_company', label: 'Похоже на фиктивную компанию' },
  { id: 'other', label: 'Другое' },
];

/** lane complaints (R-X-01): жалоба на полученное приглашение. Статус приглашения не меняет. */
export function ComplaintForm({ invitationId, filed }: { invitationId: string; filed: boolean }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(filed);
  const [reason, setReason] = useState<ComplaintReasonValue>('spam');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) return <p className={styles.meta} role="status" data-testid="complaint-filed">Жалоба отправлена. Компания не видит, кто пожаловался.</p>;
  if (!open) return <div className={styles.actions}><Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Пожаловаться</Button></div>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await complainInvitationApi(invitationId, reason, comment.trim());
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setDone(true);
      else setError(err instanceof Error ? err.message : 'Не удалось отправить жалобу.');
    } finally {
      setBusy(false);
    }
  }

  return <form onSubmit={submit} className={styles.stack} aria-label="Жалоба на приглашение">
    <Field label="Причина жалобы">
      <select className={ui.input} value={reason} onChange={(e) => setReason(e.target.value as ComplaintReasonValue)}>
        {REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
    </Field>
    <Field label="Комментарий (необязательно)" hint="До 1000 символов">
      <textarea className={ui.input} rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
    </Field>
    {error && <Notice tone="error">{error}</Notice>}
    <div className={styles.actions}>
      <Button type="submit" size="sm" variant="primary" loading={busy} disabled={busy}>Отправить жалобу</Button>
      <Button size="sm" disabled={busy} onClick={() => setOpen(false)}>Отмена</Button>
    </div>
    <p className={styles.fine}>Жалобы снижают лимит приглашений компании. Приглашение останется в списке: отклонить его можно отдельно.</p>
  </form>;
}
