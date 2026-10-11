'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Field, Notice } from '@/components/ui';
import ui from '@/components/ui.module.css';

import styles from '@/app/(admin)/admin/admin.module.css';

import { adminFetch } from './adminFetch';

export interface DecisionOption {
  value: string;
  label: string;
  variant?: 'primary' | 'ghost' | 'danger';
}

/**
 * Форма решения по элементу очереди модерации (E-08, фаза 2): текст причины/ответа обязателен (уходит в журнал),
 * кнопка на каждое решение. После успеха страница перечитывается с сервера.
 */
export function ModerationDecision({
  url,
  options,
  field = 'reason',
  label = 'Причина решения (попадёт в журнал)',
  extra,
}: {
  url: string;
  options: DecisionOption[];
  field?: 'reason' | 'text';
  label?: string;
  extra?: Record<string, unknown>;
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: string) {
    setError(null);
    setBusy(decision);
    try {
      await adminFetch(url, { body: { decision, [field]: text, ...extra } });
      setText('');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.form}>
      <Field label={label}>
        <textarea className={ui.input} rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
      </Field>
      <div className={styles.row}>
        {options.map((o) => (
          <Button key={o.value} size="sm" variant={o.variant} disabled={busy !== null || text.trim().length < 5} loading={busy === o.value} onClick={() => void decide(o.value)}>
            {o.label}
          </Button>
        ))}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
