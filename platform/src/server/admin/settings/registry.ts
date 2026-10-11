import { z } from 'zod';

import { COMPLAINT_SANCTIONS, COMPLAINT_TRUST_PENALTY, COMPLAINT_WINDOW_DAYS, NO_SHOW_TRUST_PENALTY, SALARY_LIMITS, TRUST_WEIGHTS } from '@/server/employer/antifraud';
import { DAILY_INVITATION_LIMIT } from '@/server/employer/weights';
import { getEnv } from '@/server/env';
import { GRADE_CHANGE_INTERVAL_DAYS, RETAKE_SAME_GRADE_DAYS } from '@/server/recommend/weights';

/**
 * Реестр настроек платформы без деплоя (E-08, фаза 4). Значение по умолчанию живёт в коде (константа модуля
 * или env), строка `PlatformSetting` его перекрывает; схема Zod проверяет и запись, и чтение из БД.
 * Секреты и границы безопасности (DEMO_LOGIN, ключи) сюда не попадают намеренно.
 */

export const SETTING_GROUPS = [
  { id: 'test', title: 'Тест и грейд' },
  { id: 'employer', title: 'Работодатель: приглашения, санкции, доверие' },
  { id: 'llm', title: 'LLM и созвоны' },
  { id: 'catalog', title: 'Справочники (правятся на странице «Справочники»)' },
] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number]['id'];

export interface SettingDef<T> {
  group: SettingGroup;
  title: string;
  description: string;
  schema: z.ZodType<T>;
  /** Функция, а не значение: умолчание может читать env лениво. */
  default: () => T;
  /** Единица для подписи в форме. */
  unit?: string;
  /** Правится не общей формой настроек, а своим экраном (скрытые шаблоны). */
  internal?: boolean;
}

function def<T>(d: SettingDef<T>): SettingDef<T> {
  return d;
}

const days = (max = 365) => z.number().int().min(0).max(max);
const pos = (max: number) => z.number().int().min(1).max(max);

export const SETTINGS = {
  'test.gradeChangeIntervalDays': def({
    group: 'test',
    title: 'Смена грейда: интервал',
    description: 'Не чаще одного раза в N дней кандидат может сменить подтверждённый грейд (R-C-09).',
    schema: days(),
    default: () => GRADE_CHANGE_INTERVAL_DAYS,
    unit: 'дней',
  }),
  'test.retakeSameGradeDays': def({
    group: 'test',
    title: 'Пересдача того же грейда: интервал',
    description: 'Через сколько дней можно пересдать тест на тот же грейд.',
    schema: days(),
    default: () => RETAKE_SAME_GRADE_DAYS,
    unit: 'дней',
  }),
  'employer.dailyInvitationLimit': def({
    group: 'employer',
    title: 'Приглашения: лимит в сутки',
    description: 'Сколько приглашений компания отправляет за скользящие 24 часа (против спама).',
    schema: pos(1000),
    default: () => DAILY_INVITATION_LIMIT,
    unit: 'шт.',
  }),
  'employer.complaintWindowDays': def({
    group: 'employer',
    title: 'Жалобы: окно подсчёта',
    description: 'За сколько последних дней считаются жалобы кандидатов (кроме отклонённых).',
    schema: pos(365),
    default: () => COMPLAINT_WINDOW_DAYS,
    unit: 'дней',
  }),
  'employer.complaintSanctions': def({
    group: 'employer',
    title: 'Санкции по жалобам',
    description: 'reducedAt жалоб за окно: суточный лимит не больше reducedLimit; blockedAt жалоб: отправка закрыта.',
    schema: z
      .object({ reducedAt: pos(1000), reducedLimit: z.number().int().min(0).max(1000), blockedAt: pos(1000) })
      .refine((v) => v.reducedAt <= v.blockedAt, { message: 'reducedAt не может быть больше blockedAt' }),
    default: () => ({ ...COMPLAINT_SANCTIONS }),
  }),
  'employer.complaintTrustPenalty': def({
    group: 'employer',
    title: 'Индекс доверия: штраф за жалобы',
    description: 'perComplaint баллов за каждую жалобу, суммарно не больше max.',
    schema: z.object({ perComplaint: z.number().int().min(0).max(100), max: z.number().int().min(0).max(100) }),
    default: () => ({ ...COMPLAINT_TRUST_PENALTY }),
  }),
  'employer.noShowTrustPenalty': def({
    group: 'employer',
    title: 'Индекс доверия: штраф за неявки',
    description: 'perNoShow баллов за неявку работодателя на назначенную защиту, суммарно не больше max.',
    schema: z.object({ perNoShow: z.number().int().min(0).max(100), max: z.number().int().min(0).max(100) }),
    default: () => ({ ...NO_SHOW_TRUST_PENALTY }),
  }),
  'employer.trustWeights': def({
    group: 'employer',
    title: 'Индекс доверия: веса сигналов',
    description: 'Максимум баллов за заполненность профиля, ИНН, возраст аккаунта и долю принятых приглашений.',
    schema: z
      .object({
        profile: z.number().int().min(0).max(100),
        inn: z.number().int().min(0).max(100),
        age: z.number().int().min(0).max(100),
        declines: z.number().int().min(0).max(100),
      })
      .refine((v) => v.profile + v.inn + v.age + v.declines <= 100, { message: 'Сумма весов не больше 100: индекс доверия измеряется по шкале 0-100' }),
    default: () => ({ ...TRUST_WEIGHTS }),
  }),
  'employer.salaryLimits': def({
    group: 'employer',
    title: 'Красные флаги: границы вилки',
    description: 'Вилка «от» ниже minFrom, «до» выше maxTo или «до» больше «от» в maxRatio раз даёт красный флаг.',
    schema: z.object({ minFrom: z.number().int().min(0).max(10_000_000), maxTo: z.number().int().min(1).max(100_000_000), maxRatio: z.number().min(1).max(100) }),
    default: () => ({ ...SALARY_LIMITS }),
    unit: '₽ в месяц',
  }),
  'llm.dailyTokenBudget': def({
    group: 'llm',
    title: 'LLM: суточный бюджет токенов на пользователя',
    description: '0 - без лимита. По умолчанию берётся из env LLM_DAILY_TOKEN_BUDGET.',
    schema: z.number().int().min(0).max(100_000_000),
    default: () => getEnv().LLM_DAILY_TOKEN_BUDGET,
    unit: 'токенов',
  }),
  'call.dailyLimit': def({
    group: 'llm',
    title: 'Созвоны: лимит в сутки на кандидата',
    description: '0 - без лимита. По умолчанию из env CALL_DAILY_LIMIT. Демо-кандидаты освобождены.',
    schema: z.number().int().min(0).max(1000),
    default: () => getEnv().CALL_DAILY_LIMIT,
    unit: 'шт.',
  }),
  'call.recordingRetentionDays': def({
    group: 'llm',
    title: 'Аудио созвонов: срок хранения',
    description: 'После срока файлы удаляются (ADR 0005). По умолчанию из env CALL_RECORDING_RETENTION_DAYS. Тексты согласий показывают этот срок.',
    schema: z.number().int().min(1).max(3650),
    default: () => getEnv().CALL_RECORDING_RETENTION_DAYS,
    unit: 'дней',
  }),
  'matching.show_demo_candidates': def({
    group: 'employer',
    title: 'Демо-кандидаты в подборке',
    description: 'Показывать ли демо-кандидатов работодателям в подборке и поиске. Переключается на странице «Демо-данные».',
    schema: z.boolean(),
    default: () => true,
    internal: true,
  }),
  'catalog.hiddenTaskTemplates': def({
    group: 'catalog',
    title: 'Снятые с публикации шаблоны заданий теста',
    description: 'ID шаблонов TaskTemplate, которые не выдаются в новых заданиях теста.',
    schema: z.array(z.string().min(1).max(100)).max(1000),
    default: () => [] as string[],
    internal: true,
  }),
  'catalog.hiddenProjectTemplates': def({
    group: 'catalog',
    title: 'Снятые с публикации шаблоны проектов',
    description: 'ID шаблонов ProjectTemplate, которые работодатель не может выбрать для задания.',
    schema: z.array(z.string().min(1).max(100)).max(1000),
    default: () => [] as string[],
    internal: true,
  }),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<string, SettingDef<any>>;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(x: string): x is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, x);
}
