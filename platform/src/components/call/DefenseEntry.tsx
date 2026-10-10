'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Notice } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { startDefenseRoomApi } from '@/lib/defense-room-api';

/**
 * Кнопка входа в защиту: для сабмита проекта (`projectSubmissionId`) или «Ответить» на вопросы
 * работодателей. Лейн project может поставить её в карточку `/projects/[submissionId]`.
 */
export function DefenseEntry(props: { projectSubmissionId: string; label?: string } | { questions: true; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await startDefenseRoomApi('questions' in props ? { mode: 'questions' } : { mode: 'project', projectSubmissionId: props.projectSubmissionId });
      router.push(`/defense-room/${encodeURIComponent(r.sessionId)}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось начать защиту');
      setBusy(false);
    }
  };
  return (
    <>
      <Button onClick={() => void start()} loading={busy} data-testid="defense-entry">
        {props.label ?? ('questions' in props ? 'Ответить' : 'Защитить проект')}
      </Button>
      {busy && !('questions' in props) && <span>Читаю репозиторий и готовлю вопросы по коду - до полминуты…</span>}
      {error && <Notice tone="error">{error}</Notice>}
    </>
  );
}
