'use client';

import { useState } from 'react';

import { postJson, request } from '@/lib/api';
import type { ObjectionView } from '@/server/consent/objections';
import { Button } from '@/components/ui';

import styles from './DevPanel.module.css';

type Open = ObjectionView & { candidateId: string };

/**
 * Ответ оператора на возражения против оценки (ст. 16, ADR 0005) – только в dev-панели (localhost).
 * Отдельного интерфейса оператора на стенде нет: это ограничение, записанное в ADR.
 */
export function ObjectionsDev() {
  const [items, setItems] = useState<Open[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  async function load() {
    setError(null);
    try { setItems((await request<{ objections: Open[] }>('/api/dev/objections')).objections); }
    catch (err) { setError(err instanceof Error ? err.message : 'ошибка'); }
  }
  async function answer(id: string) {
    try { await postJson('/api/dev/objections', { id, answer: answers[id] ?? '' }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'ошибка'); }
  }
  return (
    <div className={styles.group} data-testid="dev-objections">
      <Button size="sm" className={styles.grow} onClick={() => void load()}>Возражения (ст. 16){items ? ` · ${items.length}` : ''}</Button>
      {error && <small role="alert">{error}</small>}
      {items?.map((o) => (
        <div key={o.id} style={{ width: '100%' }}>
          <small>{o.subject} · {o.subjectId} · срок {o.dueAt.slice(0, 10)}: {o.text}</small>
          <textarea aria-label="Ответ на возражение" rows={2} style={{ width: '100%' }} value={answers[o.id] ?? ''} onChange={(e) => setAnswers((v) => ({ ...v, [o.id]: e.target.value }))} />
          <Button size="sm" disabled={!answers[o.id]?.trim()} onClick={() => void answer(o.id)}>Ответить</Button>
        </div>
      ))}
    </div>
  );
}
