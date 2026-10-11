'use client';

import { useState } from 'react';

import { type DemoPersona } from '@/lib/api';

import { ConsentCheck } from './auth/ConsentCheck';
import { PersonaChip, PersonaGroups, type PersonasState, useDemoPersonas } from './demo/DemoPersonas';
import { Container } from './shell/Container';
import { PageTitle } from './shell/PageTitle';
import { Notice } from './ui';
import styles from './DemoScreen.module.css';

/** Возможности платформы для жюри: коротко, и под каждой - кем войти, чтобы увидеть её сразу. */
export const DEMO_FEATURES: { id: string; title: string; text: string; personas: string[] }[] = [
  {
    id: 'reverse', title: 'Обратная механика подбора',
    text: 'Специалист проходит опрос и тест и получает категорию. Компания сама ищет в базе по категориям и пишет первой - с вилкой зарплаты и контактом.',
    personas: ['demo-employer', 'demo-invited'],
  },
  {
    id: 'test', title: 'Тест на грейд и его калибровка',
    text: 'Адаптивный тест выдаёт направление и грейд, а резюме и ответы в чате категорию не меняют. Пороги проверены на персонах-тестировщиках, цифры - в документе валидации.',
    personas: ['fresh', 'demo-tested'],
  },
  {
    id: 'calls', title: 'Созвоны с ИИ',
    text: 'Квалификационный созвон по резюме и ИИнтервью: карта глубины по темам, подтверждённые утверждения получают отметку платформы. Разбор резюме устойчив к скрытым инструкциям.',
    personas: ['demo-frontend-mid', 'demo-strong', 'demo-injection'],
  },
  {
    id: 'projects', title: 'Проекты и защита',
    text: 'Работодатель задаёт проектное задание под вакансию, код проверяют автотесты, затем защита проекта в комнате вместе с ИИ и работодателем.',
    personas: ['demo-employer', 'demo-employer-granit'],
  },
  {
    id: 'fsp', title: 'Достижения ФСП',
    text: 'Спортивное программирование усиливает профиль через ФСП ID. Нет истории ФСП - путь не закрыт: решает тест.',
    personas: ['demo-strong', 'demo-tested'],
  },
  {
    id: 'search', title: 'Поиск работодателя, вилка и найм',
    text: 'Подборка с обоснованием по каждому кандидату, приглашение с вилкой от и до, контакты после согласия кандидата и отметка о найме.',
    personas: ['demo-employer-granit', 'demo-accepted', 'demo-hired'],
  },
];

/**
 * Страница /demo: что умеет платформа и быстрый вход нужной персоной (только при DEMO_LOGIN=true,
 * решает серверная страница). Набор персон - server/demo/personas.ts, тот же компонент, что в окне входа.
 * `next` - уже проверенный safeNext путь, откуда прислал guard.
 */
export function DemoScreen({ next = null }: { next?: string | null } = {}) {
  const [agreed, setAgreed] = useState(false);
  const state = useDemoPersonas({ next, agreed });
  const byId = new Map<string, DemoPersona>((state.personas ?? []).map((p) => [p.id, p]));
  const known = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is DemoPersona => Boolean(p));

  return (
    <Container size="wide" className={styles.wrap}>
      <PageTitle
        kicker="ФСП Карьера · демо для жюри"
        title="Что умеет платформа"
        lead="Вымышленные люди и компании. Выбери возможность и войди тем, у кого она видна сразу, без пароля."
      />

      {state.error && <Notice tone="error">{state.error}</Notice>}

      <ConsentCheck checked={agreed} onChange={setAgreed} />

      <ul className={styles.features}>
        {DEMO_FEATURES.map((f, i) => (
          <li key={f.id} className={styles.feature}>
            <span className={styles.num} aria-hidden="true">{i + 1}</span>
            <div className={styles.body}>
              <h2 className={styles.title}>{f.title}</h2>
              <p className={styles.text}>{f.text}</p>
              <div className={styles.chips} role="group" aria-label={`Войти: ${f.title}`}>
                {state.personas === null && !state.error ? <span className={styles.loading} role="status">Загружаю профили…</span> : known(f.personas).map((p) => <PersonaChip key={p.id} persona={p} state={state} agreed={agreed} />)}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <AllProfiles state={state} agreed={agreed} />
    </Container>
  );
}

function AllProfiles({ state, agreed }: { state: PersonasState; agreed: boolean }) {
  return (
    <details className={styles.all}>
      <summary>Все профили по этапам пути</summary>
      <PersonaGroups state={state} agreed={agreed} columns />
    </details>
  );
}
