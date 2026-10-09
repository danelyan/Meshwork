'use client';

import { useEffect, useRef, useState } from 'react';

/** Пользователь просит без анимации или среды без matchMedia (тесты, старые браузеры) — показываем сразу. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Длительность «печатает…»: 400–700 мс, дольше для длинной реплики. */
export const typingMs = (chars: number) => Math.min(700, 400 + chars * 2);
export type ReplyPhase = 'typing' | 'writing' | 'done';

/**
 * Фаза реплики: «печатает» (typingMs) → раскрытие (StreamingText, paced) → целиком.
 * `animate = false` — сразу целиком (история, перезагрузка), prefers-reduced-motion — тоже.
 * Таймер чистится в cleanup: StrictMode-повтор эффекта безопасен.
 */
export function useReplyPhase(total: number, animate: boolean) {
  const [phase, setPhase] = useState<ReplyPhase>(() => (animate && !prefersReducedMotion() ? 'typing' : 'done'));
  const doneRef = useRef(phase === 'done');
  useEffect(() => {
    if (phase !== 'typing') return;
    const t = setTimeout(() => setPhase('writing'), typingMs(total));
    return () => clearTimeout(t);
  }, [phase, total]);
  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setPhase('done');
  };
  return { phase, finish };
}
