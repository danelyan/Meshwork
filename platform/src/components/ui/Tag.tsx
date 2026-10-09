import type { HTMLAttributes } from 'react';

import styles from '../ui.module.css';

import { cx } from './cx';

export type TagTone = 'plain' | 'outline' | 'solid' | 'dashed';

const TONE: Record<TagTone, string | undefined> = {
  plain: undefined, // серая заливка
  outline: styles.outline, // тонкий контур
  solid: styles.solid, // синяя заливка
  dashed: styles.red, // пунктир (прежнее имя .red)
};

/** Моно-метка. Тон различим формой рамки, не только цветом. */
export function Tag({ tone = 'plain', className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: TagTone }) {
  return <span {...rest} className={cx(styles.tag, TONE[tone], className)} />;
}
