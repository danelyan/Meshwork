// Стандартизированный PDF-профиль кандидата (R-C-03): чистая сборка «профиль → документ из секций».
// Без БД и без PDF — так состав документа проверяется unit-тестами, а render.ts только рисует.
// В документ попадают только подтверждённые кандидатом утверждения (confirmed | edited), без цитат.
import { specLabel, subcategoryLabel } from '@/lib/directions';
import { gradeLabel } from '@/lib/grades';
import { LEVEL_LABEL, LEVELS_TOP_DOWN, formatDate } from '@/lib/labels';
import { countOf } from '@/lib/plural';
import type { ProfileClaim, ProfileView } from '@/server/claims/types';

export interface ProfileBasicsInput {
  city: string | null;
  claimedGrade: string | null;
  stack: string[];
  workFormats: string[];
  salaryMin: number | null;
  salaryExpected: number | null;
  experienceYears: number | null;
  roles: string[];
  softSkills: string[];
}

export interface ProfileStagesInput {
  /** Последний завершённый квалифицирующий созвон с ИИ: итог и дата; null — не проводился. */
  call: { summary: string; evaluatedAt: string } | null;
  /** Проектные задания: сдано всего и проверено автопроверкой. */
  projects: { submitted: number; checked: number };
  /** Защиты утверждений: завершено и из них пройдено. */
  defenses: { completed: number; passed: number };
}

export interface ProfileDocumentInput {
  profile: ProfileView;
  /** Контакт самого кандидата (почта или Telegram) — PDF формирует владелец профиля. */
  contact: string | null;
  basics: ProfileBasicsInput | null;
  /** Подкатегория текущей категории (Subcategory.id); null — категория без подкатегории. */
  subcategoryId: string | null;
  /** Версия политики теста попытки, выдавшей категорию (TestAttempt.policyVersion); null — попытки в базе нет (демоданные). */
  policyVersion: string | null;
  stages: ProfileStagesInput;
  generatedAt: Date;
}

export interface DocFact {
  label: string;
  value: string;
}

export interface DocSection {
  title: string;
  facts?: DocFact[];
  items?: string[];
  /** Текст вместо списка, когда данных нет. */
  empty?: string;
  /** Пояснение мелким кеглем под секцией. */
  note?: string;
}

export interface ProfileDocument {
  brand: string;
  title: string;
  name: string;
  /** Направление и город под именем. */
  headline: string;
  generatedAt: string;
  sections: DocSection[];
  footer: string;
}

const FORMAT_LABEL: Record<string, string> = { remote: 'удалённо', hybrid: 'гибрид', office: 'офис', relocation: 'переезд' };
const FSP_LABEL: Record<string, string> = {
  linked: 'ФСП ID привязан, достижения в профиле',
  no_achievements: 'ФСП ID привязан, достижений в реестре нет',
  unavailable: 'ФСП ID привязан, реестр был недоступен',
  not_linked: 'ФСП ID не подключён',
};
const YEARS = ['год', 'года', 'лет'] as const;
const money = new Intl.NumberFormat('ru-RU');

export const PDF_FILENAME = 'fsp-career-profile.pdf';

const isShown = (c: ProfileClaim) => c.status === 'confirmed' || c.status === 'edited';

function formatDateTime(d: Date): string {
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }) + ' МСК';
}

function categorySection(input: ProfileDocumentInput): DocSection {
  const { category } = input.profile;
  if (!category) {
    const facts: DocFact[] = [{ label: 'Категория', value: 'не подтверждена: тест на грейд ещё не пройден' }];
    const claimed = input.basics?.claimedGrade;
    if (claimed) facts.push({ label: 'Заявленный грейд', value: `${gradeLabel(claimed)} · со слов кандидата, не подтверждён` });
    return { title: 'Категория', facts, note: 'Категорию «направление × грейд» даёт только тест на грейд на платформе; заявленный грейд в неё не входит.' };
  }
  const facts: DocFact[] = [
    { label: 'Категория', value: `${specLabel(category.specialization)} · ${gradeLabel(category.grade)}` },
    { label: 'Подкатегория', value: input.subcategoryId ? subcategoryLabel(input.subcategoryId) : 'не указана' },
    { label: 'Подтверждена тестом', value: formatDate(category.confirmedAt) },
    { label: 'Политика теста', value: input.policyVersion ?? 'не сохранена: попытки теста для этой категории в базе нет (демоданные)' },
  ];
  return { title: 'Категория', facts, note: 'Категория выдана адаптивным тестом на грейд; параметры заданий — экспертные оценки, на людях не калиброваны.' };
}

function basicsSection(input: ProfileDocumentInput): DocSection {
  const p = input.basics;
  const spec = input.profile.candidate.specialization;
  const facts: DocFact[] = [
    { label: 'Контакт', value: input.contact ?? 'не указан' },
    { label: 'Направление', value: spec ? specLabel(spec) : 'не выбрано' },
    { label: 'Город', value: p?.city || 'не указан' },
    { label: 'Формат работы', value: p?.workFormats.length ? p.workFormats.map((f) => FORMAT_LABEL[f] ?? f).join(', ') : 'не указан' },
    { label: 'Стаж', value: p?.experienceYears != null ? countOf(p.experienceYears, YEARS) : 'не указан' },
    { label: 'Роли', value: p?.roles.length ? p.roles.join(', ') : 'не указаны' },
    { label: 'Стек', value: p?.stack.length ? p.stack.join(', ') : 'не указан' },
    { label: 'Софт-скиллы', value: p?.softSkills.length ? p.softSkills.join(', ') : 'не указаны' },
    {
      label: 'Ожидания',
      value: p?.salaryMin != null ? `от ${money.format(p.salaryMin)}${p.salaryExpected != null ? ` до ${money.format(p.salaryExpected)}` : ''} ₽ в месяц` : 'не указаны',
    },
  ];
  return { title: 'Основное', facts };
}

function claimsSection(claims: ProfileClaim[]): DocSection {
  const items = LEVELS_TOP_DOWN.flatMap((level) => claims.filter((c) => c.level === level).map((c) => `${c.statement} — ${LEVEL_LABEL[c.level]}`));
  return {
    title: 'Утверждения о навыках',
    items,
    empty: 'Подтверждённых утверждений пока нет.',
    note: 'Уровень доказанности: «платформа» — проверено тестом или защитой на платформе; «третья сторона» — подтверждено человеком или сервисом; «есть ссылка на работу» — репозиторий, статья, публичный профиль; «со слов» — только из резюме или чата.',
  };
}

function fspSection(input: ProfileDocumentInput, fspClaims: ProfileClaim[]): DocSection {
  const state = input.profile.candidate.fspState;
  return {
    title: 'Достижения ФСП',
    facts: [{ label: 'Статус', value: FSP_LABEL[state] ?? state }],
    items: state === 'linked' ? fspClaims.map((c) => c.statement) : [],
    note: 'ФСП ID и реестр достижений — симулятор команды на синтетических данных, не официальная интеграция ФСП.',
  };
}

function stagesSection(stages: ProfileStagesInput): DocSection {
  const { call, projects, defenses } = stages;
  return {
    title: 'Ступени проверки сверх теста',
    facts: [
      { label: 'Созвон с ИИ', value: call ? `${call.summary} (${formatDate(call.evaluatedAt)})` : 'не проводился' },
      { label: 'Проектные задания', value: projects.submitted ? `сдано ${projects.submitted}, проверено автопроверкой ${projects.checked}` : 'не сдавались' },
      { label: 'Защита утверждений', value: defenses.completed ? `пройдено ${defenses.passed} из ${defenses.completed}` : 'не проводилась' },
    ],
    note: 'Созвон, проект и защита — дополнительные сигналы о подтверждённости опыта; в категорию из теста они не входят.',
  };
}

/** Документ PDF-профиля из данных кандидата. Чистая функция: одинаковый вход — одинаковый документ. */
export function buildProfileDocument(input: ProfileDocumentInput): ProfileDocument {
  const shown = input.profile.claims.filter(isShown);
  const skillClaims = shown.filter((c) => c.sourceKind !== 'fsp');
  const fspClaims = shown.filter((c) => c.sourceKind === 'fsp');
  const spec = input.profile.candidate.specialization;
  const generatedAt = formatDateTime(input.generatedAt);
  return {
    brand: 'ФСП Карьера',
    title: 'Профиль кандидата',
    name: input.profile.candidate.name,
    headline: [spec ? specLabel(spec) : 'Направление не выбрано', input.basics?.city].filter(Boolean).join(' · '),
    generatedAt,
    sections: [categorySection(input), basicsSection(input), claimsSection(skillClaims), fspSection(input, fspClaims), stagesSection(input.stages)],
    footer: `Сформировано автоматически, ФСП Карьера, ${generatedAt}. Данные — из профиля кандидата на момент формирования; у каждого утверждения на платформе есть источник и уровень доказанности.`,
  };
}
