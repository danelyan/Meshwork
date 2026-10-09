import type { HTMLAttributes } from 'react';

import styles from '../ui.module.css';

import { cx } from './cx';

export type PanelProps = HTMLAttributes<HTMLElement> & {
  /** glass - стекло .58 (по умолчанию); strong - плотное .86 для модалок и выделенных блоков. */
  variant?: 'glass' | 'strong';
  /**
   * Тег корня. Только HTML-теги: `ElementType` после подключения @react-three/fiber включает и
   * three-элементы JSX (mesh, group …), и пропсы корня сужаются до never.
   */
  as?: 'div' | 'section' | 'li' | 'article' | 'aside' | 'header' | 'footer' | 'form';
};

/** Стеклянная панель: рамка, blur, без теней и градиентов, отступ 20 px. */
export function Panel({ variant = 'glass', as: Tag = 'div', className, ...rest }: PanelProps) {
  return <Tag {...rest} className={cx(styles.panel, variant === 'strong' && styles.panelStrong, className)} />;
}
