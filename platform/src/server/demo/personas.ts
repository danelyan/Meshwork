/**
 * Курированный набор демо-персон для окна входа и страницы /demo (решение владельца 11.10:
 * «минимум демо-аккаунтов… с разными положениями и статусами прохождения от пустого до того, как
 * пригласила компания, либо уже принят на работу… наглядно, сразу очевидно»).
 *
 * Единственное место, где перечислены персоны: id аккаунта, этап пути, строка «что увидишь».
 * Данные под каждую персону засеваются в `prisma/seed/demo-personas.ts` (и `demo-hired.ts`) реальными
 * записями: утверждения, категория, попытка теста, созвон с вердиктом, приглашения.
 * Остальные демо-кандидаты (`demo-pool-*`, `demo-ai-*`, `demo-cat-*`) остаются в БД: это база
 * поиска работодателя и валидации ранжирования, в списки входа они не попадают.
 *
 * Модуль без зависимостей от сервера: его читает и клиентский компонент.
 */

export type PersonaKind = 'fresh' | 'candidate' | 'employer';

export interface DemoPersona {
  /** Кандидат: Candidate.id; работодатель: User.id; fresh: 'fresh'. */
  id: string;
  kind: PersonaKind;
  /** Этап пути соискателя 1…8; у компаний null. */
  stage: number | null;
  /** Короткая метка на бейдже. */
  badge: string;
  name: string;
  /** Одна строка «что увидишь». */
  sees: string;
}

export const FRESH_PERSONA: DemoPersona = {
  id: 'fresh', kind: 'fresh', stage: 1, badge: 'Пусто', name: 'Новый пользователь',
  sees: 'Чистый аккаунт: первым вопросом ИИ-помощник спросит, кто ты, и начнёт знакомство.',
};

/** Специалисты по этапам пути (без fresh: он создаётся отдельной кнопкой с согласием). */
export const CANDIDATE_PERSONAS: DemoPersona[] = [
  { id: 'demo-intro', kind: 'candidate', stage: 2, badge: 'Знакомство', name: 'Павел Нестеров',
    sees: 'Знакомство на середине: ответы уже видны в «Что я о тебе знаю», вопросы продолжаются в чате.' },
  { id: 'demo-frontend-mid', kind: 'candidate', stage: 3, badge: 'Профиль из резюме', name: 'Юлия Власова',
    sees: 'Профиль собран из резюме: 5 утверждений с цитатами ждут подтверждения; доступен квалификационный созвон с ИИ.' },
  { id: 'demo-tested', kind: 'candidate', stage: 4, badge: 'Тест пройден', name: 'Ксения Андреева',
    sees: 'Категория Frontend · Junior выдана тестом; открыто ИИнтервью, карточка видна компаниям.' },
  { id: 'demo-strong', kind: 'candidate', stage: 5, badge: 'Сильный, с ФСП', name: 'Леонид Исаев',
    sees: 'Frontend · Middle с достижениями ФСП; созвон с ИИ пройден, утверждения подтверждены платформой.' },
  { id: 'demo-invited', kind: 'candidate', stage: 6, badge: 'Есть приглашение', name: 'Марина Котова',
    sees: 'Компания «Гранит Софт» прислала приглашение: вилка и способ связи видны до ответа.' },
  { id: 'demo-accepted', kind: 'candidate', stage: 7, badge: 'Принял приглашение', name: 'Роман Зайцев',
    sees: 'Приглашение принято: компании открыт твой контакт, тебе — контакт компании и вилка из приглашения.' },
  { id: 'demo-hired', kind: 'candidate', stage: 8, badge: 'Нанят', name: 'Алёна Мироненко',
    sees: 'Работодатель отметил найм через платформу: финал пути соискателя.' },
];

export const EMPLOYER_PERSONAS: DemoPersona[] = [
  { id: 'demo-employer', kind: 'employer', stage: null, badge: 'Поиск', name: 'Анна Кравец · Северный Поток',
    sees: 'Вакансии и подборка кандидатов с обоснованием и вилкой; приглашений ещё нет.' },
  { id: 'demo-employer-granit', kind: 'employer', stage: null, badge: 'Приглашения и найм', name: 'Олег Ермаков · Гранит Софт',
    sees: 'Уже пригласил троих: ждёт ответа, получил контакты и отметил найм.' },
  // Семь компаний из seed/content/companies.ts: кабинет с вакансиями разных направлений и проектным заданием у каждой.
  { id: 'demo-employer-yasen-retail', kind: 'employer', stage: null, badge: 'Ритейл', name: 'Дарья Снегирёва · Ясень Ритейл',
    sees: 'Четыре команды ищут людей в разных направлениях: от бэкенда под распродажи до аналитики продаж.' },
  { id: 'demo-employer-vektor-logistics', kind: 'employer', stage: null, badge: 'Логистика', name: 'Игорь Талызин · Вектор Логистика',
    sees: 'Интеграции с партнёрами, схема данных, SRE и прогноз спроса: вакансии на стыке бэкенда и данных.' },
  { id: 'demo-employer-neyron-lab', kind: 'employer', stage: null, badge: 'ИИ', name: 'Полина Градова · Нейрон Лаб',
    sees: 'Роли вокруг LLM, ML-инженерии и MLOps от junior до senior; у каждой — проектное задание.' },
  { id: 'demo-employer-atlas-cloud', kind: 'employer', stage: null, badge: 'Облако', name: 'Сергей Орлов · Атлас Облако',
    sees: 'Инфраструктурные роли: выкатки, надёжность, высоконагруженный бэкенд панели управления.' },
  { id: 'demo-employer-medline-digital', kind: 'employer', stage: null, badge: 'Медтех', name: 'Анна Лебедева · Медлайн Диджитал',
    sees: 'Доступные интерфейсы, API записи к врачу и автотесты: роли, где цена ошибки высокая.' },
  { id: 'demo-employer-gorodum', kind: 'employer', stage: null, badge: 'Образование', name: 'Марат Юсупов · ГородУм',
    sees: 'Интерфейс ученика, схема данных курсов и аналитика обучения: три команды, три направления.' },
  { id: 'demo-employer-pulse-games', kind: 'employer', stage: null, badge: 'Игры', name: 'Кирилл Жаров · Пульс Геймс',
    sees: 'Реалтайм-клиенты, нагруженные игровые серверы и автотесты: вакансии от junior до senior.' },
];

/** Доп. сценарий для /demo: проверка защиты разбора резюме от скрытых инструкций (не этап пути). */
export const INJECTION_PERSONA: DemoPersona = {
  id: 'demo-injection', kind: 'candidate', stage: null, badge: 'Проверка защиты', name: 'Матвей Лисицын',
  sees: 'Резюме со скрытым текстом-инструкцией: разбор его игнорирует, в профиль попадает только видимое.',
};

export const ALL_PERSONAS: DemoPersona[] = [FRESH_PERSONA, ...CANDIDATE_PERSONAS, ...EMPLOYER_PERSONAS, INJECTION_PERSONA];

export function personaById(id: string): DemoPersona | undefined {
  return ALL_PERSONAS.find((p) => p.id === id);
}
