import Link from 'next/link';
import { cx } from '../ui/cx';
import styles from './shell.module.css';

/** Product wordmark and independent official federation link. */
export function Brand({ className }: { className?: string }) {
  return <div className={cx(styles.brand, className)}>
    <Link className={styles.wordmark} href="/" aria-label="ФСП Карьера, на главную">MESH<span>WORK</span></Link>
    <a className={styles.federation} href="https://fsp-russia.ru/" target="_blank" rel="noopener noreferrer" aria-label="ФСП, официальный сайт">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/landing/fsp-logo.svg" alt="ФСП" />
    </a>
  </div>;
}
