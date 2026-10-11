// Модель компетенций ИИнтервью (docs/competency-model.md). Чистый модуль без серверных импортов — его читают
// клиентские компоненты (этапы и критерии на экране). Юнит-тест tests/unit/interview/model.test.ts сверяет
// привязку к каталогу утверждений и к подкатегориям справочника.
import type { Specialization } from '../../lib/directions';
import type { Grade } from '../../lib/grades';
import type { QuestionLevel } from '../call/types';

/** Оси результата — четыре критерия мокапа (design-spec § 11). grade_fit не спрашивается, считается кодом. */
export const AXES = ['technical', 'systems', 'communication', 'grade_fit'] as const;
export type Axis = (typeof AXES)[number];
/** Оси, по которым задаются вопросы (компетенция принадлежит одной из них). */
export type QuestionAxis = Exclude<Axis, 'grade_fit'>;

export const AXIS_LABEL: Record<Axis, string> = {
  technical: 'Технический уровень',
  systems: 'Системное мышление',
  communication: 'Коммуникация',
  grade_fit: 'Соответствие грейду',
};

/** ПРЕДЛОЖЕНИЕ: веса осей в итоге 0–100; экспертные, на людях не калиброваны. */
export const AXIS_WEIGHTS: Record<Axis, number> = { technical: 0.4, systems: 0.25, communication: 0.15, grade_fit: 0.2 };

/** Блоки интервью по порядку (мокап: Знакомство, Разбор теста, Системный дизайн, Работа в команде, Итоги). */
export const BLOCKS = ['intro', 'test', 'systems', 'team', 'summary'] as const;
export type BlockId = (typeof BLOCKS)[number];

export interface BlockDef {
  id: BlockId;
  title: string;
  /** Вопросов в блоке: минимум и максимум (summary — 0: закрывающая реплика). */
  questions: { min: number; max: number };
  /** Ось компетенций блока; summary — null. */
  axis: QuestionAxis | null;
}

export const BLOCK_DEFS: readonly BlockDef[] = [
  { id: 'intro', title: 'Знакомство', questions: { min: 1, max: 1 }, axis: 'communication' },
  { id: 'test', title: 'Разбор теста', questions: { min: 2, max: 3 }, axis: 'technical' },
  { id: 'systems', title: 'Системный дизайн', questions: { min: 1, max: 2 }, axis: 'systems' },
  { id: 'team', title: 'Работа в команде', questions: { min: 1, max: 1 }, axis: 'communication' },
  { id: 'summary', title: 'Итоги', questions: { min: 0, max: 0 }, axis: null },
];

export function blockDef(id: BlockId): BlockDef {
  return BLOCK_DEFS.find((b) => b.id === id)!;
}

export function levelForGrade(grade: Grade | null | undefined): QuestionLevel {
  return grade === 'senior' ? 3 : grade === 'middle' ? 2 : 1;
}

export function gradeForLevel(level: QuestionLevel): Grade {
  return level === 3 ? 'senior' : level === 2 ? 'middle' : 'junior';
}

export interface CompetencyDef {
  /** "<направление>.<имя>" или "common.<имя>". */
  id: string;
  title: string;
  specialization: Specialization | 'common';
  axis: QuestionAxis;
  /** Утверждения каталога, которые подтверждает компетенция (поднимаются до platform). */
  catalogIds: readonly string[];
  /** Подкатегории, где компетенция — ядро (приоритет в блоке «Разбор теста»). */
  core: readonly string[];
  /** О чём спросить на уровне грейда. Оценщику не передаётся. */
  focus: Record<Grade, string>;
}

const common: readonly CompetencyDef[] = [
  {
    id: 'common.context',
    title: 'Контекст и роль',
    specialization: 'common',
    axis: 'communication',
    catalogIds: [],
    core: [],
    focus: {
      junior: 'Последний проект: что делал сам, какая задача была твоей, чем закончилось',
      middle: 'Последний проект: твоя зона ответственности, одно решение, которое принимал ты, и его результат',
      senior: 'Последний проект: за что отвечал, какие ограничения задавали рамки, что бы сделал иначе',
    },
  },
  {
    id: 'common.teamwork',
    title: 'Работа в команде',
    specialization: 'common',
    axis: 'communication',
    catalogIds: ['common.code-review', 'common.git'],
    core: [],
    focus: {
      junior: 'Как получал замечания в ревью и что с ними делал; как договаривался о задаче, когда что-то было непонятно',
      middle: 'Случай несогласия с решением коллеги или лида: что сделал, как договорились, чем закончилось',
      senior: 'Как вёл ревью и передавал контекст команде; конфликт приоритетов между командами и как его разрешал',
    },
  },
];

const backend: readonly CompetencyDef[] = [
  {
    id: 'backend.code',
    title: 'Код и язык',
    specialization: 'backend',
    axis: 'technical',
    catalogIds: ['be.lang-core', 'be.framework', 'be.layering', 'be.error-handling'],
    core: ['backend.web-api'],
    focus: {
      junior: 'Как устроен обработчик запроса в твоём фреймворке и где живёт бизнес-логика; как обрабатываешь ошибки',
      middle: 'Почему разделил сервис на слои именно так; как не «проглотить» ошибку и что вернуть клиенту',
      senior: 'Где границы слоёв перестают помогать; как язык и фреймворк ограничивают архитектуру и чем платишь',
    },
  },
  {
    id: 'backend.api',
    title: 'API и контракты',
    specialization: 'backend',
    axis: 'technical',
    catalogIds: ['be.rest-design', 'be.api-validation', 'be.api-contract', 'be.grpc', 'common.http'],
    core: ['backend.web-api', 'backend.integrations'],
    focus: {
      junior: 'Как спроектировал ресурсы и коды ответа; как валидируешь вход и что отдаёшь при ошибке',
      middle: 'Пагинация, версионирование, обратная совместимость контракта: как менял API, не ломая клиентов',
      senior: 'REST против gRPC или событий для конкретной интеграции; как эволюционировать контракт на годы',
    },
  },
  {
    id: 'backend.data',
    title: 'Данные и хранение',
    specialization: 'backend',
    axis: 'technical',
    catalogIds: ['be.sql-schema', 'be.sql-indexes', 'be.transactions', 'be.migrations', 'be.orm', 'be.nosql', 'common.sql-queries'],
    core: ['backend.data-model', 'backend.web-api'],
    focus: {
      junior: 'Схема и ключи для простой предметной области; что такое N+1 и как заметил',
      middle: 'Индекс под конкретный запрос и план; уровень изоляции транзакции и его аномалии; миграция без простоя',
      senior: 'Выбор хранилища под модель доступа; согласованность при шардировании; цена ошибки в схеме через год',
    },
  },
  {
    id: 'backend.integrations',
    title: 'Интеграции и асинхронность',
    specialization: 'backend',
    axis: 'technical',
    catalogIds: ['be.external-integration', 'be.retries-timeouts', 'be.message-queue', 'be.idempotency', 'be.background-jobs'],
    core: ['backend.integrations'],
    focus: {
      junior: 'Как вызывал внешний API и что делал при ошибке; зачем выносить долгую операцию в фон',
      middle: 'Ретраи с backoff и таймауты; идемпотентность повторного запроса; повторная доставка и DLQ',
      senior: 'Гарантии доставки и порядок; что происходит при частичном отказе брокера; бюджет ретраев в цепочке',
    },
  },
  {
    id: 'backend.performance',
    title: 'Производительность и надёжность',
    specialization: 'backend',
    axis: 'technical',
    catalogIds: ['be.cache', 'be.concurrency', 'be.performance', 'be.observability', 'be.rate-limit'],
    core: ['backend.highload'],
    focus: {
      junior: 'Что кэшировал и как инвалидировал; как по логам нашёл проблему',
      middle: 'Как нашёл узкое место профилировщиком или нагрузочным тестом и чем подтвердил улучшение; гонки и блокировки',
      senior: 'Лавина промахов кэша, рост нагрузки ×10, деградация под отказом зависимости — что проектировал заранее',
    },
  },
  {
    id: 'backend.security',
    title: 'Безопасность',
    specialization: 'backend',
    axis: 'technical',
    catalogIds: ['be.authn-impl', 'be.authz', 'be.config-secrets', 'common.security-basics', 'common.auth-flow'],
    core: ['backend.web-api'],
    focus: {
      junior: 'Где хранишь пароли и секреты; как проверяешь, что пользователь видит только своё',
      middle: 'Сессии против JWT, обновление токена, IDOR и как его искал; типовые уязвимости в своём коде',
      senior: 'Модель угроз сервиса; компромисс между удобством и безопасностью; как ограничить ущерб при утечке',
    },
  },
  {
    id: 'backend.quality',
    title: 'Инженерная практика',
    specialization: 'backend',
    axis: 'technical',
    catalogIds: ['be.integration-tests', 'common.unit-tests', 'common.debugging', 'common.docker-local', 'common.ci-basics'],
    core: [],
    focus: {
      junior: 'Какие тесты писал и что они ловили; как воспроизводил ошибку по стектрейсу',
      middle: 'Интеграционные тесты с реальной БД в контейнере; что гоняется в CI и почему; нестабильные тесты',
      senior: 'Стратегия тестирования сервиса и её цена; когда тесты мешают; как держать CI быстрым',
    },
  },
  {
    id: 'backend.design',
    title: 'Проектирование сервисов',
    specialization: 'backend',
    axis: 'systems',
    catalogIds: ['be.service-boundaries', 'be.distributed-consistency', 'common.algo-complexity'],
    core: ['backend.highload', 'backend.integrations'],
    focus: {
      junior: 'Разбить задачу на модули и объяснить границы; оценить сложность и выбрать структуру данных',
      middle: 'Сервис под заданную нагрузку: API, хранение, кэш, где узкое место и как его измерить',
      senior: 'Отказ компонента, рост ×10, согласованность между сервисами: что менять первым и чем платить',
    },
  },
];

const frontend: readonly CompetencyDef[] = [
  {
    id: 'frontend.markup',
    title: 'Вёрстка и стили',
    specialization: 'frontend',
    axis: 'technical',
    catalogIds: ['fe.html-semantic', 'fe.css-layout', 'fe.css-cascade', 'fe.responsive', 'fe.css-architecture', 'fe.design-handoff', 'fe.cross-browser'],
    core: ['frontend.ui-app', 'frontend.design-system'],
    focus: {
      junior: 'Flexbox против Grid для конкретной раскладки; семантические теги для формы или статьи',
      middle: 'Специфичность и контекст наложения в реальном баге; организация стилей в большом проекте и почему так',
      senior: 'Дизайн-токены и темизация на несколько продуктов; цена миграции подхода к стилям',
    },
  },
  {
    id: 'frontend.language',
    title: 'JavaScript и TypeScript',
    specialization: 'frontend',
    axis: 'technical',
    catalogIds: ['fe.js-core', 'fe.event-loop', 'fe.dom-events', 'fe.ts-typing'],
    core: ['frontend.ui-app'],
    focus: {
      junior: 'Замыкания и this на примере из кода; всплытие и делегирование событий',
      middle: 'Порядок микро- и макрозадач в конкретном сценарии; сужение типов и дженерики, где они реально помогли',
      senior: 'Границы типизации: где any оправдан; как типы задают архитектуру API компонента',
    },
  },
  {
    id: 'frontend.components',
    title: 'Компоненты и состояние',
    specialization: 'frontend',
    axis: 'technical',
    catalogIds: ['fe.components', 'fe.render-lifecycle', 'fe.state-mgmt', 'fe.forms', 'fe.routing'],
    core: ['frontend.ui-app', 'frontend.design-system'],
    focus: {
      junior: 'Контролируемая форма с валидацией; как делил экран на компоненты',
      middle: 'Где хранить состояние и почему; лишние перерисовки, ключи списков, мемоизация по делу',
      senior: 'Границы модулей и общий UI-kit; как состояние сервера и клиента не дублируется в большом приложении',
    },
  },
  {
    id: 'frontend.data',
    title: 'Данные и сеть',
    specialization: 'frontend',
    axis: 'technical',
    catalogIds: ['fe.api-client', 'fe.server-state', 'fe.realtime-client', 'fe.browser-storage', 'common.http'],
    core: ['frontend.realtime'],
    focus: {
      junior: 'Состояния загрузки и ошибки; что такое CORS и как столкнулся',
      middle: 'Гонки ответов и отмена запросов; инвалидация кэша и оптимистичные обновления; переподключение WebSocket',
      senior: 'Консистентность данных при realtime и офлайне; что хранить в браузере и как это устаревает',
    },
  },
  {
    id: 'frontend.performance',
    title: 'Производительность',
    specialization: 'frontend',
    axis: 'technical',
    catalogIds: ['fe.web-perf', 'fe.render-perf', 'fe.bundler', 'fe.ssr'],
    core: ['frontend.web-perf'],
    focus: {
      junior: 'Что такое ленивая загрузка и где применял; как смотрел размер бандла',
      middle: 'Core Web Vitals конкретной страницы: что мерил, что сделал, чем подтвердил; долгие задачи и виртуализация',
      senior: 'SSR против CSR для продукта, гидратация и её цена; бюджет производительности и как его держать',
    },
  },
  {
    id: 'frontend.quality',
    title: 'Доступность и качество',
    specialization: 'frontend',
    axis: 'technical',
    catalogIds: ['fe.a11y', 'fe.component-tests', 'fe.e2e-tests', 'common.unit-tests', 'common.debugging'],
    core: ['frontend.design-system'],
    focus: {
      junior: 'Клавиатурная навигация и фокус; какие тесты компонентов писал',
      middle: 'ARIA по делу и когда вредит; тесты через поведение пользователя с моками сети; сквозные сценарии',
      senior: 'Доступность как требование дизайн-системы; пирамида тестов фронтенда и её цена',
    },
  },
  {
    id: 'frontend.architecture',
    title: 'Архитектура приложения',
    specialization: 'frontend',
    axis: 'systems',
    catalogIds: ['fe.architecture', 'common.algo-complexity', 'common.security-basics', 'common.auth-flow'],
    core: ['frontend.ui-app', 'frontend.web-perf'],
    focus: {
      junior: 'Структура проекта: где что лежит и почему; как хранил токен входа',
      middle: 'Приложение с ролями и защищёнными маршрутами: слои, границы модулей, где кэш, где состояние',
      senior: 'Рост команды ×3: модули, владение кодом, миграция без остановки разработки; XSS и CSRF в архитектуре',
    },
  },
];

const ai: readonly CompetencyDef[] = [
  {
    id: 'ai.llm',
    title: 'LLM-приложения',
    specialization: 'ai',
    axis: 'technical',
    catalogIds: ['ai.prompting', 'ai.structured-output', 'ai.tool-use', 'ai.llm-api', 'ai.llm-cost'],
    core: ['ai.llm-apps'],
    focus: {
      junior: 'Как строил промпт и проверял результат; как получал структурированный ответ',
      middle: 'Валидация вывода по схеме и что делать при мусоре; агентный цикл с инструментами и ограничение шагов; цена вызовов',
      senior: 'Когда LLM не нужна; бюджет латентности и стоимости на продукт; деградация при недоступности провайдера',
    },
  },
  {
    id: 'ai.retrieval',
    title: 'Поиск и RAG',
    specialization: 'ai',
    axis: 'technical',
    catalogIds: ['ai.rag', 'ai.vector-search', 'ai.llm-eval'],
    core: ['ai.llm-apps'],
    focus: {
      junior: 'Из чего состоит RAG; как разбивал документы на чанки',
      middle: 'Как оценивал качество ретрива и ответов на размеченном наборе; top-k, фильтры, гибридный поиск',
      senior: 'Почему RAG не отвечает: диагностика по метрикам; обновление индекса и консистентность; цена эмбеддингов',
    },
  },
  {
    id: 'ai.safety',
    title: 'Надёжность и безопасность ИИ',
    specialization: 'ai',
    axis: 'technical',
    catalogIds: ['ai.prompt-injection', 'ai.pii-masking', 'ai.llm-fallback'],
    core: ['ai.ai-integration'],
    focus: {
      junior: 'Что такое промпт-инъекция на примере; какие данные нельзя отправлять во внешнюю модель',
      middle: 'Недоверенный текст отдельно от инструкций; маскирование ПДн до вызова; сценарий без LLM при сбое',
      senior: 'Модель угроз LLM-приложения; наблюдаемость и лимиты; как доказать, что фильтр работает',
    },
  },
  {
    id: 'ai.ml',
    title: 'ML-инженерия',
    specialization: 'ai',
    axis: 'technical',
    catalogIds: ['ai.ml-metrics', 'ai.validation', 'ai.data-leakage', 'ai.feature-pipeline', 'ai.ml-baseline'],
    core: ['ai.ml-engineering'],
    focus: {
      junior: 'Какую метрику выбрал и почему; baseline против константного прогноза',
      middle: 'Разбиение по времени или группам; утечка признаков из будущего, которую нашёл; пайплайн признаков без утечки',
      senior: 'Когда метрика врёт бизнесу; воспроизводимость обучения; цена усложнения модели',
    },
  },
  {
    id: 'ai.ops',
    title: 'MLOps',
    specialization: 'ai',
    axis: 'technical',
    catalogIds: ['ai.model-serving', 'ai.model-versioning', 'ai.monitoring-drift'],
    core: ['ai.mlops'],
    focus: {
      junior: 'Как модель попадает в сервис: онлайн или батч; что такое версия модели',
      middle: 'Реестр моделей и продвижение в production; дрейф данных: что мерил, когда алерт, как откатывал',
      senior: 'Пропускная способность инференса и его стоимость; переобучение по расписанию против по дрейфу',
    },
  },
  {
    id: 'ai.analytics',
    title: 'Анализ данных',
    specialization: 'ai',
    axis: 'technical',
    catalogIds: ['ai.pandas-sql', 'ai.ab-testing', 'common.sql-queries'],
    core: ['ai.data-science'],
    focus: {
      junior: 'Группировки и объединения в pandas или SQL; как обрабатывал пропуски',
      middle: 'A/B-тест: метрика, размер выборки, значимость; типовые ошибки чтения результата',
      senior: 'Когда A/B невозможен и что вместо него; как интерпретация попадает в решение бизнеса',
    },
  },
  {
    id: 'ai.bi',
    title: 'BI-аналитика',
    specialization: 'ai',
    axis: 'technical',
    catalogIds: ['ai.bi-sql-analytics', 'ai.bi-metrics-design', 'ai.bi-dashboards', 'ai.bi-data-modeling', 'ai.bi-experiment-reporting', 'ai.bi-data-quality', 'ai.bi-metric-governance'],
    core: ['ai.bi-analytics'],
    focus: {
      junior: 'Группировка и соединение для отчёта; как определил метрику и проверил знаменатель',
      middle: 'Гранулярность витрины, оконные функции и качество данных; как интерпретировал результат A/B-теста',
      senior: 'Согласованные определения метрик; причинность и ограничения аналитического вывода; цена ошибки для бизнеса',
    },
  },
  {
    id: 'ai.engineering',
    title: 'Инженерная практика',
    specialization: 'ai',
    axis: 'technical',
    catalogIds: ['common.unit-tests', 'common.debugging', 'common.docker-local', 'common.ci-basics'],
    core: [],
    focus: {
      junior: 'Как упаковывал пайплайн в Docker; какие тесты писал',
      middle: 'Что гоняется в CI для ML-кода; как отлаживал нестабильное обучение',
      senior: 'Тестирование недетерминированных систем; стоимость CI с моделями',
    },
  },
  {
    id: 'ai.design',
    title: 'Проектирование ИИ-систем',
    specialization: 'ai',
    axis: 'systems',
    catalogIds: ['common.algo-complexity', 'common.security-basics'],
    core: ['ai.ai-integration', 'ai.mlops'],
    focus: {
      junior: 'Где в существующем продукте уместна модель и где нет; из каких частей состоит фича с LLM',
      middle: 'LLM-фича в продакшене: очереди, таймауты, лимиты, наблюдаемость, ПДн; где узкое место',
      senior: 'Рост ×10 по запросам и данным; отказ провайдера; как измерять пользу фичи, а не только качество модели',
    },
  },
];

const engineering: readonly CompetencyDef[] = [
  {
    id: 'engineering.pipelines',
    title: 'Пайплайны данных',
    specialization: 'engineering',
    axis: 'technical',
    catalogIds: ['eng.etl-pipeline', 'eng.data-types', 'eng.data-quality', 'eng.idempotent-load', 'eng.incremental-load', 'eng.orchestration'],
    core: ['engineering.data-eng'],
    focus: {
      junior: 'Из чего состоит пайплайн; что делал со строками, не прошедшими схему; как проверял дубли',
      middle: 'Идемпотентная загрузка после сбоя; инкремент по водяному знаку и опоздавшие записи; повторы в оркестраторе',
      senior: 'CDC против батча; гарантии при частичном отказе; стоимость переобработки истории',
    },
  },
  {
    id: 'engineering.warehouse',
    title: 'Хранилища данных',
    specialization: 'engineering',
    axis: 'technical',
    catalogIds: ['eng.partitioning', 'eng.dwh-modeling', 'common.sql-queries'],
    core: ['engineering.data-eng'],
    focus: {
      junior: 'Факты и измерения на примере; JOIN и GROUP BY с учётом NULL',
      middle: 'Секционирование и проверка, что запрос читает только нужные секции; SCD2 и его цена',
      senior: 'Модель хранилища под меняющиеся вопросы бизнеса; миграция витрин без остановки отчётов',
    },
  },
  {
    id: 'engineering.delivery',
    title: 'Сборка и поставка',
    specialization: 'engineering',
    axis: 'technical',
    catalogIds: ['eng.dockerfile', 'eng.ci-cd', 'eng.secrets', 'eng.deploy-rollback', 'eng.iac'],
    core: ['engineering.devops'],
    focus: {
      junior: 'Dockerfile и кэш слоёв; что происходит в CI по коммиту; где лежат секреты',
      middle: 'Rolling update и откат на версию; секреты в CI и при сборке; инфраструктура кодом и её дрейф',
      senior: 'Стратегия выкладки под риск; откат с миграцией БД; стоимость и надёжность конвейера',
    },
  },
  {
    id: 'engineering.kubernetes',
    title: 'Эксплуатация в Kubernetes',
    specialization: 'engineering',
    axis: 'technical',
    catalogIds: ['eng.k8s-probes', 'eng.k8s-resources'],
    core: ['engineering.devops', 'engineering.sre'],
    focus: {
      junior: 'Чем liveness отличается от readiness; что такое requests и limits',
      middle: 'Неправильная проба, которая уронила сервис; сколько подов поместится на узел и как это считал',
      senior: 'Планирование ёмкости кластера; шумные соседи; отказ узла и что произойдёт с нагрузкой',
    },
  },
  {
    id: 'engineering.testing',
    title: 'Автотесты',
    specialization: 'engineering',
    axis: 'technical',
    catalogIds: ['eng.test-strategy', 'eng.test-design', 'eng.test-isolation', 'eng.flaky-tests', 'eng.contract-tests', 'eng.ui-autotests'],
    core: ['engineering.qa-automation'],
    focus: {
      junior: 'Граничные значения и классы эквивалентности на примере; как изолировал тесты',
      middle: 'Пирамида тестов и её нарушение; нестабильный тест, который чинил: причина и что сделал; контрактные тесты',
      senior: 'Стратегия автотестов продукта и её цена; какие тесты удалить; тесты как инструмент релизов',
    },
  },
  {
    id: 'engineering.reliability',
    title: 'Надёжность',
    specialization: 'engineering',
    axis: 'technical',
    catalogIds: ['eng.slo', 'eng.alerting', 'eng.incident-postmortem', 'eng.retries-resilience', 'eng.observability'],
    core: ['engineering.sre'],
    focus: {
      junior: 'Что такое SLO и бюджет ошибок; какие метрики, логи и трейсы подключал',
      middle: 'Алерты по симптомам пользователя; разбор инцидента: таймлайн и постмортем; ретраи в цепочке и шторм',
      senior: 'SLO на систему из многих сервисов; как бюджет ошибок управляет релизами; цена наблюдаемости',
    },
  },
  {
    id: 'engineering.design',
    title: 'Проектирование и ёмкость',
    specialization: 'engineering',
    axis: 'systems',
    catalogIds: ['eng.capacity-planning', 'common.algo-complexity'],
    core: ['engineering.sre', 'engineering.data-eng'],
    focus: {
      junior: 'Из каких частей состоит платформа под сервис; как оценить, сколько ресурсов нужно',
      middle: 'Сколько обработчиков под поток и как растёт очередь; где узкое место пайплайна и как измерить',
      senior: 'Рост ×10 по данным и трафику; отказ зоны; что менять первым и чем платить',
    },
  },
];

export const COMPETENCIES: readonly CompetencyDef[] = [...common, ...backend, ...frontend, ...ai, ...engineering];

const BY_ID = new Map(COMPETENCIES.map((c) => [c.id, c]));

export function competencyById(id: string): CompetencyDef | null {
  return BY_ID.get(id) ?? null;
}

/** Компетенции направления в порядке модели (без общих). */
export function competenciesFor(specialization: Specialization): CompetencyDef[] {
  return COMPETENCIES.filter((c) => c.specialization === specialization);
}

/** Компетенция блока по порядку: intro/team — общие, systems — ось systems направления. */
export function blockCompetencies(block: BlockId, specialization: Specialization): CompetencyDef[] {
  if (block === 'intro') return [BY_ID.get('common.context')!];
  if (block === 'team') return [BY_ID.get('common.teamwork')!];
  if (block === 'systems') return competenciesFor(specialization).filter((c) => c.axis === 'systems');
  if (block === 'test') return competenciesFor(specialization).filter((c) => c.axis === 'technical');
  return [];
}

/** Технические компетенции направления: ядро подкатегории — первыми, остальные — по порядку модели. */
export function orderTechnical(specialization: Specialization, subcategoryId: string | null): CompetencyDef[] {
  const tech = competenciesFor(specialization).filter((c) => c.axis === 'technical');
  if (!subcategoryId) return tech;
  const isCore = (c: CompetencyDef) => c.core.includes(subcategoryId);
  return [...tech.filter(isCore), ...tech.filter((c) => !isCore(c))];
}
