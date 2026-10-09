'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { createHeadRenderer, type HeadRenderer } from './renderer';
import styles from './ConsultantScene.module.css';

/** Decorative surface; only the explicit motion toggle accepts input. */
export function ConsultantHead() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const current = useRef<HeadRenderer | undefined>(undefined);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>('loading');
  useEffect(() => {
    pausedRef.current = paused;
    current.current?.setPaused?.(paused);
  }, [paused]);
  useEffect(() => {
    const desktop = matchMedia('(min-width: 1051px)');
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let stop = () => {};
    const sync = () => {
      stop();
      setReducedMotion(motion.matches);
      if (!desktop.matches || !canvas.current || !anchor.current) return;
      const controller = new AbortController();
      let renderer: HeadRenderer | undefined;
      setState('loading');
      stop = () => { controller.abort(); renderer?.dispose(); current.current = undefined; };
      createHeadRenderer(canvas.current, controller.signal, motion.matches, () => {
        stop(); setState('fallback');
      }, anchor.current).then(instance => {
        if (controller.signal.aborted) { instance.dispose(); return; }
        renderer = instance; current.current = instance;
        instance.setPaused?.(pausedRef.current); setState('ready');
      }).catch(() => { if (!controller.signal.aborted) setState('fallback'); });
    };
    desktop.addEventListener('change', sync); motion.addEventListener('change', sync); sync();
    return () => { stop(); desktop.removeEventListener('change', sync); motion.removeEventListener('change', sync); };
  }, []);
  return <>
    <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
    <div ref={anchor} className={styles.portrait} data-head-state={state}>
      <div className={styles.caption}>
        {state === 'ready' && !reducedMotion && <Button size="sm" className={styles.motionToggle} onClick={() => setPaused(value => !value)}>
          {paused ? 'Включить анимацию' : 'Остановить анимацию'}
        </Button>}
      </div>
    </div>
  </>;
}
