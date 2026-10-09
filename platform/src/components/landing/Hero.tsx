import Link from 'next/link';

import { HeroGraph } from './HeroGraph';
import styles from './Hero.module.css';
import { Start } from './Start';

export function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <div>
        <p className={styles.kicker}>ИТ-подбор с обратной механикой</p>
        <h1 id="hero-title" className={styles.title}>
          Твой код.
          <br />
          Твоя карьера<i>.</i>
        </h1>
        <p className={styles.slogan}>Покажи навыки и достижения - получай предложения от ИТ-компаний с открытой зарплатной вилкой.</p>
        <Start />
        <ul className={styles.note}>
          <li>можно загрузить резюме PDF</li>
          <li>ссылки на GitHub и профили</li>
          <li>категорию даёт только тест</li>
        </ul>
        <Link className={styles.entry} href={signedIn ? '/consultant' : '/auth'}>
          <b>{signedIn ? 'Ваш кабинет →' : 'Уже есть аккаунт? Войти →'}</b>
          <small>{signedIn ? 'Вы уже вошли' : 'Демо-стенд · готовые демо-профили'}</small>
        </Link>
      </div>
      <HeroGraph />
    </section>
  );
}
