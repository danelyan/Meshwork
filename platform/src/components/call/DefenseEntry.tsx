'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Notice } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { callApi } from '@/lib/call-api';
import { startAiDefenseApi, startDefenseRoomApi } from '@/lib/defense-room-api';

/**
 * Кнопка входа в защиту: для сабмита проекта (`projectSubmissionId`) или «Ответить» на вопросы
 * работодателей. Лейн project может поставить её в карточку `/projects/[submissionId]`.
 */
export function DefenseEntry(props: { projectSubmissionId: string; label?: string; ai?: boolean } | { questions: true; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Согласие на запись созвона — тот же пункт и тот же текст, что у CallPanel (lane call, /api/call/consent).
  const [consent, setConsent] = useState<{ version: string; text: string[] } | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r =
        'questions' in props
          ? await startDefenseRoomApi({ mode: 'questions' })
          : props.ai
            ? await startAiDefenseApi(props.projectSubmissionId) // ADR 0008 п. 1: без приглашения и работодателя
            : await startDefenseRoomApi({ mode: 'project', projectSubmissionId: props.projectSubmissionId });
      router.push(`/defense-room/${encodeURIComponent(r.sessionId)}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'call_consent_required') {
        try {
          const list = await callApi.list('defense');
          setConsent({ version: list.consent.version, text: list.consent.text });
        } catch {
          setError('Не получилось загрузить текст согласия');
        }
      } else {
        setError(e instanceof ApiError ? e.message : 'Не получилось начать защиту');
      }
      setBusy(false);
    }
  };
  const acceptConsent = async () => {
    if (!consent) return;
    setError(null);
    try {
      await callApi.consent(consent.version);
      setConsent(null);
      await start();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Согласие не записалось');
    }
  };
  if (consent) {
    return (
      <div data-testid="call-consent" style={{ display: 'grid', gap: 10 }}>
        <b>Перед первым созвоном - согласие на запись</b>
        {consent.text.map((p) => (
          <p key={p}>{p}</p>
        ))}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button onClick={() => void acceptConsent()}>Согласен, начать защиту</Button>
          <Button variant="ghost" onClick={() => setConsent(null)}>
            Не сейчас
          </Button>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    );
  }
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
