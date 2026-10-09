'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { createHeadRenderer, type HeadRenderer } from './renderer';
import styles from './ConsultantScene.module.css';

/** Decorative only: never captures focus, touch, scroll, or chat input. */
export function ConsultantHead() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>('loading');
  useEffect(() => {
    const desktop = matchMedia('(min-width: 1051px)');
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let stop = () => {};
    const sync = () => {
      stop();
      if (!desktop.matches || !canvas.current) return;
      const controller = new AbortController();
      let renderer: HeadRenderer | undefined;
      setState('loading');
      stop = () => { controller.abort(); renderer?.dispose(); };
      createHeadRenderer(canvas.current, controller.signal, motion.matches, () => {
        stop(); setState('fallback');
      }).then(instance => {
        if (controller.signal.aborted) { instance.dispose(); return; }
        renderer = instance; setState('ready');
      }).catch(() => { if (!controller.signal.aborted) setState('fallback'); });
    };
    desktop.addEventListener('change', sync); motion.addEventListener('change', sync); sync();
    return () => { stop(); desktop.removeEventListener('change', sync); motion.removeEventListener('change', sync); };
  }, []);
  return <div className={styles.portrait} aria-hidden="true" data-head-state={state}>
    <canvas ref={canvas} className={styles.canvas} />
    {state !== 'ready' && <div className={styles.fallback}><Image src="/models/head-reference.png" alt="" width={332} height={313} unoptimized /></div>}
    <span className={styles.caption}>Карьерный консультант / ФСП</span>
  </div>;
}
