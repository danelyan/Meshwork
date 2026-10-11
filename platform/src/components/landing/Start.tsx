import Link from 'next/link';

import styles from './Start.module.css';

/** Главная кнопка открывает знакомство; вход гостя сохраняет этот адрес. */
export function Start({ inverted = false, signedIn = false }: { inverted?: boolean; signedIn?: boolean }) {
  return (
    <Link href={signedIn ? '/consultant?mode=intake' : '/auth?next=%2Fconsultant%3Fmode%3Dintake'} className={`${styles.start} ${inverted ? styles.inverted : ''}`}>
      Приступим
      <svg className={styles.arrow} viewBox="0 0 56 32" fill="none" aria-hidden="true">
        <path d="M3 13.5H42.9L35.2 5.8L38.7 2.3L52.4 16L38.7 29.7L35.2 26.2L42.9 18.5H3Z" fill="currentColor" />
      </svg>
    </Link>
  );
}
