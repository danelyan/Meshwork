import type { ButtonHTMLAttributes, Ref } from 'react';

import styles from '../ui.module.css';

import { cx } from './cx';

export type ChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> & {
  /** Выбран: чёрная заливка, aria-pressed=true. */
  pressed?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

/** Чип-фильтр (кнопка-переключатель, 40 px). */
export function Chip({ pressed = false, className, type = 'button', ...rest }: ChipProps) {
  return <button {...rest} type={type} aria-pressed={pressed} className={cx(styles.chip, className)} />;
}
