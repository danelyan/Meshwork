'use client';

import { useEffect, useRef, useState } from 'react';

import { telemetryOn, track } from './telemetry';

/** Пользователь просит без анимации или среды без matchMedia (тесты, старые браузеры) – показываем сразу. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Длительность «печатает…»: 400–700 мс, дольше для длинной реплики. */
export const typingMs = (chars: number) => Math.min(700, 400 + chars * 2);
export type ReplyPhase = 'typing' | 'writing' | 'done';

/**
 * Фаза реплики: «печатает» (typingMs) → раскрытие (StreamingText, paced) → целиком.
 * `animate = false` – сразу целиком (история, перезагрузка), prefers-reduced-motion – тоже.
 * Таймер чистится в cleanup: StrictMode-повтор эффекта безопасен.
 */
export function useReplyPhase(total: number, animate: boolean) {
  const [phase, setPhase] = useState<ReplyPhase>(animate ? 'typing' : 'done');
  const doneRef = useRef(phase === 'done');
  // Телеметрия: длительность каждой фазы (typing → writing → done), только у анимированных реплик.
  const phaseAt = useRef(0);
  useEffect(() => {
    if (!animate || !telemetryOn()) return;
    const t = performance.now();
    track({ k: 'anim', what: `phase ${phase}`, ms: phaseAt.current ? Math.round(t - phaseAt.current) : undefined });
    phaseAt.current = t;
  }, [phase, animate]);
  useEffect(() => {
    if (phase !== 'typing') return;
    // matchMedia нельзя читать в рендере: сервер и первый клиентский рендер должны совпасть (гидрация).
    if (prefersReducedMotion()) {
      doneRef.current = true;
      setPhase('done');
      return;
    }
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
