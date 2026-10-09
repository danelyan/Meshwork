import type { HTMLAttributes } from 'react';

import { cx } from '../ui/cx';

import styles from './shell.module.css';

export type ContainerSize = 'text' | 'default' | 'wide';

/**
 * Колонка страницы: центр, боковые поля `--page-pad`, вертикальные отступы.
 * text - 720 px (читаемый текст), default - 960 px, wide - 1120 px (сетки карточек).
 */
export function Container({ size = 'default', className, ...rest }: HTMLAttributes<HTMLDivElement> & { size?: ContainerSize }) {
  return <div {...rest} className={cx(styles.container, styles[size], className)} />;
}
