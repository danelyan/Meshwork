'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';

import { type MicMode, useMicMode } from './micMode';

/** Отпускание раньше, чем запись реально началась (getUserMedia асинхронный), помним столько. */
const PENDING_STOP_MS = 5000;

export interface MicPressOptions {
  recording: boolean;
  /** Начать запись (кнопка уже решила про согласие и т. п.). */
  onStart: () => void;
  onStop: () => void;
}

/**
 * Общее поведение кнопки микрофона для всех мест (чат, созвон).
 * hold: pointerdown (основная кнопка мыши, касание, перо) → start, pointerup/pointercancel/blur → stop;
 *   setPointerCapture держит события на кнопке, даже если палец или курсор ушли с неё.
 * click: клик начинает, клик заканчивает.
 * Клавиатура (Enter/Пробел даёт click с detail=0) в обоих режимах переключает – удержание клавиши
 * недоступно как жест, это a11y-запасной вариант.
 * ПКМ / клавиша меню (contextmenu) открывает настройки; долгое касание – это удержание, поэтому на
 * тач-устройствах вход в настройки – отдельная иконка (см. MicGear).
 */
export function useMicPress({ recording, onStart, onStop }: MicPressOptions) {
  const mode: MicMode = useMicMode();
  const [menuOpen, setMenuOpen] = useState(false);
  const held = useRef(false);
  const heldPointer = useRef<string | null>(null);
  const pendingStop = useRef(0);
  const rec = useRef(recording);
  rec.current = recording;
  const handlers = useRef({ onStart, onStop });
  handlers.current = { onStart, onStop };

  const release = useCallback(() => {
    if (!held.current) return;
    held.current = false;
    heldPointer.current = null;
    if (rec.current) handlers.current.onStop();
    else pendingStop.current = Date.now() + PENDING_STOP_MS;
  }, []);

  // Запись началась уже после отпускания – сразу закончить.
  useEffect(() => {
    if (recording && pendingStop.current) {
      const fresh = pendingStop.current > Date.now();
      pendingStop.current = 0;
      if (fresh && !held.current) handlers.current.onStop();
    }
  }, [recording]);

  // Потеря окна / переключение режима во время удержания – как отпускание.
  useEffect(() => {
    window.addEventListener('blur', release);
    return () => window.removeEventListener('blur', release);
  }, [release]);
  useEffect(() => {
    if (mode !== 'hold') release();
  }, [mode, release]);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (mode !== 'hold' || e.button !== 0 || held.current) return;
    held.current = true;
    heldPointer.current = e.pointerType;
    pendingStop.current = 0;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* указатель уже недействителен – без захвата работаем по pointerup/blur */
    }
    if (!rec.current) handlers.current.onStart();
  };
  const onPointerUp = () => release();
  const onPointerCancel = () => release();

  const onClick = (e: MouseEvent<HTMLElement>) => {
    // hold: клик от мыши/касания – хвост уже обработанного pointerdown/up; переключает только клавиатура.
    if (mode === 'hold' && e.detail !== 0) return;
    if (rec.current) handlers.current.onStop();
    else handlers.current.onStart();
  };

  const onContextMenu = (e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    // Долгое касание во время удержания – это запись, а не вызов меню.
    if (heldPointer.current === 'touch' || heldPointer.current === 'pen') return;
    setMenuOpen(true);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      setMenuOpen(true);
    }
  };

  return {
    mode,
    menuOpen,
    openMenu: () => setMenuOpen(true),
    closeMenu: () => setMenuOpen(false),
    /** Развернуть на <button>. */
    buttonProps: { onPointerDown, onPointerUp, onPointerCancel, onClick, onContextMenu, onKeyDown },
  };
}
