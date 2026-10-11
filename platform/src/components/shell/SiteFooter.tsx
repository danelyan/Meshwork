import Link from 'next/link';

import styles from './shell.module.css';

/** Единый подвал. Ссылка «Демо для жюри» — только при DEMO_LOGIN (флаг приходит из лэйаута). */
export function SiteFooter({ demo = false }: { demo?: boolean }) {
  return (
    <footer className={styles.footer}>
      <span>© Федерация спортивного программирования, 2026</span>
      <span>вилка всегда · контакты после «да» · ФСП в зачёт</span>
      <nav className={styles.footLinks} aria-label="Сведения">
        <Link href="/privacy">Политика данных</Link>
        <Link href="/terms">Соглашение</Link>
        <Link href="/employer-terms">Для работодателя</Link>
        <Link href="/ai">Как работает ИИ</Link>
        <Link href="/consent">Согласие</Link>
        <Link href="/validation">Валидация</Link>
        {demo && <Link href="/demo">Демо для жюри</Link>}
        <a href="https://fsp-russia.ru/" target="_blank" rel="noopener noreferrer">
          ФСП
        </a>
      </nav>
    </footer>
  );
}
