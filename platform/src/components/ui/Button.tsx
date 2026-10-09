import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentProps, Ref } from 'react';

import styles from '../ui.module.css';

import { cx } from './cx';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'cta' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

type Common = {
  /** primary - чёрная (hover синяя); cta - синяя (hover чёрная); ghost - призрак; danger - красный контур. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
};

type AsButton = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
    href?: undefined;
    /** Идёт операция: кнопка блокируется, показывается спиннер, aria-busy. */
    loading?: boolean;
    ref?: Ref<HTMLButtonElement>;
  };

type AsLink = Common &
  Omit<ComponentProps<typeof Link>, 'className' | 'ref'> &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'href'> & {
    href: string;
    loading?: undefined;
    ref?: Ref<HTMLAnchorElement>;
  };

export type ButtonProps = AsButton | AsLink;

const VARIANT: Record<ButtonVariant, string | undefined> = {
  primary: styles.primary,
  cta: styles.cta,
  ghost: undefined,
  danger: styles.danger,
};

/** Кнопка. С `href` рендерится как next/link с тем же видом. React 19: ref - обычный проп. */
export function Button(props: ButtonProps) {
  const { variant = 'ghost', size = 'md', className, ...rest } = props;
  const cls = cx(styles.btn, VARIANT[variant], size === 'sm' && styles.small, className);

  if (rest.href !== undefined) {
    const { loading: _l, ...link } = rest as AsLink;
    void _l;
    return <Link {...link} className={cls} />;
  }
  const { loading, disabled, children, type = 'button', ...btn } = rest as AsButton;
  return (
    <button {...btn} type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}
