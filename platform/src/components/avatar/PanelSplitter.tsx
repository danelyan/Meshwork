'use client';

import { type KeyboardEvent, type PointerEvent, type RefObject, useEffect, useState } from 'react';

import styles from './AvatarScene.module.css';

const KEY = 'fsp:consultant-panel-w';
const MIN = 340;
const STEP = 24;

/** Пределы ширины чата: не уже MIN и не шире 70% сцены (правой части остаётся место под голову и карточки). */
const clampW = (w: number, total: number) => Math.round(Math.min(Math.max(w, MIN), Math.max(MIN, total * 0.7)));

/**
 * Разделитель между чатом и сценой (владелец 11.10: «разделитель надо иметь возможность тянуть»).
 * Ширина — CSS-переменная --panel-w на сцене, запоминается в браузере (только удобство: без хранилища — по умолчанию).
 * Двойной клик — сброс. Клавиатура: стрелки влево/вправо.
 */
export function PanelSplitter({ scene }: { scene: RefObject<HTMLDivElement | null> }) {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(KEY));
      if (saved > 0) setWidth(saved);
    } catch {
      /* без хранилища — ширина по умолчанию */
    }
  }, []);

  useEffect(() => {
    const el = scene.current;
    if (!el) return;
    if (width === null) el.style.removeProperty('--panel-w');
    else el.style.setProperty('--panel-w', `${clampW(width, el.clientWidth)}px`);
  }, [width, scene]);

  const save = (w: number | null) => {
    setWidth(w);
    try {
      if (w === null) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, String(w));
    } catch {
      /* только удобство */
    }
  };

  const current = () => width ?? scene.current?.querySelector<HTMLElement>('[data-testid="side-panel"]')?.getBoundingClientRect().width ?? MIN;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = scene.current;
    if (!el) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const left = el.getBoundingClientRect().left;
    const move = (ev: globalThis.PointerEvent) => setWidth(clampW(ev.clientX - left, el.clientWidth));
    const up = (ev: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      save(clampW(ev.clientX - left, el.clientWidth));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = scene.current;
    if (!el || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    save(clampW(current() + (e.key === 'ArrowRight' ? STEP : -STEP), el.clientWidth));
  };

  return (
    <div
      className={styles.splitter}
      role="separator"
      aria-orientation="vertical"
      aria-label="Ширина чата"
      aria-valuenow={Math.round(width ?? current())}
      aria-valuemin={MIN}
      tabIndex={0}
      title="Потяни, чтобы изменить ширину чата; двойной клик — по умолчанию"
      onPointerDown={onPointerDown}
      onDoubleClick={() => save(null)}
      onKeyDown={onKey}
      data-testid="panel-splitter"
    />
  );
}
