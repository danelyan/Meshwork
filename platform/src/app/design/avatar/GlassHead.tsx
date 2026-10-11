'use client';

import { useEffect, useRef, useState } from 'react';

import type { HeadRenderer } from '@/components/head/renderer';
import { Notice } from '@/components/ui';

import type { OrbitState } from './orbit';
import type { MouthBus } from './variants';
import styles from './preview.module.css';

/** Стеклянная голова Карины (raw WebGL2): создаётся только пока панель смонтирована. */
export function GlassHead({ orbit, bus }: { orbit: OrbitState; bus: MouthBus }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const abort = new AbortController();
    let renderer: HeadRenderer | undefined;
    let unsubscribe: (() => void) | undefined;
    let raf = 0;
    let last = { yaw: NaN, pitch: NaN };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const spin = () => {
      const o = orbit.read(performance.now());
      if (o.yaw !== last.yaw || o.pitch !== last.pitch) {
        last = o;
        renderer?.setOrbit?.(o.yaw, o.pitch);
      }
      raf = requestAnimationFrame(spin);
    };
    void import('@/components/head/renderer')
      .then(({ createHeadRenderer }) => createHeadRenderer(el, abort.signal, reduced, () => setError('WebGL-контекст потерян – обновите страницу.')))
      .then((r) => {
        if (abort.signal.aborted) {
          r.dispose();
          return;
        }
        renderer = r;
        unsubscribe = bus.subscribe((m) => r.setSpeech?.(m.open, m.round, m.wide));
        raf = requestAnimationFrame(spin);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError('Не удалось запустить WebGL 2 или загрузить модель.');
      });
    return () => {
      abort.abort();
      cancelAnimationFrame(raf);
      unsubscribe?.();
      renderer?.dispose();
    };
  }, [orbit, bus]);
  return (
    <>
      <canvas ref={canvas} className={styles.glassCanvas} aria-hidden="true" />
      {error && <div className={styles.stageNote}><Notice tone="error">{error}</Notice></div>}
    </>
  );
}
