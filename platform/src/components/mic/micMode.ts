'use client';

import { useSyncExternalStore } from 'react';

// Режим кнопок микрофона (решение владельца 11.10): по умолчанию «удерживать» (push-to-talk), «клик» —
// клик начинает запись, клик заканчивает. Один выбор на все кнопки (чат, созвон); хранится в localStorage.

export type MicMode = 'hold' | 'click';

export const MIC_MODE_KEY = 'fsp:mic-mode';
const EVENT = 'fsp:mic-mode';

export function readMicMode(): MicMode {
  try {
    return window.localStorage.getItem(MIC_MODE_KEY) === 'click' ? 'click' : 'hold';
  } catch {
    return 'hold';
  }
}

export function setMicMode(mode: MicMode) {
  try {
    if (mode === 'click') window.localStorage.setItem(MIC_MODE_KEY, 'click');
    else window.localStorage.removeItem(MIC_MODE_KEY);
  } catch {
    /* хранилище недоступно — режим действует до перезагрузки только в этом вызове */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Текущий режим; на сервере и при гидрации — `hold`. */
export function useMicMode(): MicMode {
  return useSyncExternalStore(subscribe, readMicMode, () => 'hold');
}

export const MIC_HINT: Record<MicMode, string> = {
  hold: 'Удерживайте, чтобы говорить',
  click: 'Нажмите, чтобы начать запись',
};
