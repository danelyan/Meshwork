'use client';

import { useState } from 'react';

import type { CallView } from '@/server/call/types';

import styles from './Employer.module.css';

const ROLE: Record<string, string> = { ai: 'Кира', candidate: 'Кандидат', employer: 'Работодатель' };

/**
 * Транскрипт и запись созвона в карточке кандидата у работодателя. Данные берутся лениво из GET /api/call/{id}:
 * права решает сервер (server/call/access.ts) — до принятого приглашения с согласием кандидата приходит
 * access=summary, и блок объясняет, когда откроется; после — транскрипт, аудио и сегменты видео.
 */
export function CallEvidence({ callId }: { callId: string }) {
  const [view, setView] = useState<CallView | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const load = async () => {
    if (view || state === 'loading') return;
    setState('loading');
    try {
      const r = await fetch(`/api/call/${encodeURIComponent(callId)}`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(String(r.status));
      setView((await r.json()) as CallView);
      setState('idle');
    } catch {
      setState('error');
    }
  };
  return (
    <details className={styles.evidenceDetails} onToggle={(e) => e.currentTarget.open && void load()} data-testid="call-evidence">
      <summary>Транскрипт и запись созвона</summary>
      {state === 'loading' && <p className={styles.meta}>Загружаю…</p>}
      {state === 'error' && <p className={styles.note}>Не удалось загрузить созвон - попробуйте ещё раз.</p>}
      {view && view.access !== 'full' && (
        <p className={styles.note} data-testid="call-evidence-locked">
          Транскрипт и запись открываются после того, как кандидат примет приглашение и даст согласие на раскрытие. Пока видна только карта глубины.
        </p>
      )}
      {view && view.access === 'full' && (
        <div className={styles.stage} data-testid="call-evidence-full">
          {view.hasRecording && (
            <audio controls preload="none" src={`/api/call/${encodeURIComponent(callId)}/recording`} aria-label="Запись созвона" style={{ width: '100%' }} />
          )}
          {view.videoSegments.length > 0 && (
            <div className={styles.meta}>
              Видео с камеры:{' '}
              {view.videoSegments.map((seg, i) => (
                <a key={seg.name} href={`/api/call/${encodeURIComponent(callId)}/video?segment=${encodeURIComponent(seg.name)}`} target="_blank" rel="noreferrer">
                  часть {i + 1}
                </a>
              ))}
            </div>
          )}
          {!view.hasRecording && view.videoSegments.length === 0 && <p className={styles.meta}>Записи нет: созвон шёл текстом или запись удалена по сроку хранения.</p>}
          {view.transcript && view.transcript.length > 0 ? (
            <ul className={styles.why} aria-label="Транскрипт созвона">
              {view.transcript.map((e) => (
                <li key={e.index}>
                  <b>{ROLE[e.role] ?? e.role}:</b> {e.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.meta}>Транскрипт пуст.</p>
          )}
        </div>
      )}
    </details>
  );
}
