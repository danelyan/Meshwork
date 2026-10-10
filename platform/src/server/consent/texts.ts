// Тексты согласий (ADR 0005, R-C-14). Единое место: галочки регистрации и онбординга, кабинет «Мои согласия»,
// сервер (проверка версии), страница /consent и документы лейна legal ссылаются на эти версии.
// Заготовки — docs/research/26-consent-competitors.md, раздел 4 (Г1–Г7). Черновик, не юридический текст:
// оператор во всех текстах — заглушка OPERATOR (решение владельца). Модуль без серверных импортов: его читает клиент.
// Меняется текст — меняется версия; согласие на прежнюю версию считается устаревшим и спрашивается заново.

export const CONSENT_KINDS = [
  'pd_processing',
  'call_recording',
  'ai_assessment',
  'employer_visibility',
  'research',
  'marketing',
  'identity_disclosure',
  'employer_offer',
  'employer_data_obligation',
] as const;
export type ConsentKindName = (typeof CONSENT_KINDS)[number];

export const isConsentKind = (v: unknown): v is ConsentKindName => typeof v === 'string' && (CONSENT_KINDS as readonly string[]).includes(v);

/** Заглушка оператора (решение владельца 11.10): реквизиты подставит команда. */
export const OPERATOR = '[Оператор: наименование, ИНН, адрес]';

/** Срок хранения аудио созвона по умолчанию; фактический — env CALL_RECORDING_RETENTION_DAYS. */
export const CALL_RECORDING_RETENTION_DAYS_DEFAULT = 90;

/** Срок ответа на возражение против автоматической оценки (ст. 16 152-ФЗ). */
export const OBJECTION_ANSWER_DAYS = 30;

/** Все тексты — черновик: юрист их не проверял. */
export const CONSENT_IS_DRAFT = true;

export type ConsentAudience = 'candidate' | 'employer' | 'account';

export interface ConsentText {
  kind: ConsentKindName;
  version: string;
  audience: ConsentAudience;
  /** Название в кабинете «Мои согласия». */
  title: string;
  /** Подпись галочки. */
  label: string;
  paragraphs: readonly string[];
  /** Что блокируется без согласия (null — необязательное, ни на что не влияет). */
  requiredFor: string | null;
  /**
   * Как отзывается: 'button' — кнопка «Отозвать» в кабинете; 'erase' — только удалением аккаунта (Г1);
   * 'per_invitation' — отдельно по каждому приглашению (Г5).
   */
  revoke: 'button' | 'erase' | 'per_invitation';
  /** Ссылка на документ (лейн legal). */
  docUrl?: string;
}

export const CONSENT_TEXTS: Record<ConsentKindName, ConsentText> = {
  pd_processing: {
    kind: 'pd_processing',
    version: '2026-10-11-pd-draft',
    audience: 'account',
    title: 'Обработка персональных данных',
    label: 'Согласен(на) на обработку персональных данных',
    paragraphs: [
      `Я даю ${OPERATOR} согласие на обработку моих персональных данных: имени, адреса электронной почты, идентификатора аккаунта Яндекс ID, способа связи, загруженных мной резюме и документов, ссылок на профили, ответов в чате и в опросе, результатов теста, созвона и проекта, достижений ФСП.`,
      'Цель обработки — определение моей категории (специализация и грейд) и ведение моего профиля на платформе «ФСП Карьера». Показ профиля работодателям, оценка ИИ и запись созвона — отдельные согласия.',
      'Данные обрабатываются на серверах в Российской Федерации, в том числе с помощью языковых моделей, размещённых в РФ.',
      'Согласие действует до его отзыва. Отозвать его можно в настройках кабинета кнопкой «Отозвать согласие и удалить данные»: аккаунт, профиль, загруженные файлы и записи созвонов удаляются сразу, без восстановления.',
    ],
    requiredFor: 'регистрации',
    revoke: 'erase',
    docUrl: '/consent',
  },
  call_recording: {
    kind: 'call_recording',
    version: '2026-10-11-call-recording-draft',
    audience: 'candidate',
    title: 'Запись ИИ-созвона',
    label: 'Согласен(на) на запись голоса и транскрипта ИИ-созвона',
    paragraphs: [
      `Я согласен(на), что во время ИИ-созвона ${OPERATOR} запишет мой голос и сохранит расшифровку разговора.`,
      'Запись используется только для оценки моих ответов и на защите проекта; по голосу меня не идентифицируют. Работодатель видит только оценки по темам, пока я не принял его приглашение; транскрипт и аудио открываются ему после того, как я принял приглашение и согласился раскрыть ему свои данные.',
      `Аудио хранится ${CALL_RECORDING_RETENTION_DAYS_DEFAULT} дней с даты созвона, потом удаляется; транскрипт и оценки остаются в профиле.`,
      'Согласие можно отозвать в кабинете («Мои согласия»): уже сохранённые аудиозаписи удаляются сразу, а новые созвоны идут в текстовом режиме без записи голоса.',
    ],
    requiredFor: 'голосового созвона (без него созвон проходит текстом)',
    revoke: 'button',
  },
  ai_assessment: {
    kind: 'ai_assessment',
    version: '2026-10-11-ai-assessment-draft',
    audience: 'candidate',
    title: 'Оценка с помощью ИИ',
    label: 'Согласен(на), что мои ответы в тесте, созвоне и защите оценивает ИИ',
    paragraphs: [
      'Я понимаю, что мои ответы в тесте на грейд, в ИИ-созвоне и на защите проекта оценивают модель ИИ и автоматические правила проверки, и даю согласие на такую обработку (ч. 2 ст. 16 152-ФЗ).',
      'Оценка — подсказка для работодателя, а не решение: решение о найме принимает работодатель.',
      `Я могу возразить против оценки кнопкой «Оспорить» рядом с результатом в кабинете; ответ придёт в течение ${OBJECTION_ANSWER_DAYS} дней.`,
      'Без этого согласия тест, созвон и защита недоступны; остальные функции работают. Отозвать согласие можно в кабинете («Мои согласия»).',
    ],
    requiredFor: 'теста на грейд, ИИ-созвона и защиты',
    revoke: 'button',
    docUrl: '/ai',
  },
  employer_visibility: {
    kind: 'employer_visibility',
    version: '2026-10-11-visibility-draft',
    audience: 'candidate',
    title: 'Показ профиля работодателям под псевдонимом',
    label: 'Показывать мой профиль работодателям под псевдонимом',
    paragraphs: [
      'Я согласен(на), что работодатели, зарегистрированные на платформе, будут видеть мой профиль под псевдонимом: категорию, навыки, результаты теста и проекта, достижения ФСП — без имени и контактов.',
      'Отключить показ можно в кабинете в любой момент; тогда профиль пропадает из поиска и подборок.',
    ],
    requiredFor: 'показа профиля в поиске работодателей',
    revoke: 'button',
  },
  research: {
    kind: 'research',
    version: '2026-10-11-research-draft',
    audience: 'candidate',
    title: 'Проверка качества теста и оценщика',
    label: 'Разрешаю использовать мои ответы обезличенно для проверки качества',
    paragraphs: [
      'Я разрешаю использовать мои ответы и записи в обезличенном виде для проверки качества теста и оценщика. Без этого согласия данные в такие выборки не попадают.',
    ],
    requiredFor: null,
    revoke: 'button',
  },
  marketing: {
    kind: 'marketing',
    version: '2026-10-11-marketing-draft',
    audience: 'candidate',
    title: 'Рассылки',
    label: 'Согласен(на) получать информационные сообщения',
    paragraphs: [
      'Я согласен(на) получать информационные и рекламные сообщения платформы на мою почту. Сейчас платформа рассылок не ведёт: согласие сохраняется и ни на что не влияет.',
    ],
    requiredFor: null,
    revoke: 'button',
  },
  identity_disclosure: {
    kind: 'identity_disclosure',
    version: '2026-10-11-disclosure-draft',
    audience: 'candidate',
    title: 'Раскрытие имени и контактов работодателю',
    label: 'Раскрыть этому работодателю моё имя и контакты',
    paragraphs: [
      `Я принимаю приглашение и согласен(на) раскрыть этому работодателю моё имя и способ связи для обсуждения найма. ${OPERATOR} передаёт эти данные только этому работодателю; дальше он обрабатывает их самостоятельно как отдельный оператор.`,
      'Отозвать раскрытие можно в кабинете («Мои согласия»): работодатель снова увидит псевдоним. Данные, которые он уже получил, отозвать невозможно.',
    ],
    requiredFor: 'принятия приглашения',
    revoke: 'per_invitation',
  },
  employer_offer: {
    kind: 'employer_offer',
    version: '2026-10-11-employer-offer-draft',
    audience: 'employer',
    title: 'Условия для работодателей (оферта)',
    label: 'Принимаю условия для работодателей (оферта)',
    paragraphs: [`Я принимаю условия использования платформы для работодателей (оферта ${OPERATOR}) от имени компании.`],
    requiredFor: 'поиска кандидатов и отправки приглашений',
    revoke: 'button',
    docUrl: '/employer-terms',
  },
  employer_data_obligation: {
    kind: 'employer_data_obligation',
    version: '2026-10-11-employer-data-draft',
    audience: 'employer',
    title: 'Обязательство по данным кандидатов',
    label: 'Обязуюсь использовать данные кандидатов только для найма',
    paragraphs: [
      'Обязуюсь использовать данные кандидатов только для найма, не передавать их третьим лицам и удалять по запросу кандидата.',
    ],
    requiredFor: 'поиска кандидатов и отправки приглашений',
    revoke: 'button',
  },
};

/** Согласия, которые кандидат даёт в онбординге (Г3, Г4, Г6, Г7) — порядок галочек. */
export const CANDIDATE_ONBOARDING_KINDS = ['ai_assessment', 'employer_visibility', 'research', 'marketing'] as const satisfies readonly ConsentKindName[];
/** Согласия работодателя в онбординге: обе обязательны для поиска и приглашений. */
export const EMPLOYER_ONBOARDING_KINDS = ['employer_offer', 'employer_data_obligation'] as const satisfies readonly ConsentKindName[];

export const consentVersion = (kind: ConsentKindName): string => CONSENT_TEXTS[kind].version;

// --- совместимость со старыми именами (onboarding/consent-text.ts, server/auth/consent.ts, call) ---
export const CONSENT_VERSION = CONSENT_TEXTS.pd_processing.version;
export const CONSENT_PARAGRAPHS = CONSENT_TEXTS.pd_processing.paragraphs;
export const CALL_RECORDING_CONSENT_VERSION = CONSENT_TEXTS.call_recording.version;
export const CALL_RECORDING_CONSENT_PARAGRAPHS = CONSENT_TEXTS.call_recording.paragraphs;
