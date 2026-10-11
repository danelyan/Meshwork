import { Background } from './Background';
import { Companies } from './Companies';
import { Hero } from './Hero';
import { Start } from './Start';
import styles from './Landing.module.css';
import type { LandingData } from './types';

const RULES = [
  { n: '01', title: 'Тест вместо резюме', text: 'Категорию подтверждает адаптивный тест. Компания видит результат проверки и источники навыков.' },
  { n: '02', title: 'Вилка всегда', text: 'Без зарплатной вилки приглашение не отправить. Никаких «обсудим на интервью».' },
  { n: '03', title: 'Контакты после «да»', text: 'Профиль анонимен, пока вы не примете приглашение. Никакого спама.' },
  { n: '04', title: 'ИИ-помощник рядом', text: 'Кира разберёт резюме, предложит факты для профиля и поможет выбрать цель. Что сохранить, решаешь ты.' },
  { n: '05', title: 'Навыки на практике', text: 'Созвон, проектное задание и защита показывают глубину опыта. Результаты и доказательства остаются в профиле.' },
];

/** Product introduction and public company examples; no third-party vacancy feed. */
export function Landing({ data, signedIn }: { data: LandingData; signedIn: boolean }) {
  return (
    <div className={styles.page}>
      <Background />
      <main id="main" className={styles.main}>
        <Hero signedIn={signedIn} />
        <Companies companies={data.companies} />
        <section className={`${styles.section} ${styles.why}`} id="why" aria-labelledby="why-title">
          <div className={styles.sechead}>
            <h2 id="why-title">Почему это работает</h2>
            <span>{RULES.length} правил платформы</span>
          </div>
          <ol className={styles.wgrid}>
            {RULES.map((r) => (
              <li key={r.n}>
                <b aria-hidden="true">{r.n}</b>
                <h3>{r.title}</h3>
                <p>{r.text}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className={`${styles.section} ${styles.final}`} aria-labelledby="final-title">
          <div className={styles.finalIn}>
            <h2 id="final-title">Начни с профиля.</h2>
            <Start inverted signedIn={signedIn} />
          </div>
        </section>
      </main>
    </div>
  );
}
