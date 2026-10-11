'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';

import { VisuallyHidden } from '../ui';

import { prefersReducedMotion } from './motion';
import { createStreamSampler, type StreamSampler, telemetryOn, track } from './telemetry';
import { type RevealMode, stepReveal, visibleCut } from './smooth-text';
import styles from './thread.module.css';

/** Сколько свежий кусок проявляется (= анимация `.fresh` в thread.module.css). */
const FRESH_MS = 450;
let revealSeq = 0;

interface Mark {
  len: number;
  t: number;
}

export interface Reveal {
  /** Видимая длина текста. */
  shown: number;
  /** Отметки «к этому моменту было видно len знаков» за последние FRESH_MS — для проявления. */
  marks: Mark[];
  /** Длина, уже проявившаяся полностью (до неё — обычный текст). */
  stable: number;
  /** Весь текст показан и поток закончен. */
  done: boolean;
  /** Анимация идёт (каретка). */
  active: boolean;
}

/**
 * Плавное раскрытие растущего текста: курсор в requestAnimationFrame догоняет цель
 * (smooth-text.ts), граница — по словам. `animate=false` и prefers-reduced-motion — сразу
 * целиком, без потери текста. Снятие `animate` на лету дописывает остаток мгновенно.
 */
export function useSmoothReveal(text: string, { animate, streaming = false, paced = false }: { animate: boolean; streaming?: boolean; paced?: boolean }): Reveal {
  // Решение о prefers-reduced-motion — в эффекте: в рендере оно расходится с сервером (гидрация).
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (prefersReducedMotion()) setReduced(true);
  }, []);
  const [live] = useState(animate);
  const on = live && animate && !reduced;
  const posRef = useRef(0);
  const marksRef = useRef<Mark[]>([]);
  const stableRef = useRef(0);
  const [shown, setShown] = useState(on ? 0 : text.length);
  const streamingRef = useRef(streaming);
  streamingRef.current = streaming;
  // Телеметрия: сэмплер заводится лениво, только когда флаг включён (иначе — одна проверка за кадр).
  const samplerRef = useRef<StreamSampler | null>(null);
  const startRef = useRef(0);

  useEffect(() => {
    if (!on) {
      posRef.current = text.length;
      setShown(text.length);
      return;
    }
    let raf = 0;
    let last = -1;
    const frame = (now: number) => {
      // Первый кадр — как обычный (16 мс): отметка rAF и performance.now() бывают из разных часов.
      const dt = last < 0 ? 16 : now - last;
      last = now;
      const mode: RevealMode = paced ? 'paced' : streamingRef.current ? 'streaming' : 'settling';
      posRef.current = stepReveal(posRef.current, text.length, dt, mode);
      const cut = visibleCut(text, posRef.current, !streamingRef.current);
      if (telemetryOn()) {
        if (!samplerRef.current) {
          samplerRef.current = createStreamSampler(`r${++revealSeq}`);
          startRef.current = now;
        }
        samplerRef.current.tick(text.length, cut, now);
        if (cut >= text.length && !streamingRef.current) {
          samplerRef.current.flush(text.length, cut, now);
          track({ k: 'anim', what: 'reveal done', ms: Math.round(now - startRef.current), id: `${text.length} зн` });
        }
      }
      setShown((prev) => {
        if (cut > prev) {
          const keep: Mark[] = [];
          for (const m of marksRef.current) {
            if (now - m.t < FRESH_MS) keep.push(m);
            else stableRef.current = Math.max(stableRef.current, m.len);
          }
          marksRef.current = [...keep, { len: cut, t: now }];
        }
        return Math.max(prev, cut);
      });
      if (cut < text.length || streamingRef.current) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [on, text, streaming, paced]);

  const visible = Math.min(shown, text.length);
  const done = !streaming && visible >= text.length;
  return { shown: visible, marks: marksRef.current, stable: stableRef.current, done, active: on && !done };
}

/**
 * Кусок текста [from, to) с проявлением свежих слов: то, что открылось за последние FRESH_MS,
 * завёрнуто в span с отрицательной задержкой анимации (= возраст), поэтому перерисовка не
 * перезапускает проявление уже идущих слов.
 */
export function renderReveal(text: string, from: number, to: number, r: Reveal, now: number): ReactNode[] {
  const end = Math.min(to, r.shown);
  if (end <= from) return [];
  let stable = r.stable;
  const fresh: Mark[] = [];
  for (const m of r.marks) {
    if (now - m.t < FRESH_MS) fresh.push(m);
    else stable = Math.max(stable, m.len);
  }
  const out: ReactNode[] = [];
  let base = from;
  const plainEnd = Math.min(end, Math.max(from, stable));
  if (plainEnd > base) {
    out.push(text.slice(base, plainEnd));
    base = plainEnd;
  }
  for (const m of fresh) {
    const segEnd = Math.min(m.len, end);
    if (segEnd <= base) continue;
    out.push(
      <span key={base} className={styles.fresh} style={{ animationDelay: `${-Math.round(now - m.t)}ms` }}>
        {text.slice(base, segEnd)}
      </span>,
    );
    base = segEnd;
  }
  if (base < end) out.push(text.slice(base, end));
  return out;
}

/**
 * Текст реплики, который растёт плавно (стрим `delta` или готовая реплика в режиме `paced`).
 * Пока идёт раскрытие — каретка; для скринридера весь текст сразу, видимое — aria-hidden.
 */
export function StreamingText({
  text,
  streaming = false,
  animate = true,
  paced = false,
  onDone,
}: {
  text: string;
  streaming?: boolean;
  animate?: boolean;
  paced?: boolean;
  onDone?: () => void;
}) {
  const r = useSmoothReveal(text, { animate, streaming, paced });
  const doneRef = useRef(false);
  const cb = useRef(onDone);
  cb.current = onDone;
  useEffect(() => {
    if (r.done && !doneRef.current) {
      doneRef.current = true;
      cb.current?.();
    }
  }, [r.done]);
  const now = typeof performance === 'undefined' ? 0 : performance.now();
  return (
    <span className={styles.streaming} data-testid="streaming-text" data-done={r.done || undefined}>
      {r.active ? (
        <>
          <VisuallyHidden>{text}</VisuallyHidden>
          <span aria-hidden="true" className={styles.caret}>
            {renderReveal(text, 0, text.length, r, now)}
          </span>
        </>
      ) : (
        text
      )}
    </span>
  );
}
