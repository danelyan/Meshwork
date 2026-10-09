import Link from 'next/link';

import { cx } from '../ui/cx';

import styles from './shell.module.css';

/** Знак ФСП + «/карьера». Бренд везде одинаковый: шапка, онбординг, главная. */
export function Brand({ className }: { className?: string }) {
  return (
    <Link className={cx(styles.brand, className)} href="/" aria-label="ФСП Карьера, на главную">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/fsp-mark.svg" alt="" />
      <span>/карьера</span>
    </Link>
  );
}
