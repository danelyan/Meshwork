import type { HTMLAttributes } from 'react';

import styles from '../ui.module.css';

import { cx } from './cx';

/** Кикер: моно, 11 px, верхний регистр - служебная подпись над заголовком. */
export function Kicker({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span {...rest} className={cx(styles.kicker, className)} />;
}
