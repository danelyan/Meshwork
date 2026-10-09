'use client';

import { type RefObject, useEffect } from 'react';

/** Насколько близко к низу (px) считаем, что человек «внизу ленты». */
const NEAR = 200;

/**
 * Автоскролл ленты: пока человек внизу, любое увеличение ленты (новая реплика, печать по символам,
 * чипы) докручивает панель или страницу вниз. Прокрутил вверх читать историю - не дёргаем.
 */
export function useStickToBottom(ref: RefObject<HTMLElement | null>, enabled = true, scrollRef?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof ResizeObserver === 'undefined') return;
    const doc = document.scrollingElement ?? document.documentElement;
    const pane = scrollRef?.current;
    const target = pane ?? window;
    let stick = true;
    let lastHeight = el.scrollHeight;
    const onScroll = () => {
      stick = pane
        ? pane.scrollHeight - (pane.scrollTop + pane.clientHeight) < NEAR
        : doc.scrollHeight - (doc.scrollTop + window.innerHeight) < NEAR;
    };
    const ro = new ResizeObserver(() => {
      const h = el.scrollHeight;
      const grew = h > lastHeight;
      lastHeight = h;
      if (grew && stick) target.scrollTo({ top: pane?.scrollHeight ?? doc.scrollHeight, behavior: 'smooth' });
    });
    ro.observe(el);
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      ro.disconnect();
      target.removeEventListener('scroll', onScroll);
    };
  }, [ref, enabled, scrollRef]);
}
