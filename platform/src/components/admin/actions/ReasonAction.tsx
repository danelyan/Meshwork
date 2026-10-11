'use client';

import { useState } from 'react';

import { Button, Field, Notice, Panel } from '@/components/ui';
import ui from '@/components/ui.module.css';

import styles from '@/app/(admin)/admin/admin.module.css';

import { adminFetch } from '../adminFetch';

export interface ReasonActionProps {
  /** Текст кнопки, открывающей форму. */
  label: string;
  /** Что произойдёт — показывается над формой. */
  description: string;
  url: string;
  method: 'POST' | 'DELETE';
  /** Дополнительные поля тела запроса (кроме reason/until/confirm). */
  body?: Record<string, unknown>;
  danger?: boolean;
  /** Поле «срок» (datetime-local, пусто — бессрочно). */
  withUntil?: boolean;
  /** Второе подтверждение: нужно вручную ввести эту строку (например, id пользователя) — уходит как `confirm`. */
  confirmText?: string;
  submitLabel?: string;
  onDone?: (result: unknown) => void;
}

/**
 * Действие админки с обязательной причиной (уходит в журнал): кнопка → форма → запрос. Первое подтверждение —
 * открыть форму и нажать «Подтвердить», второе (если `confirmText`) — ввести строку вручную.
 */
export function ReasonAction({ label, description, url, method, body, danger, withUntil, confirmText, submitLabel = 'Подтвердить', onDone }: ReasonActionProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!open) {
    return (
      <Button size="sm" variant={danger ? 'danger' : 'ghost'} onClick={() => { setOpen(true); setDone(false); }}>
        {label}
      </Button>
    );
  }
  const confirmOk = !confirmText || confirm.trim() === confirmText;
  return (
    <Panel className={styles.form}>
      <p className={styles.muted}>{description}</p>
      {error && <Notice tone="error">{error}</Notice>}
      {done && <Notice>Готово, записано в журнал.</Notice>}
      <form
        className={styles.form}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!confirmOk) return;
          setBusy(true);
          setError(null);
          try {
            const payload: Record<string, unknown> = { ...body, reason };
            if (withUntil) payload.until = until ? new Date(until).toISOString() : null;
            if (confirmText) payload.confirm = confirm.trim();
            const result = await adminFetch<unknown>(url, { method, body: payload });
            setDone(true);
            setOpen(false);
            setReason('');
            setConfirm('');
            onDone?.(result);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Ошибка');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Причина (попадёт в журнал, без персональных данных)">
          <textarea className={ui.input} required minLength={5} maxLength={1000} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {withUntil && (
          <Field label="Срок" hint="Пусто — бессрочно">
            <input className={ui.input} type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
          </Field>
        )}
        {confirmText && (
          <Field label={`Для подтверждения введите: ${confirmText}`}>
            <input className={ui.input} autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
        )}
        <div className={styles.row}>
          <Button type="submit" size="sm" variant={danger ? 'danger' : 'primary'} loading={busy} disabled={!confirmOk}>
            {submitLabel}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Отмена
          </Button>
        </div>
      </form>
    </Panel>
  );
}
