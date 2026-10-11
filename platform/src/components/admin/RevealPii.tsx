'use client';

import { useState } from 'react';

import { Button, Notice } from '@/components/ui';
import ui from '@/components/ui.module.css';

import styles from '@/app/(admin)/admin/admin.module.css';

import { adminFetch } from './adminFetch';

type Pii = Record<string, unknown>;

const FIELD_LABEL: Record<string, string> = { name: 'ФИО', email: 'Почта', contact: 'Контакт', phone: 'Телефон' };

function Value({ v }: { v: unknown }) {
  if (Array.isArray(v)) {
    return (
      <>
        {v.map((x, i) => (
          <div key={i}>{typeof x === 'object' && x ? Object.values(x as Pii).filter((y) => y !== null && !/^[a-z0-9]{20,}$/i.test(String(y))).join(' · ') : String(x)}</div>
        ))}
      </>
    );
  }
  return <>{v === null || v === '' ? '—' : String(v)}</>;
}

/**
 * Кнопка «Показать» ПДн (принцип 4 E-08): сначала причина, потом запрос; сервер пишет раскрытие в журнал.
 * Значения живут только в состоянии компонента — после перезагрузки страница снова скрывает их.
 */
export function RevealPii({ url, canReveal }: { url: string; canReveal: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Pii | null>(null);

  if (!canReveal) return <p className={styles.muted}>Раскрытие ПДн для вашей роли недоступно.</p>;

  if (data) {
    return (
      <dl className={styles.pii}>
        {Object.entries(data).map(([k, v]) => (
          <div key={k}>
            <dt>{k === 'representatives' ? 'Представители' : (FIELD_LABEL[k] ?? k)}</dt>
            <dd>
              <Value v={v} />
            </dd>
          </div>
        ))}
        <p className={styles.muted}>Раскрытие записано в журнал.</p>
      </dl>
    );
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Показать ПДн
      </Button>
    );
  }

  return (
    <form
      className={styles.form}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          setData(await adminFetch<Pii>(url, { body: { reason } }));
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Не удалось раскрыть');
        } finally {
          setBusy(false);
        }
      }}
    >
      <input className={ui.input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина (не короче 5 символов), например: обращение в поддержку №…" aria-label="Причина раскрытия" required minLength={5} maxLength={1000} />
      {error && <Notice tone="error">{error}</Notice>}
      <div className={styles.row}>
        <Button type="submit" size="sm" loading={busy}>
          Раскрыть
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
