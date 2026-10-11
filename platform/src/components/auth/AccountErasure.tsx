'use client';

import { useState } from 'react';
import { Button, Field, Notice, Panel } from '@/components/ui';
import { readError } from '@/lib/api';

export function AccountErasure() {
  const [reason, setReason] = useState<'delete' | 'withdraw' | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function erase() {
    if (!reason || confirmation !== 'УДАЛИТЬ' || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/auth/account', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason, confirmation }) });
      if (!response.ok) throw await readError(response);
      window.location.assign('/');
    } catch (e) { setError(e instanceof Error ? e.message : 'Удаление не завершено. Повторите запрос.'); setBusy(false); }
  }
  return <Panel>
    <h2>Управление данными</h2>
    {!reason ? <>
      <p>Вы можете отозвать согласие с удалением данных или удалить аккаунт. Это касается обоих профилей, если вы также нанимаете.</p>
      <Button variant="ghost" style={{ borderColor: 'var(--danger-accent)', color: 'var(--danger-accent)' }} onClick={() => setReason('withdraw')}>Отозвать согласие и удалить данные</Button>{' '}
      <Button variant="danger" style={{ background: 'var(--danger-accent)', borderColor: 'var(--danger-accent)', color: 'var(--on-ink)' }} onClick={() => setReason('delete')}>Удалить аккаунт</Button>
    </> : <form onSubmit={(e) => { e.preventDefault(); void erase(); }}>
      <p>Будут удалены аккаунт, профили кандидата и работодателя, ответы, файлы, записи завершённых созвонов, результаты и избранное. Это действие нельзя отменить. Общие демонстрационные аккаунты защищены от удаления.</p>
      <Field label="Для подтверждения введите УДАЛИТЬ"><input autoComplete="off" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={busy} /></Field>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" variant="danger" loading={busy} disabled={confirmation !== 'УДАЛИТЬ'}>Подтвердить удаление</Button>{' '}
      <Button type="button" variant="ghost" disabled={busy} onClick={() => { setReason(null); setConfirmation(''); setError(null); }}>Отмена</Button>
    </form>}
  </Panel>;
}
