import Link from 'next/link';

import { JURY_HOME } from '@/components/demo/jury';
import styles from './LandingChrome.module.css';

export function LandingHeader({ signedIn, juryEnabled = false }: { signedIn: boolean; juryEnabled?: boolean }) {
  return <header className={styles.header}>
    <div className={styles.brand}>
      <Link href="/" aria-label="MESHWORK, на главную">MESH<span>WORK</span></Link>
      <i aria-hidden="true" />
      <a href="https://fsp-russia.ru/" target="_blank" rel="noopener noreferrer" aria-label="ФСП, официальный сайт">
        {/* eslint-disable-next-line @next/next/no-img-element -- Local SVG retains the export's intrinsic ratio and monochrome filter. */}
        <img src="/landing/fsp-logo.svg" alt="ФСП" />
      </a>
    </div>
    <nav className={styles.nav} aria-label="Разделы главной"><a href="#companies">Компании</a><a href="#path">Путь</a><a href="#employer">Работодателю</a><a href="#why">Почему это работает</a></nav>
    <div className={styles.actions}>
      {/* «Для жюри» – вход в хаб /demo, как в шапке кабинета (HeaderBar); только при DEMO_LOGIN, иначе /demo отдаёт 404. */}
      {juryEnabled && <Link className={styles.jury} href={JURY_HOME}>Для жюри</Link>}
      <Link className={styles.enter} href={signedIn ? '/consultant' : '/auth'}>{signedIn ? 'В кабинет' : 'Войти'}</Link>
    </div>
  </header>;
}

export function LandingFooter() {
  return <footer className={styles.footer}>
    <span>MESHWORK, 2026</span>
    <nav aria-label="Сведения о платформе"><Link href="/consent">Согласие</Link><Link href="/privacy">Политика данных</Link><Link href="/ai">Как работает ИИ</Link><a href="https://fsp-russia.ru/" target="_blank" rel="noopener noreferrer">ФСП</a></nav>
    <small>Демонстрационный стенд · ФСП ID и реестр достижений: симулятор</small>
  </footer>;
}
