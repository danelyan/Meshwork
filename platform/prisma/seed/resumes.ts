import { SPEC_LABEL } from '../../src/lib/directions';
import { GRADE_LABEL } from '../../src/lib/grades';
import type { DemoProfile } from './employer';

/**
 * Резюме демо-кандидатов (решение владельца 11.10): цитата утверждения с уровнем self_reported – ДОСЛОВНАЯ
 * строка резюме, а не выдуманный текст с несуществующим источником. Источник: `<candidateId>-resume.md#p1`.
 * Резюме персон этапов 4–8 написаны вручную (PERSONA_RESUMES); резюме пула (~90 человек) собирается из шапки
 * и строк по утверждениям (`generatedResume`) и воспроизводимо: тот же профиль даёт тот же текст.
 * Все люди и профили вымышлены.
 */
export interface DemoResume {
  fileName: string;
  text: string;
  /** catalogId → строка резюме, которая подтверждает это утверждение (входит в `text` дословно). */
  lines: Record<string, string>;
}

export const resumeFileName = (candidateId: string): string => `${candidateId}-resume.md`;

const stripDemo = (name: string): string => name.replace(/^Демо:\s*/, '');

function resume(candidateId: string, header: string[], bullets: string[], lines: Record<string, string>, skills: string): DemoResume {
  const text = [...header, '', '## Опыт', ...bullets.map((b) => `- ${b}`), '', '## Навыки', skills, ''].join('\n');
  return { fileName: resumeFileName(candidateId), text, lines };
}

const SHARED_BE_J = (a: string, c: string, d: string) => ({ 'be.authn-impl': a, 'be.config-secrets': c, 'common.debugging': d });

/** Вручную написанные резюме персон, у которых есть утверждения со ссылкой на резюме (self_reported). */
export const PERSONA_RESUMES: Record<string, DemoResume> = {
  'demo-tested': (() => {
    const l = {
      'fe.js-core': 'Писала на чистом JavaScript: разбирала замыкания, this, прототипы и приведение типов.',
      'fe.components': 'Делила интерфейс на переиспользуемые компоненты на React: props, композиция, контролируемые поля.',
      'fe.forms': 'Делала формы с проверкой полей, понятными ошибками и состоянием отправки.',
    };
    return resume('demo-tested', [
      '# Ксения Андреева – Junior Frontend (React)', '',
      'ksenia.andreeva@example.com · Казань · GitHub: demo-andreeva (вымышленный профиль)', '',
      '## О себе', 'Пришла из курсов, год делаю учебные и небольшие коммерческие проекты.',
    ], [
      'Верстка лендингов на семантическом HTML, раскладки на Flexbox и Grid, mobile-first.',
      l['fe.js-core'], l['fe.components'], l['fe.forms'],
      'Ветки и pull request\'ы в Git, код лежит на GitHub.',
    ], l, 'HTML, CSS, JavaScript, React, Git.');
  })(),
  'demo-invited': (() => {
    const l = SHARED_BE_J(
      'Реализовала на сервере вход по логину и паролю: хеш паролей, сессия в cookie, обновление токена.',
      'Вынесла конфигурацию и секреты из кода в переменные окружения; файл .env не попадает в репозиторий.',
      'Искала причину ошибок по стектрейсу и логам и сводила её к минимальному воспроизведению.',
    );
    return resume('demo-invited', [
      '# Марина Котова – Junior Backend (Node.js)', '',
      'marina.kotova@example.com · Екатеринбург · GitHub: demo-kotova (вымышленный профиль)', '',
      '## О себе', 'Полтора года пишу серверную часть небольших сервисов на NestJS.',
    ], [
      'REST API на NestJS с валидацией входных данных и понятными ошибками.',
      l['be.authn-impl'], l['be.config-secrets'], l['common.debugging'],
      'Таблицы и запросы в PostgreSQL для личного кабинета.',
    ], l, 'Node.js, NestJS, PostgreSQL, Git.');
  })(),
  'demo-hired': (() => {
    const l = SHARED_BE_J(
      'Сделала аутентификацию в учебном магазине: пароли в виде хеша, JWT с обновлением по refresh-токену.',
      'Убрала ключи и пароли из кода: настройки читаются из окружения, секреты хранятся в хранилище CI.',
      'Находила причины падений по логам и стектрейсу и воспроизводила их в минимальном примере.',
    );
    return resume('demo-hired', [
      '# Алёна Мироненко – Junior Backend (Node.js)', '',
      'alena.mironenko@example.com · Самара · GitHub: demo-mironenko (вымышленный профиль)', '',
      '## О себе', 'Закончила курс по бэкенду, два проекта с реальными пользователями.',
    ], [
      'API на NestJS: DTO, проверка входных данных, единый формат ошибок.',
      l['be.authn-impl'], l['be.config-secrets'], l['common.debugging'],
      'Работа с PostgreSQL через ORM, миграции схемы.',
    ], l, 'Node.js, NestJS, PostgreSQL, Docker, Git.');
  })(),
  'demo-accepted': (() => {
    const l = SHARED_BE_J(
      'Написал вход пользователей на сервере: хеширование паролей, серверные сессии в Redis, выход со всех устройств.',
      'Вынес конфигурацию и секреты из кода в переменные окружения, для разных стендов свои значения.',
      'Находил причину ошибки по стектрейсу и логам, сводил её к минимальному воспроизведению.',
    );
    return resume('demo-accepted', [
      '# Роман Зайцев – Junior Backend (Node.js)', '',
      '@roman_zaitsev_demo · Новосибирск · GitHub: demo-zaitsev (вымышленный профиль)', '',
      '## О себе', 'Год в небольшой студии, пишу сервисы на Node.js.',
    ], [
      'Сервисы на NestJS: REST API, кэш на Redis, фоновые задачи.',
      l['be.authn-impl'], l['be.config-secrets'], l['common.debugging'],
      'Проверка входных данных и ошибки в едином формате.',
    ], l, 'Node.js, NestJS, Redis, PostgreSQL, Git.');
  })(),
};

const CITIES = ['Москва', 'Санкт-Петербург', 'Казань', 'Екатеринбург', 'Новосибирск', 'Самара', 'Нижний Новгород', 'Томск', 'Пермь', 'Ростов-на-Дону', 'Краснодар', 'Воронеж'];
const MALE_EXCEPTIONS = new Set(['Никита']);
/** Существительные и слова на -л после гласной, которые не нужно менять при переводе в женский род. */
const NOT_VERBS = new Set(['узел', 'протокол', 'стол', 'канал', 'скрипт', 'релиз', 'интервал', 'журнал']);

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export function isFemaleName(fullName: string): boolean {
  const given = stripDemo(fullName).split(/\s+/)[0] ?? '';
  return /[ая]$/.test(given) && !MALE_EXCEPTIONS.has(given);
}

/** «Проектировал и разбирал» → «Проектировала и разбирала»: глаголы прошедшего времени в женский род. */
export function feminize(line: string): string {
  return line
    .replace(/[А-Яа-яЁё]+лся(?![а-яё])/g, (w) => `${w.slice(0, -2)}ась`)
    .replace(/[А-Яа-яЁё]+(?:ал|ял|ил|ел|ул)(?![а-яё])/g, (w) => (NOT_VERBS.has(w.toLowerCase()) ? w : `${w}а`));
}

/** Строка резюме для утверждения: формулировка каталога (уже в виде «Делал …»), в нужном роде. */
export function resumeLine(p: DemoProfile, statement: string): string {
  const s = statement.trim().replace(/[.]$/, '');
  return `${isFemaleName(p.name) ? feminize(s) : s}.`;
}

/** Резюме пула: шапка из данных профиля, по одной строке на каждое утверждение с опорой на резюме (self_reported). */
export function generatedResume(p: DemoProfile, statementOf: (catalogId: string) => string): DemoResume {
  const name = stripDemo(p.name);
  const contact = p.contact ?? `${p.id.replace(/^demo-pool-/, 'candidate.')}@example.com`;
  const city = CITIES[hash(p.id) % CITIES.length]!;
  const role = p.specialization ? SPEC_LABEL[p.specialization] : 'IT';
  const grade = p.category ? ` · ${GRADE_LABEL[p.category.grade]}` : '';
  const lines: Record<string, string> = {};
  for (const [catalogId, level] of p.claims) if (level === 'self_reported') lines[catalogId] = resumeLine(p, statementOf(catalogId));
  return resume(p.id, [
    `# ${name} – ${role}${grade}`, '',
    `${contact} · ${city} (вымышленный профиль)`,
  ], Object.values(lines), lines, `${p.stack.join(', ')}.`);
}

/** Резюме профиля: вручную написанное (персоны) или собранное из утверждений (пул). */
export function resumeFor(p: DemoProfile, statementOf: (catalogId: string) => string): DemoResume {
  return PERSONA_RESUMES[p.id] ?? generatedResume(p, statementOf);
}
