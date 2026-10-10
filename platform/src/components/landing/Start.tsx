import Link from 'next/link';

import styles from './Start.module.css';

/** Гость начинает со входа, действующий пользователь продолжает в консультанте. */
export function Start({ inverted = false, signedIn = false }: { inverted?: boolean; signedIn?: boolean }) {
  return (
    <Link href={signedIn ? '/consultant' : '/auth'} className={`${styles.start} ${inverted ? styles.inverted : ''}`}>
      Приступим
      <svg className={styles.arrow} viewBox="0 0 56 32" fill="none" aria-hidden="true">
        <path d="M3 16h46M37 4l12 12-12 12" stroke="currentColor" strokeWidth="5" strokeLinecap="square" strokeLinejoin="miter" />
      </svg>
    </Link>
  );
}
