import type { CSSProperties } from 'react';

import styles from '../ui.module.css';

import { cx } from './cx';

/** Силуэт-аватар (квадрат, фото не используем). Декоративный: имя рядом в тексте. */
export function Avatar({ size = 56, className }: { size?: number; className?: string }) {
  return (
    <span className={cx(styles.avatar, className)} style={{ '--avatar': `${size}px` } as CSSProperties} aria-hidden="true" data-testid="avatar">
      <svg viewBox="0 0 44 44" focusable="false">
        <circle cx="22" cy="16" r="8" />
        <path d="M6 44c1.5-10 8-15 16-15s14.5 5 16 15z" />
      </svg>
    </span>
  );
}
