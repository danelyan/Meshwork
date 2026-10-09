import type { HTMLAttributes } from 'react';

import styles from '../ui.module.css';

import { cx } from './cx';

/** info - нейтральная заметка (role=status); error - ошибка (role=alert). */
export function Notice({ tone = 'info', className, role, ...rest }: HTMLAttributes<HTMLParagraphElement> & { tone?: 'info' | 'error' }) {
  return <p {...rest} role={role ?? (tone === 'error' ? 'alert' : 'status')} className={cx(styles.notice, tone === 'error' && styles.errorBox, className)} />;
}
