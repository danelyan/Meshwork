'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import { getSubmissionApi } from '@/lib/project-api';
import type { CandidateSubmissionView } from '@/server/project/service';

export const POLL_MS = 3000;
export const POLL_MAX_MS = 30_000;

/**
 * Опрос статуса сдачи, пока она на проверке. После ошибки сети – повтор с бэкоффом (×2 до POLL_MAX_MS),
 * на успехе задержка снова POLL_MS. Без бэкоффа опрос останавливался на первой ошибке: список не менялся,
 * эффект не перезапускался.
 */
export function useSubmissionPolling(initial: CandidateSubmissionView[]): [CandidateSubmissionView[], Dispatch<SetStateAction<CandidateSubmissionView[]>>] {
  const [subs, setSubs] = useState<CandidateSubmissionView[]>(initial);
  const [poll, setPoll] = useState({ delay: POLL_MS, attempt: 0 });
  const pending = subs.find((s) => s.status === 'submitted' || s.status === 'running');
  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const fresh = await getSubmissionApi(pending.id);
        if (cancelled) return;
        setPoll({ delay: POLL_MS, attempt: 0 });
        setSubs((list) => list.map((s) => (s.id === fresh.id ? fresh : s)));
      } catch {
        if (!cancelled) setPoll((p) => ({ delay: Math.min(p.delay * 2, POLL_MAX_MS), attempt: p.attempt + 1 }));
      }
    }, poll.delay);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [pending, poll]);
  return [subs, setSubs];
}
