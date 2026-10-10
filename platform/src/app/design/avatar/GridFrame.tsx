'use client';

import { useEffect, useRef } from 'react';

import { ACCEPTED_GRID_SETTINGS } from '@/components/design/grid-preview-settings';

import styles from './preview.module.css';

/**
 * Iframe-макет Карины. Канал у макетов один: connect → ready → settings (+ pointer у v3).
 * Канала речи и вращения нет, поэтому здесь только слежение за курсором.
 */
export function GridFrame({ source, title }: { source: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const origin = window.location.origin;
    const post = (message: object) => frame.current?.contentWindow?.postMessage(message, origin);
    const receive = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'fsp-grid-ready') post({ type: 'fsp-grid-settings', settings: ACCEPTED_GRID_SETTINGS });
    };
    const move = (event: PointerEvent) => {
      const bounds = frame.current?.getBoundingClientRect();
      if (bounds) post({ type: 'fsp-grid-pointer', x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    };
    window.addEventListener('message', receive);
    window.addEventListener('pointermove', move);
    post({ type: 'fsp-grid-connect' });
    return () => {
      window.removeEventListener('message', receive);
      window.removeEventListener('pointermove', move);
    };
  }, [source]);
  return <iframe ref={frame} src={source} title={title} className={styles.gridFrame} onLoad={() => frame.current?.contentWindow?.postMessage({ type: 'fsp-grid-connect' }, window.location.origin)} />;
}
