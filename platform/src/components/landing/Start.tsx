import Link from 'next/link';

import styles from './Start.module.css';

/** Большая кнопка «Приступим →». Всегда ведёт на /auth (страница входа сама решает, что делать с активной сессией). */
export function Start({ inverted = false }: { inverted?: boolean }) {
  return (
    <Link href="/auth" className={`${styles.start} ${inverted ? styles.inverted : ''}`}>
      Приступим <span aria-hidden="true">→</span>
    </Link>
  );
}
