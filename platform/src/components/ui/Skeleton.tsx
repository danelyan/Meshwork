import type { CSSProperties, HTMLAttributes } from 'react';

import styles from '../ui.module.css';

import { cx } from './cx';

export type SkeletonShape = 'block' | 'line' | 'circle';

export interface SkeletonProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** `line` – строка текста (по умолчанию), `block` – прямоугольник (карточка), `circle` – аватар. */
  shape?: SkeletonShape;
  /** CSS-размер: число – px, строка – как есть («60%»). */
  width?: number | string;
  height?: number | string;
}

/** Заглушка контента с переливом (shimmer). Декоративная: смысл несёт соседний `role="status"` или `aria-busy`. */
export function Skeleton({ shape = 'line', width, height, className, style, ...rest }: SkeletonProps) {
  const size: CSSProperties = { ...style, width, height };
  return <span {...rest} aria-hidden="true" className={cx(styles.skeleton, styles[`skeleton_${shape}`], className)} style={size} />;
}
