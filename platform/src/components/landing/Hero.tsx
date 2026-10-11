import Link from 'next/link';

import { HeroGraph } from './HeroGraph';
import styles from './Hero.module.css';
import { Start } from './Start';

export function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <div>
        <p className={styles.kicker}>ИТ-карьера через подтверждённые навыки</p>
        <h1 id="hero-title" className={styles.title}>
          Твой код.
          <br />
          Твоя карьера<i>.</i>
        </h1>
        <p className={styles.slogan}>Специалист собирает профиль с доказательствами и получает приглашения с открытой вилкой. Компания видит, чем подтверждены навыки, и пишет первой.</p>
        <Start signedIn={signedIn} cabinet />
        <ul className={styles.note}>
          <li>Резюме и ссылки на проекты</li>
          <li>ИИ-консультант Кира</li>
          <li>Категория по результатам теста</li>
          <li><a href="https://fsp-russia.ru/" target="_blank" rel="noopener noreferrer">ФСП ID и достижения</a></li>
        </ul>
        {!signedIn && <Link className={styles.entry} href="/auth"><b>Уже есть аккаунт? Войти</b></Link>}
      </div>
      <HeroGraph />
    </section>
  );
}
