import { isSpecialization, SPEC_LABEL, SPEC_NOTE, SPECIALIZATIONS, type Specialization, subcategoriesFor } from '@/lib/directions';

import type { RangeSpec, StepContext, StepDef, StepOption } from './types';

/**
 * Декларативные сценарии онбординга (решение владельца 09.10: «проактивный
 * помощник задаёт вопросы по одному, всё можно пропустить или настроить позже»).
 * Порядок массива = порядок вопросов. Поведение — engine.ts, запись в БД — service.ts.
 * Направления — четыре из enum Specialization (ADR 0003, дополнение 10.10: backend, frontend, ai,
 * engineering; справочник src/lib/directions.ts); Mobile, Gamedev, Security показаны как «скоро».
 * Data/ML, DevOps и QA вошли в ai и engineering подкатегориями.
 */

export const DIRECTIONS: StepOption[] = [
  ...SPECIALIZATIONS.map((s) => ({ value: s, label: SPEC_LABEL[s], note: SPEC_NOTE[s] })),
  { value: 'mobile', label: 'Mobile', note: 'iOS / Android · скоро', disabled: true },
  { value: 'gamedev', label: 'Gamedev', note: 'игры и движки · скоро', disabled: true },
  { value: 'security', label: 'Security', note: 'информационная безопасность · скоро', disabled: true },
];

/** Подкатегории выбранного направления (справочник Subcategory). planned — с пометкой, но выбрать можно. */
export function subcategoryOptions(spec: unknown): StepOption[] {
  if (!isSpecialization(spec)) return [];
  return subcategoriesFor(spec).map((s) => ({
    value: s.id,
    label: s.title,
    note: s.status === 'planned' ? `${s.description} · задания в плане` : s.description,
  }));
}

export const GRADES: StepOption[] = [
  { value: 'junior', label: 'Junior', note: 'первые проекты, нужно ревью' },
  { value: 'middle', label: 'Middle', note: 'самостоятельные задачи' },
  { value: 'senior', label: 'Senior', note: 'проектные решения и компромиссы' },
];

/** Чипы стека — имена совпадают с маркерами каталога утверждений (по ним считается потребность). */
export const STACK: Record<Specialization, string[]> = {
  backend: ['Python', 'Java', 'Go', 'Kotlin', 'C#', 'Node.js', 'PHP', 'Spring', 'Django', 'FastAPI', 'NestJS', 'SQL', 'Redis', 'Kafka', 'RabbitMQ', 'Docker', 'gRPC', 'Linux'],
  frontend: ['JavaScript', 'TypeScript', 'React', 'Vue', 'Angular', 'Next.js', 'Redux', 'CSS', 'Tailwind', 'Vite', 'Webpack', 'Jest', 'Playwright', 'Figma'],
  ai: ['Python', 'PyTorch', 'scikit-learn', 'pandas', 'LangChain', 'RAG', 'Qdrant', 'pgvector', 'vLLM', 'GigaChat', 'YandexGPT', 'OpenAI API', 'MLflow', 'Airflow', 'FastAPI', 'Docker', 'SQL'],
  engineering: ['Python', 'SQL', 'Airflow', 'Spark', 'Kafka', 'ClickHouse', 'dbt', 'Docker', 'Kubernetes', 'Terraform', 'Ansible', 'GitLab CI', 'Prometheus', 'Grafana', 'Playwright', 'pytest', 'Linux'],
};

function stackOptions(spec: unknown): StepOption[] {
  const list = isSpecialization(spec) ? STACK[spec] : [...new Set(SPECIALIZATIONS.flatMap((s) => STACK[s]))];
  return list.map((s) => ({ value: s, label: s }));
}

const SALARY: RangeSpec = {
  min: 40,
  max: 600,
  step: 10,
  unit: 'тыс ₽ / мес',
  scale: 1000,
  fromLabel: 'Минимум',
  toLabel: 'Ожидаю',
  defaults: { from: 120, to: 180 },
};

const VACANCY_SALARY: RangeSpec = { ...SALARY, fromLabel: 'От', toLabel: 'До', defaults: { from: 150, to: 250 } };

const hasRole = (ctx: StepContext) => ctx.facts.role !== 'pending';

const consentStep: StepDef = {
  id: 'consent',
  kind: 'consent',
  eyebrow: 'Согласие',
  question: 'Можно я буду работать с твоими данными?',
  sub: 'Без согласия на обработку персональных данных я не могу читать резюме и показывать профиль компаниям.',
  summaryLabel: 'Согласие на обработку данных',
  target: 'Consent (recordConsent), Candidate.consentAt',
  req: 'R-C-14',
  required: true,
  // Согласие берётся при регистрации одной галкой (/auth, /demo — решение владельца 09.10), в чате
  // его нет. Шаг остаётся страховкой для аккаунта без записанного согласия (старые аккаунты):
  // без согласия дальше ни шагу и в модель ничего не уходит.
  when: (ctx) => !ctx.facts.consent,
  doneBy: (ctx) => ctx.facts.consent,
};

const roleStep: StepDef = {
  id: 'role',
  kind: 'role',
  eyebrow: 'Знакомство',
  question: 'Ты здесь как кто?',
  sub: 'Дальше вопросы только под эту роль. Вторую роль можно добавить позже - переключатель в шапке.',
  summaryLabel: 'Роль',
  target: 'User.role (chooseRole)',
  req: 'R-N-07',
  required: true,
  options: [
    { value: 'candidate', label: 'Я специалист', note: 'компании сами находят тебя по навыкам и пишут с вилкой' },
    { value: 'employer', label: 'Я работодатель', note: 'кандидаты с проверенным грейдом по категориям' },
  ],
  doneBy: hasRole,
};

export const CANDIDATE_STEPS: StepDef[] = [
  {
    id: 'goal',
    kind: 'one',
    eyebrow: 'Цель',
    question: 'Зачем ты здесь?',
    sub: 'Под цель подстрою дальнейшие шаги.',
    summaryLabel: 'Цель',
    target: 'CandidateProfile.goal',
    req: 'R-C-04',
    options: [
      { value: 'job_search', label: 'Ищу работу', note: 'хочу приглашения от компаний' },
      { value: 'market_watch', label: 'Смотрю рынок', note: 'пока не меняю работу, интересно, сколько стою' },
      { value: 'grade_confirm', label: 'Хочу подтвердить грейд', note: 'нужна категория по тесту' },
    ],
  },
  {
    id: 'documents',
    kind: 'files',
    eyebrow: 'Документы',
    question: 'Пришли резюме или ссылки',
    sub: 'Прикрепи файл скрепкой (PDF или DOCX до 5 МБ) или просто вставь ссылку на GitHub или портфолио сюда, в сообщение. Я найду в них утверждения о навыках с цитатами - ты подтвердишь или поправишь каждое.',
    summaryLabel: 'Документы',
    target: 'Upload, Source, Claim (конвейер консультанта: /api/uploads → /api/consultant/messages)',
    req: 'R-C-01',
  },
  {
    id: 'fsp',
    kind: 'one',
    eyebrow: 'ФСП',
    question: 'Привяжем ФСП ID?',
    sub: 'Достижения в соревнованиях по спортивному программированию попадут в профиль. Нет истории ФСП - это нормально, на подбор не влияет.',
    summaryLabel: 'ФСП ID',
    target: 'Candidate.fspState',
    req: 'R-C-15, R-FSP-03',
    options: [
      { value: 'linked', label: 'Привязать ФСП ID', note: 'демо: API ФСП не предоставлен, профиль демонстрационный', answered: 'ФСП ID привязан (демо)' },
      { value: 'no_achievements', label: 'ФСП ID есть, достижений пока нет', note: 'демо: привязка без достижений', answered: 'ФСП ID без достижений (демо)' },
      { value: 'not_linked', label: 'Нет истории ФСП', note: 'без штрафа: решает тест на грейд' },
    ],
  },
  {
    id: 'specialization',
    kind: 'one',
    eyebrow: 'Направление',
    question: 'В каком направлении работаешь?',
    sub: 'Выбери основное: под него будет тест на грейд и подбор.',
    summaryLabel: 'Направление',
    target: 'Candidate.specialization',
    req: 'R-C-04',
    options: DIRECTIONS,
  },
  {
    id: 'subcategory',
    kind: 'one',
    eyebrow: 'Подкатегория',
    question: 'А если точнее?',
    sub: 'Тест на грейд идёт по заданиям подкатегории, и работодатель ищет по ней же. Сменить можно потом в профиле или перед тестом.',
    summaryLabel: 'Подкатегория',
    target: 'Candidate.subcategoryId',
    req: 'R-T-05',
    // Обязательна (ADR 0003, дополнение 10.10 15:50): без подкатегории тест на грейд не стартует.
    required: true,
    when: (ctx) => isSpecialization(ctx.answers.specialization ?? ctx.facts.specialization),
    options: (ctx) => subcategoryOptions(ctx.answers.specialization ?? ctx.facts.specialization),
  },
  {
    id: 'grade',
    kind: 'one',
    eyebrow: 'Грейд',
    question: 'На какой грейд претендуешь?',
    sub: 'Это предположение: категорию подтверждает только тест.',
    summaryLabel: 'Предполагаемый грейд',
    target: 'CandidateProfile.claimedGrade',
    req: 'R-C-05',
    options: GRADES,
  },
  {
    id: 'stack',
    kind: 'chips',
    eyebrow: 'Стек',
    question: 'С чем работаешь каждый день?',
    sub: 'Можно несколько и своё.',
    summaryLabel: 'Стек',
    target: 'CandidateProfile.stack',
    req: 'R-C-04',
    allowCustom: true,
    options: (ctx) => stackOptions(ctx.answers.specialization ?? ctx.facts.specialization),
  },
  {
    id: 'formats',
    kind: 'many',
    eyebrow: 'Формат',
    question: 'Как хочешь работать?',
    sub: 'Можно несколько.',
    summaryLabel: 'Формат работы',
    target: 'CandidateProfile.workFormats',
    req: 'R-C-04',
    options: [
      { value: 'remote', label: 'Удалённо', note: 'из любого города' },
      { value: 'hybrid', label: 'Гибрид', note: 'пара дней в офисе' },
      { value: 'office', label: 'Офис', note: 'полностью на месте' },
      { value: 'relocation', label: 'Готов к переезду', note: 'если предложат релокацию' },
    ],
  },
  {
    id: 'city',
    kind: 'text',
    eyebrow: 'Город',
    question: 'В каком городе удобно работать в офисе?',
    summaryLabel: 'Город',
    target: 'CandidateProfile.city',
    req: 'R-C-04',
    maxLength: 80,
    placeholder: 'Например, Казань',
    when: (ctx) => Array.isArray(ctx.answers.formats) && ctx.answers.formats.some((f) => f === 'office' || f === 'hybrid'),
  },
  {
    id: 'salary',
    kind: 'range',
    eyebrow: 'Ожидания',
    question: 'Сколько хочешь получать?',
    sub: 'Компании увидят ожидания, только если их вилка подходит.',
    summaryLabel: 'Зарплата',
    target: 'CandidateProfile.salaryMin, CandidateProfile.salaryExpected',
    req: 'R-C-04',
    range: SALARY,
  },
  {
    // Q-35: служебная почта онбординга (`user-…@users.invalid`) — не контакт; без этого шага
    // работодатель после принятия приглашения видел пустые контакты.
    id: 'candidateContact',
    kind: 'text',
    eyebrow: 'Контакт',
    question: 'Как с тобой связаться?',
    sub: 'Почта или Telegram. Компания увидит контакт, только когда ты примешь её приглашение.',
    summaryLabel: 'Контакт',
    target: 'Candidate.contact',
    req: 'R-E-07, R-C-11',
    maxLength: 120,
    check: 'contact',
    placeholder: 'name@mail.ru или @username',
  },
  {
    id: 'fspParticipation',
    kind: 'one',
    eyebrow: 'ФСП',
    question: 'Участвовал(а) в соревнованиях ФСП?',
    sub: 'Со слов, без подтверждения: подтверждает только привязанный ФСП ID.',
    summaryLabel: 'Участие в ФСП',
    target: 'CandidateProfile.fspParticipation',
    req: 'R-FSP-03',
    options: [
      { value: 'prize', label: 'Призёр или финалист' },
      { value: 'participant', label: 'Участвовал(а)' },
      { value: 'none', label: 'Пока нет', note: 'ничего страшного: решает тест на грейд' },
    ],
    when: (ctx) => ctx.facts.fspState !== 'linked',
  },
];

export const INDUSTRIES: StepOption[] = ['Финтех', 'E-commerce', 'Медиа', 'Госсектор', 'Промышленность', 'Образование', 'Медицина', 'Телеком'].map((v) => ({
  value: v,
  label: v,
}));

export const EMPLOYER_STEPS: StepDef[] = [
  {
    id: 'companyName',
    kind: 'text',
    eyebrow: 'Компания',
    question: 'Как называется компания?',
    sub: 'Так её увидят кандидаты в приглашении.',
    summaryLabel: 'Компания',
    target: 'Company.name (создаётся в chooseRole)',
    req: 'R-E-01',
    required: true,
    maxLength: 120,
    placeholder: 'ООО «Пример»',
    // Роль employer уже выбрана — компания создана, шаг закрыт (название правится в кабинете).
    doneBy: hasRole,
  },
  {
    id: 'inn',
    kind: 'text',
    eyebrow: 'Компания',
    question: 'ИНН компании',
    sub: '10 цифр у организации, 12 - у ИП. Проверю контрольную сумму.',
    summaryLabel: 'ИНН',
    target: 'Company.inn',
    req: 'R-E-01',
    maxLength: 12,
    check: 'inn',
    placeholder: '10 или 12 цифр',
  },
  {
    id: 'industry',
    kind: 'one',
    eyebrow: 'Компания',
    question: 'В какой отрасли работает компания?',
    summaryLabel: 'Отрасль',
    target: 'Company.industry',
    req: 'R-E-01',
    allowCustom: true,
    options: INDUSTRIES,
  },
  {
    id: 'about',
    kind: 'text',
    eyebrow: 'Компания',
    question: 'Пара слов о компании',
    sub: 'Чем занимается компания, продукт, масштаб. Кандидаты прочитают это первым.',
    summaryLabel: 'О компании',
    target: 'Company.description',
    req: 'R-E-01',
    maxLength: 600,
  },
  {
    id: 'contact',
    kind: 'text',
    eyebrow: 'Компания',
    question: 'Как с тобой связаться?',
    sub: 'Почта или Telegram для кандидатов, принявших приглашение.',
    summaryLabel: 'Контакт',
    target: 'Company.contact',
    req: 'R-E-01',
    maxLength: 120,
    check: 'contact',
    placeholder: 'hr@company.ru или @username',
  },
  {
    id: 'needSpecialization',
    kind: 'one',
    eyebrow: 'Кого ищешь',
    question: 'Какое направление нужно?',
    sub: 'Основное направление потребности.',
    summaryLabel: 'Направление',
    target: 'Vacancy.specialization',
    req: 'R-E-02',
    options: DIRECTIONS,
  },
  {
    id: 'needSubcategory',
    kind: 'one',
    eyebrow: 'Подкатегория',
    question: 'Какая подкатегория ближе?',
    sub: 'Подборка ищет в первую очередь кандидатов этой подкатегории; соседние подкатегории направления идут ниже, с пометкой.',
    summaryLabel: 'Подкатегория',
    target: 'Vacancy.subcategoryId',
    req: 'R-T-05',
    // Обязательна для подборки (ADR 0003, дополнение 10.10 15:50).
    required: true,
    when: (ctx) => isSpecialization(ctx.answers.needSpecialization),
    options: (ctx) => subcategoryOptions(ctx.answers.needSpecialization),
  },
  {
    id: 'needGrades',
    kind: 'many',
    eyebrow: 'Грейд',
    question: 'Какой уровень нужен?',
    sub: 'Можно несколько - заведу потребность на каждый грейд.',
    summaryLabel: 'Грейд',
    target: 'Vacancy.grade (по вакансии на грейд)',
    req: 'R-E-02',
    options: [
      { value: 'junior', label: 'Junior', note: 'готов растить' },
      { value: 'middle', label: 'Middle', note: 'самостоятельный специалист' },
      { value: 'senior', label: 'Senior', note: 'принимает проектные решения' },
    ],
  },
  {
    id: 'needStack',
    kind: 'chips',
    eyebrow: 'Стек',
    question: 'На каком стеке команда?',
    sub: 'Можно несколько и своё.',
    summaryLabel: 'Стек',
    target: 'Vacancy.stack, Vacancy.needs (проекция на каталог)',
    req: 'R-E-02',
    allowCustom: true,
    options: (ctx) => stackOptions(ctx.answers.needSpecialization),
  },
  {
    id: 'needTeam',
    kind: 'text',
    eyebrow: 'Команда',
    question: 'Чем занимается команда?',
    sub: 'Продукт, задачи, с чем придётся работать в первые месяцы.',
    summaryLabel: 'Команда',
    target: 'Vacancy.teamDescription',
    req: 'R-E-02',
    maxLength: 600,
  },
  {
    id: 'needSalary',
    kind: 'range',
    eyebrow: 'Вилка',
    question: 'Какая вилка?',
    sub: 'Вилка обязательна в каждом приглашении. Без неё потребность не сохраню.',
    summaryLabel: 'Вилка',
    target: 'Vacancy.salaryFrom, Vacancy.salaryTo',
    req: 'R-E-02, R-E-03',
    range: VACANCY_SALARY,
  },
];

export const SUMMARY_STEP: StepDef = {
  id: 'summary',
  kind: 'summary',
  eyebrow: 'Готово',
  question: 'Вот что я понял',
  summaryLabel: 'Итог',
  target: '-',
  req: '-',
};

export const BASE_STEPS: StepDef[] = [consentStep, roleStep];

/** Все шаги сценария: роль из БД, иначе выбранная в шаге role, иначе — пока только знакомство. */
export function scenarioSteps(ctx: StepContext): { scenario: 'candidate' | 'employer' | null; steps: StepDef[] } {
  const role = ctx.facts.role !== 'pending' ? ctx.facts.role : ctx.answers.role;
  if (role === 'candidate') return { scenario: 'candidate', steps: [...BASE_STEPS, ...CANDIDATE_STEPS, SUMMARY_STEP] };
  if (role === 'employer') return { scenario: 'employer', steps: [...BASE_STEPS, ...EMPLOYER_STEPS, SUMMARY_STEP] };
  return { scenario: null, steps: [...BASE_STEPS, SUMMARY_STEP] };
}

export function findStep(id: string): StepDef | undefined {
  return [...BASE_STEPS, ...CANDIDATE_STEPS, ...EMPLOYER_STEPS, SUMMARY_STEP].find((s) => s.id === id);
}
