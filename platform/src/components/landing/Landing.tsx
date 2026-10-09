import { Background } from './Background';
import { Companies } from './Companies';
import { COMPANY_FORMS, shortRub, VACANCY_FORMS } from './format';
import { Hero } from './Hero';
import { Start } from './Start';
import { LandingHeader } from './LandingHeader';
import styles from './Landing.module.css';
import type { LandingData } from './types';
import { plural } from '@/lib/plural';

const RULES = [
  { n: '01', title: 'Тест вместо резюме', text: 'Грейд подтверждается задачами, а не словами. Работодатель видит реальный уровень.' },
  { n: '02', title: 'Вилка всегда', text: 'Без зарплатной вилки приглашение не отправить. Никаких «обсудим на интервью».' },
  { n: '03', title: 'Контакты после «да»', text: 'Профиль анонимен, пока вы не примете приглашение. Никакого спама.' },
  { n: '04', title: 'ФСП в зачёт', text: 'Призовые места и рейтинг соревнований поднимают вас в выдаче.' },
];

/** Главная: оригинальный лендинг команды (site/index.html). Все числа — из `data` (БД), без захардкоженных метрик. */
export function Landing({ data, signedIn }: { data: LandingData; signedIn: boolean }) {
  const { stats } = data;
  const tiles = [
    { value: String(stats.companies), label: `${plural(stats.companies, COMPANY_FORMS)} с открытыми вакансиями` },
    { value: String(stats.vacancies), label: `${plural(stats.vacancies, VACANCY_FORMS)}, у каждой указана зарплатная вилка` },
    { value: String(stats.categorized), label: 'кандидатов с категорией, подтверждённой тестом' },
    ...(stats.maxSalary > 0 ? [{ value: `до ${shortRub(stats.maxSalary)}`, label: 'верхняя граница вилки среди вакансий, ₽ в месяц' }] : []),
  ];
  return (
    <div className={styles.page}>
      <Background />
      <LandingHeader signedIn={signedIn} />
      <main id="main" className={styles.main}>
        <Hero companies={data.companies} signedIn={signedIn} />
        <Companies companies={data.companies} />
        <section className={`${styles.section} ${styles.why}`} id="why" aria-labelledby="why-title">
          <div className={styles.sechead}>
            <h2 id="why-title">Почему это работает</h2>
            <span>4 правила платформы</span>
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
          <ul className={styles.stats} aria-label="Платформа в цифрах">
            {tiles.map((t) => (
              <li key={t.label}>
                <b>{t.value}</b>
                <span>{t.label}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className={`${styles.section} ${styles.final}`} aria-labelledby="final-title">
          <div className={styles.finalIn}>
            <h2 id="final-title">Начни с профиля.</h2>
            <Start inverted />
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <span>© Федерация спортивного программирования, 2026</span>
        <span>вилка всегда · контакты после «да» · ФСП в зачёт</span>
      </footer>
    </div>
  );
}
