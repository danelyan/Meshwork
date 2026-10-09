'use client';

import { useEffect, useRef, useState } from 'react';

/** Пользователь просит без анимации или среды без matchMedia (тесты, старые браузеры) — показываем сразу. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Длительность «печатает…»: 400–700 мс, дольше для длинной реплики. */
export const typingMs = (chars: number) => Math.min(700, 400 + chars * 2);
/** Очень длинные реплики появляются целиком; остальные печатаются не дольше WRITE_MAX_MS. */
export const TYPE_MAX_CHARS = 600;
export const CHAR_MS = 18;
export const WRITE_MAX_MS = 1200;
/** Символов за тик: короткие — по одному (18 мс/символ), длинные — быстрее, чтобы не ждать. */
export const charsPerTick = (total: number) => Math.max(1, Math.ceil(total / (WRITE_MAX_MS / CHAR_MS)));

export type ReplyPhase = 'typing' | 'writing' | 'done';

/**
 * Появление реплики: «печатает» → посимвольно → целиком. `animate = false` — сразу целиком
 * (история, перезагрузка). Таймеры чистятся в cleanup: StrictMode-повтор эффекта безопасен.
 */
export function useTypewriter(total: number, animate: boolean) {
  const [phase, setPhase] = useState<ReplyPhase>(animate ? 'typing' : 'done');
  const [shown, setShown] = useState(animate ? 0 : total);
  const doneRef = useRef(!animate);
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (doneRef.current) return;
    if (prefersReducedMotion()) {
      doneRef.current = true;
      setShown(total);
      setPhase('done');
      return;
    }
    let n = 0;
    let tick: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      if (total > TYPE_MAX_CHARS) {
        doneRef.current = true;
        setShown(total);
        setPhase('done');
        return;
      }
      setPhase('writing');
      const k = charsPerTick(total);
      tick = setInterval(() => {
        n = Math.min(total, n + k);
        setShown(n);
        if (n >= total) {
          clearInterval(tick);
          doneRef.current = true;
          setPhase('done');
        }
      }, CHAR_MS);
    }, typingMs(total));
    const stop = () => {
      clearTimeout(start);
      if (tick) clearInterval(tick);
    };
    stopRef.current = stop;
    return stop;
  }, [total]);

  const finish = () => {
    if (doneRef.current) return;
    stopRef.current();
    doneRef.current = true;
    setShown(total);
    setPhase('done');
  };

  return { phase, shown: phase === 'done' ? total : shown, finish };
}
