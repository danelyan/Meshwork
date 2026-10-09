import type { HTMLAttributes } from 'react';

import styles from '../ui.module.css';

import { cx } from './cx';

/** Текст только для скринридеров. */
export function VisuallyHidden({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span {...rest} className={cx(styles.srOnly, className)} />;
}
