'use client';

import Link from 'next/link';

import { type DemoPersona } from '@/lib/api';

import { Panel } from '../ui';

import { JURY_PAGES } from './jury';
import { PersonaChip, type PersonasState } from './DemoPersonas';
import styles from './JuryRoute.module.css';

interface RouteStep {
  id: string;
  /** Кем войти и куда попадёшь. */
  persona?: { id: string; to: string };
  /** Или просто куда перейти. */
  link?: { href: string; label: string };
  see: string;
  criterion: string;
}

/** Маршрут на 5 минут: порядок рассчитан на критерии оценки (подбор 35 %, тест и валидация 25 %). */
export const JURY_ROUTE: RouteStep[] = [
  { id: 'search', persona: { id: 'demo-employer', to: '/employer/search' }, see: 'Подборка кандидатов с обоснованием по каждому и вилкой зарплаты; компания ищет сама.', criterion: 'Подбор · 35 %' },
  { id: 'invite', persona: { id: 'demo-employer-granit', to: '/employer/invitations' }, see: 'Приглашения с вилкой, контакты после согласия кандидата, отметка о найме.', criterion: 'Подбор · 35 %' },
  { id: 'evaluate', link: { href: '/evaluate', label: 'Проверить подбор' }, see: 'Прогон нашего ранжирования на наборе жюри: метрики рядом с базовой линией.', criterion: 'Подбор · 35 %' },
  { id: 'test', persona: { id: 'demo-tested', to: '/test' }, see: 'Адаптивный тест кандидата и выданная им категория: специализация и грейд.', criterion: 'Тест · 25 %' },
  { id: 'expert', link: { href: '/expert', label: 'Пройти тест самому' }, see: 'Настоящий тест без регистрации, чтобы оценить задания и грейд на себе.', criterion: 'Тест · 25 %' },
  { id: 'validation', link: { href: '/validation', label: 'Валидация' }, see: 'Цифры, оговорки и команды повтора: что измерено, а что синтетика.', criterion: 'Валидация · 25 %' },
];

/** Блок «Маршрут жюри на 5 минут» на /demo: шаги входят персоной в нужный раздел или ведут на страницу. */
export function JuryRoute({ state, agreed }: { state: PersonasState; agreed: boolean }) {
  const byId = new Map<string, DemoPersona>((state.personas ?? []).map((p) => [p.id, p]));
  return (
    <section className={styles.block} aria-labelledby="jury-route-title">
      <h2 id="jury-route-title" className={styles.heading}>Маршрут жюри на 5 минут</h2>
      <ol className={styles.steps}>
        {JURY_ROUTE.map((s, i) => {
          const persona = s.persona ? byId.get(s.persona.id) : undefined;
          return (
            <li key={s.id} className={styles.step}>
              <span className={styles.num} aria-hidden="true">{i + 1}</span>
              <div className={styles.body}>
                <p className={styles.see}>{s.see}</p>
                <div className={styles.row}>
                  {s.link && <Link className={styles.link} href={s.link.href}>{s.link.label} →</Link>}
                  {s.persona && (persona
                    ? <PersonaChip persona={persona} state={state} agreed={agreed} to={s.persona.to} />
                    : <span className={styles.loading}>{state.personas === null && !state.error ? 'Загружаю профили…' : 'Профиль недоступен'}</span>)}
                  <span className={styles.criterion}>{s.criterion}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Блок «Проверить наши цифры и механику»: карточки-ссылки на страницы жюри. */
export function JuryPages() {
  return (
    <section className={styles.block} aria-labelledby="jury-pages-title">
      <h2 id="jury-pages-title" className={styles.heading}>Проверить наши цифры и механику</h2>
      <ul className={styles.pages}>
        {JURY_PAGES.map((p) => (
          <li key={p.href}>
            <Panel as="div" className={styles.card}>
              <Link className={styles.cardLink} href={p.href}>{p.title} →</Link>
              <p className={styles.cardText}>{p.text}</p>
              <span className={styles.criterion}>{p.criterion}</span>
            </Panel>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Обратная ссылка со страниц жюри на /demo. Рисуют только при DEMO_LOGIN (иначе /demo отдаёт 404). */
export function JuryBackLink() {
  return <Link className={styles.back} href="/demo">← Все страницы для жюри</Link>;
}
