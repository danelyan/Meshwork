import Link from 'next/link';

import styles from './Start.module.css';

/** Большая кнопка «Приступим →». Всегда ведёт на /auth (страница входа сама решает, что делать с активной сессией). */
export function Start({ inverted = false }: { inverted?: boolean }) {
  return (
    <Link href="/auth" className={`${styles.start} ${inverted ? styles.inverted : ''}`}>
      Приступим
      <svg className={styles.arrow} viewBox="0 0 56 32" fill="none" aria-hidden="true">
        <path d="M3 16h46M37 4l12 12-12 12" stroke="currentColor" strokeWidth="5" strokeLinecap="square" strokeLinejoin="miter" />
      </svg>
    </Link>
  );
}
