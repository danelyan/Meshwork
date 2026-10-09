'use client';

import { type RefObject, useEffect } from 'react';

/** Насколько близко к низу страницы (px) считаем, что человек «внизу ленты». */
const NEAR = 200;

/**
 * Автоскролл ленты: пока человек внизу, любое увеличение ленты (новая реплика, печать по символам,
 * чипы) докручивает страницу вниз. Прокрутил вверх читать историю — не дёргаем.
 */
export function useStickToBottom(ref: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof ResizeObserver === 'undefined') return;
    const doc = document.scrollingElement ?? document.documentElement;
    let stick = true;
    let lastHeight = el.scrollHeight;
    const onScroll = () => {
      stick = doc.scrollHeight - (doc.scrollTop + window.innerHeight) < NEAR;
    };
    const ro = new ResizeObserver(() => {
      const h = el.scrollHeight;
      const grew = h > lastHeight;
      lastHeight = h;
      if (grew && stick) window.scrollTo({ top: doc.scrollHeight, behavior: 'smooth' });
    });
    ro.observe(el);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, [ref, enabled]);
}
