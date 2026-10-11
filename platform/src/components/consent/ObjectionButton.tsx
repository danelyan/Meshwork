'use client';

import { useState } from 'react';

import { createObjectionApi } from '@/lib/consent-api';
import { formatDate } from '@/lib/labels';
import type { ObjectionView } from '@/server/consent/objections';
import { OBJECTION_ANSWER_DAYS } from '@/server/consent/texts';

/**
 * «Оспорить» рядом с результатом (ст. 16 152-ФЗ, ADR 0005): кандидат пишет, с чем не согласен; ответ – в течение
 * 30 дней. Работодатель возражений не видит.
 */
export function ObjectionButton({ subject, subjectId }: { subject: ObjectionView['subject']; subjectId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ObjectionView | null>(null);
  if (done) {
    return <p role="status" data-testid="objection-sent">Возражение отправлено. Ответ придёт до {formatDate(done.dueAt)} (в течение {OBJECTION_ANSWER_DAYS} дней). Работодатель возражение не видит.</p>;
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} data-testid="objection-open" style={{ background: 'none', border: 0, padding: 0, textDecoration: 'underline', cursor: 'pointer', color: 'inherit' }}>
        Оспорить оценку
      </button>
    );
  }
  async function send() {
    setBusy(true); setError(null);
    try { setDone(await createObjectionApi({ subject, subjectId, text })); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось отправить.'); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void send(); }} data-testid="objection-form" style={{ display: 'grid', gap: 6 }}>
      <label htmlFor={`objection-${subjectId}`}>С чем вы не согласны? Оценку ставил ИИ - её пересмотрит человек, ответ в течение {OBJECTION_ANSWER_DAYS} дней.</label>
      <textarea id={`objection-${subjectId}`} value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000} />
      {error && <p role="alert">{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={busy || text.trim().length < 10}>Отправить возражение</button>
        <button type="button" onClick={() => setOpen(false)}>Отмена</button>
      </div>
    </form>
  );
}
