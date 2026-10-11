'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Field, Notice } from '@/components/ui';
import ui from '@/components/ui.module.css';
import { postJson } from '@/lib/api';

/** lane admin (E-08, фаза 2): «Оспорить» санкцию за жалобы – апелляция уходит модератору, итог придёт письмом. */
export function SanctionAppealForm({ open }: { open: { createdAt: string } | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (open) return <p data-testid="appeal-open">Апелляция на рассмотрении у модератора с {new Date(open.createdAt).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}. Итог придёт письмом.</p>;
  if (!editing) return <Button size="sm" onClick={() => setEditing(true)} data-testid="appeal-open-form">Оспорить</Button>;
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await postJson('/api/employer/sanction-appeal', { text });
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <Field label="Почему вы не согласны с ограничением" hint="Модератор проверит жалобы. Удовлетворённая апелляция снимает открытые жалобы и пересчитывает лимит.">
        <textarea className={ui.input} rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
      </Field>
      <Button size="sm" variant="primary" loading={busy} disabled={busy || text.trim().length < 20} onClick={() => void submit()}>Отправить апелляцию</Button>{' '}
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Отмена</Button>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
