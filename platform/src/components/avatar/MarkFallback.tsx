'use client';

import { useEffect, useRef } from 'react';

import { mouthOpen, smoothLevel } from './level';
import styles from './avatar.module.css';
import type { VoiceStatus } from './voice';

/**
 * Запасной аватар без WebGL: знак ФСП на тёмном фоне. Говорит — знак пульсирует по громкости
 * (CSS-переменная --level из кадра), думает — медленно «дышит». Только CSS и requestAnimationFrame.
 */
export function MarkFallback({ status, getLevel }: { status: VoiceStatus; getLevel: () => number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (status !== 'speaking') {
      ref.current?.style.setProperty('--level', '0');
      return;
    }
    let raf = 0;
    let level = 0;
    let last = performance.now();
    const tick = (now: number) => {
      level = smoothLevel(level, getLevel(), Math.min((now - last) / 1000, 0.1));
      last = now;
      ref.current?.style.setProperty('--level', mouthOpen(level).toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status, getLevel]);

  return (
    <span ref={ref} className={styles.mark} data-status={status} data-testid="avatar-fallback" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/fsp-mark.svg" alt="" />
    </span>
  );
}
