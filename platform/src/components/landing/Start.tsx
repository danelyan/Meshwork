import Link from 'next/link';

import styles from './Start.module.css';

/** Гость начинает со входа, действующий пользователь продолжает в консультанте. */
export function Start({ inverted = false, signedIn = false }: { inverted?: boolean; signedIn?: boolean }) {
  return (
    <Link href={signedIn ? '/consultant' : '/auth'} className={`${styles.start} ${inverted ? styles.inverted : ''}`}>
      Приступим
      <svg className={styles.arrow} viewBox="0 0 56 32" fill="none" aria-hidden="true">
        <path d="M3 13.5H42.9L35.2 5.8L38.7 2.3L52.4 16L38.7 29.7L35.2 26.2L42.9 18.5H3Z" fill="currentColor" />
      </svg>
    </Link>
  );
}
