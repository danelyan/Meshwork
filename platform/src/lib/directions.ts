// Справочник направлений и подкатегорий (ADR 0003, дополнение 10.10; R-T-05). Один источник для кода,
// UI и сида таблицы Subcategory (prisma/seed/directions.ts). Чистый модуль без серверных импортов —
// его читают и клиентские компоненты. Карта — ресёрч владельца research/25 (§ 3 — описания, § 4 — что к сдаче).

/** Порядок направлений в UI и сводках. Совпадает с enum Specialization (prisma/schema.prisma). */
export const SPECIALIZATIONS = ['backend', 'frontend', 'ai', 'engineering'] as const;
export type Specialization = (typeof SPECIALIZATIONS)[number];

export const SPEC_LABEL: Record<Specialization, string> = {
  backend: 'Backend',
  frontend: 'Frontend',
  ai: 'AI / ML',
  engineering: 'Engineering',
};

/** Короткое пояснение направления (онбординг, фильтры). */
export const SPEC_NOTE: Record<Specialization, string> = {
  backend: 'серверная разработка',
  frontend: 'интерфейсы и веб',
  ai: 'LLM-приложения, ML, MLOps, анализ данных',
  engineering: 'данные, DevOps, автотесты, SRE',
};

/** Название роли в заголовке потребности: «Backend-разработчик», «AI / ML-инженер». */
export const SPEC_ROLE: Record<Specialization, string> = {
  backend: 'Backend-разработчик',
  frontend: 'Frontend-разработчик',
  ai: 'AI / ML-инженер',
  engineering: 'Инженер платформы и данных',
};

export function isSpecialization(v: unknown): v is Specialization {
  return typeof v === 'string' && (SPECIALIZATIONS as readonly string[]).includes(v);
}

/** Подпись направления; неизвестное значение показывается как есть. */
export function specLabel(v: string | null | undefined): string {
  return isSpecialization(v) ? SPEC_LABEL[v] : (v ?? '');
}

export type SubcategoryStatus = 'active' | 'planned';

export interface SubcategoryDef {
  /** "backend.web-api" — направление.подкатегория. */
  id: string;
  specialization: Specialization;
  title: string;
  description: string;
  /** active — к сдаче (ADR 0003: есть шаблон проекта); planned — запись справочника. */
  status: SubcategoryStatus;
  order: number;
}

/**
 * 17 подкатегорий карты. Статус active — те, у которых к сдаче есть шаблон проекта по ADR 0003
 * («Контракт: лента заданий»): backend.web-api, backend.integrations, frontend.ui-app, ai.llm-apps,
 * engineering.data-eng. Остальные — planned.
 */
export const SUBCATEGORIES: readonly SubcategoryDef[] = [
  { id: 'backend.web-api', specialization: 'backend', title: 'Web API', description: 'CRUD, валидация, ошибки, SQL-схема и тесты', status: 'active', order: 1 },
  { id: 'backend.integrations', specialization: 'backend', title: 'Интеграции', description: 'Внешние API и очереди: ретраи, таймауты, идемпотентность, маппинг форматов', status: 'active', order: 2 },
  { id: 'backend.highload', specialization: 'backend', title: 'Highload', description: 'Профилирование и ускорение: кэш, N+1, фоновые задачи', status: 'planned', order: 3 },
  { id: 'backend.data-model', specialization: 'backend', title: 'Модель данных', description: 'Миграции, транзакции, конкурентные обновления', status: 'planned', order: 4 },

  { id: 'frontend.ui-app', specialization: 'frontend', title: 'UI-приложение', description: 'SPA из макета: компоненты, формы, состояние, роутинг', status: 'active', order: 1 },
  { id: 'frontend.design-system', specialization: 'frontend', title: 'Дизайн-система', description: 'Библиотека компонентов, доступность, темизация', status: 'planned', order: 2 },
  { id: 'frontend.web-perf', specialization: 'frontend', title: 'Производительность', description: 'Профилирование страницы, бандл, SSR и метрики', status: 'planned', order: 3 },
  { id: 'frontend.realtime', specialization: 'frontend', title: 'Realtime', description: 'WebSocket/SSE, оптимистичные обновления, восстановление соединения', status: 'planned', order: 4 },

  { id: 'ai.llm-apps', specialization: 'ai', title: 'LLM-приложения', description: 'Промпты, структурированный вывод, RAG, tool-use, оценка качества', status: 'active', order: 1 },
  { id: 'ai.ai-integration', specialization: 'ai', title: 'AI-интеграция', description: 'LLM/ML-сервис в существующей системе: отказы, наблюдаемость, ПДн, fallback', status: 'planned', order: 2 },
  { id: 'ai.ml-engineering', specialization: 'ai', title: 'ML-инженерия', description: 'Обучение и оценка модели, валидация без утечек, воспроизводимый пайплайн', status: 'planned', order: 3 },
  { id: 'ai.mlops', specialization: 'ai', title: 'MLOps', description: 'Модель в сервисе: версии, мониторинг дрейфа, переобучение, откат', status: 'planned', order: 4 },
  { id: 'ai.data-science', specialization: 'ai', title: 'Data Science', description: 'Аналитика и статистика: A/B, прогноз, интерпретация', status: 'planned', order: 5 },

  { id: 'engineering.data-eng', specialization: 'engineering', title: 'Data Engineering', description: 'ETL/ELT, качество данных, витрины, оркестрация', status: 'active', order: 1 },
  { id: 'engineering.devops', specialization: 'engineering', title: 'DevOps', description: 'CI/CD, Docker/K8s, IaC, наблюдаемость', status: 'planned', order: 2 },
  { id: 'engineering.qa-automation', specialization: 'engineering', title: 'QA-автоматизация', description: 'Автотесты API/UI, тест-дизайн, стабильность', status: 'planned', order: 3 },
  { id: 'engineering.sre', specialization: 'engineering', title: 'SRE', description: 'Инциденты, разбор, ёмкость', status: 'planned', order: 4 },
];

const BY_ID = new Map(SUBCATEGORIES.map((s) => [s.id, s]));

export function getSubcategory(id: string | null | undefined): SubcategoryDef | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function subcategoriesFor(spec: Specialization | null | undefined): SubcategoryDef[] {
  return SUBCATEGORIES.filter((s) => s.specialization === spec);
}

/** Подкатегория принадлежит направлению (null/undefined — подкатегория не выбрана, это допустимо). */
export function subcategoryMatches(spec: Specialization, id: string | null | undefined): boolean {
  if (!id) return true;
  return getSubcategory(id)?.specialization === spec;
}

export function subcategoryLabel(id: string | null | undefined): string {
  const s = getSubcategory(id);
  return s ? s.title : (id ?? '');
}
