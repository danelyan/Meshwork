'use client';

import { type RefObject, useEffect } from 'react';

/** Насколько близко к низу (px) считаем, что человек «внизу ленты». */
const NEAR = 200;

/**
 * Панель с собственной прокруткой, помеченная `data-feed-scroll` (панель чата в сцене звонка);
 * null — лента прокручивается вместе с окном. Явная метка, а не поиск по overflow: остальные экраны не меняются.
 */
export function nearestScrollPane(el: Element | null): HTMLElement | null {
  const pane = el?.closest<HTMLElement>('[data-feed-scroll]') ?? null;
  // На узком экране панель не прокручивается сама (overflow: visible) - тогда едет окно.
  return pane && /auto|scroll/.test(getComputedStyle(pane).overflowY) ? pane : null;
}

/**
 * Показать конец ленты. Если лента внутри панели с собственной прокруткой (сцена звонка), крутим только
 * панель: scrollIntoView двигал бы ещё и окно. Без панели — как раньше, scrollIntoView.
 */
export function scrollToEnd(end: Element | null | undefined, behavior: ScrollBehavior = 'smooth') {
  if (!end) return;
  const pane = nearestScrollPane(end);
  if (pane) pane.scrollTo({ top: pane.scrollHeight, behavior });
  else end.scrollIntoView?.({ block: 'end', behavior });
}

/**
 * Автоскролл ленты: пока человек внизу, любое увеличение ленты (новая реплика, печать по символам,
 * чипы) докручивает панель или страницу вниз. Прокрутил вверх читать историю - не дёргаем.
 */
export function useStickToBottom(ref: RefObject<HTMLElement | null>, enabled = true, scrollRef?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof ResizeObserver === 'undefined') return;
    const doc = document.scrollingElement ?? document.documentElement;
    const pane = scrollRef?.current ?? nearestScrollPane(el);
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
