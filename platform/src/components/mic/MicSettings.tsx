'use client';

import { useEffect, useRef } from 'react';

import { type MicMode, setMicMode, useMicMode } from './micMode';
import styles from './mic.module.css';

const OPTIONS: { mode: MicMode; label: string }[] = [
  { mode: 'hold', label: 'Удерживать для записи' },
  { mode: 'click', label: 'Клик — начать, клик — остановить' },
];

/** Поповер «Настройки микрофона»; родитель задаёт позицию (position: relative). Esc и клик вне закрывают. */
export function MicSettings({ onClose, placement = 'above' }: { onClose: () => void; placement?: 'above' | 'below' }) {
  const mode = useMicMode();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  return (
    <div ref={ref} className={`${styles.pop} ${placement === 'below' ? styles.below : ''}`} role="dialog" aria-label="Настройки микрофона" data-testid="mic-settings">
      <strong>Настройки микрофона</strong>
      <div role="radiogroup" aria-label="Режим записи" className={styles.options}>
        {OPTIONS.map((o) => (
          <label key={o.mode} className={styles.option}>
            <input type="radio" name="mic-mode" checked={mode === o.mode} onChange={() => setMicMode(o.mode)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      <small>Нажмите правой кнопкой мыши на микрофон, чтобы открыть это меню.</small>
    </div>
  );
}

/** Шестерёнка для тач-экранов (там нет ПКМ, а долгое нажатие занято записью); на мыши скрыта CSS. */
export function MicGear({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={styles.gear} onClick={onClick} aria-label="Настройки микрофона" title="Настройки микрофона" data-testid="mic-gear">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" strokeLinecap="square" />
      </svg>
    </button>
  );
}
