import { Background } from './Background';
import { Hero } from './Hero';
import { Start } from './Start';
import { LandingHeader, LandingFooter } from './LandingChrome';
import { LandingDock } from './LandingDock';
import { LandingSections } from './LandingSections';
import { HiringShowcase } from './HiringShowcase';
import styles from './Landing.module.css';
import type { LandingData } from './types';

const RULES = [
  ['Навыки с источниками', 'Видно, какие утверждения основаны на словах, проектах и проверках платформы.', 'link'],
  ['Категория по тесту', 'Предполагаемый грейд выбираешь ты. Подтверждённую категорию определяет тест.', 'test'],
  ['Практика дополняет профиль', 'Созвон, проект и защита показывают, как ты разбираешься в задачах и объясняешь решения.', 'code'],
  ['Зарплатная вилка заранее', 'Приглашение содержит условия и диапазон зарплаты.', 'salary'],
  ['Контакты после принятия', 'Компания получает имя и контакты после того, как ты принимаешь её приглашение.', 'lock'],
] as const;
const ICONS = { link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1', test: 'M4 4h16v16H4z M8 12l3 3 5-6', code: 'M8 6l-5 6 5 6 M16 6l5 6-5 6 M14 4l-4 16', salary: 'M8 20V4h6a4 4 0 0 1 0 8H6 M6 16h8', lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 7.6-1.7' };

/** React port of landing-astra. Showcase figures are fictional; authentication is the existing product flow. */
export function Landing({ signedIn }: { data: LandingData; signedIn: boolean }) {
  return <div className={styles.page} data-landing-astra>
    <Background /><LandingHeader signedIn={signedIn} />
    <main id="main" className={styles.main}>
      <Hero signedIn={signedIn} /><HiringShowcase signedIn={signedIn} /><LandingSections signedIn={signedIn} />
      <section className={styles.section} id="why" aria-labelledby="why-title">
        <h2 id="why-title">Почему это работает<i>.</i></h2>
        <ol className={styles.rules}>{RULES.map(([title, text, icon], index) => <li key={title}>
          <b className={styles.number} aria-hidden="true">{String(index + 1).padStart(2, '0')}</b>
          <span className={styles.ruleIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[icon]} /></svg></span>
          <h3>{title}</h3><p>{text}</p>
        </li>)}</ol>
      </section>
      <section className={styles.final} aria-labelledby="final-title"><div className={styles.finalIn}>
        <div><h2 id="final-title">Покажи, что умеешь<i>.</i></h2><p>Начни с резюме, проекта или разговора с Кирой.</p></div><Start inverted signedIn={signedIn} />
      </div></section>
    </main>
    <LandingDock signedIn={signedIn} /><LandingFooter />
  </div>;
}
