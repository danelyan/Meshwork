import type { ReactNode } from 'react';

import styles from './Segmented.module.css';
import { cx } from './cx';

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  /** Полное название для скринридера, если видимая подпись короткая. */
  ariaLabel?: string;
}

export interface SegmentedProps<V extends string> {
  options: SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Название группы для скринридера. */
  label: string;
  /** Плотный вариант для узких карточек. */
  compact?: boolean;
  className?: string;
}

/**
 * Сегментированный переключатель вида: активный сегмент – акцентная заливка, неактивный – прозрачный,
 * приглушённый текст, рамка --line. Цвета читают локальные --seg-*, по умолчанию из смысловых токенов
 * страницы (светлая/тёмная тема меняют их сами); сцена переопределяет --seg-* на свои --stage-*.
 */
export function Segmented<V extends string>({ options, value, onChange, label, compact = false, className }: SegmentedProps<V>) {
  return (
    <div className={cx(styles.segmented, compact && styles.compact, className)} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} aria-label={o.ariaLabel} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
