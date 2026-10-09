import { cloneElement, isValidElement, useId } from 'react';
import type { ReactElement, ReactNode } from 'react';

import styles from '../ui.module.css';

import { cx } from './cx';

export type FieldProps = {
  label: ReactNode;
  /** Один дочерний input/select/textarea: ему подставляются id и aria-*. */
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>;
  hint?: ReactNode;
  /** Текст ошибки: показывается с role="alert", поле получает aria-invalid. */
  error?: ReactNode;
  className?: string;
};

/** Поле формы: подпись + подсказка + ошибка, связка через id и aria-describedby. */
export function Field({ label, children, hint, error, className }: FieldProps) {
  const uid = useId();
  const id = children.props.id ?? `${uid}-control`;
  const hintId = hint ? `${uid}-hint` : undefined;
  const errorId = error ? `${uid}-error` : undefined;
  const describedBy = [children.props['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, { id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })
    : children;
  return (
    <div className={cx(styles.field, className)}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {control}
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className={cx(styles.hint, styles.fieldError)}>
          {error}
        </p>
      )}
    </div>
  );
}
