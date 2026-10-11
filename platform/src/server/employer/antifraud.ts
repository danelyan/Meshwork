// Антифрод (R-X-01, концепт): красные флаги в тексте потребности и приглашения и «индекс доверия» компании.
// Чистые функции без БД. Правила и пороги – наше предложение без калибровки на реальных обманах;
// флаг – повод присмотреться, а не вердикт: отправку и сохранение он не блокирует.
import { maskContacts } from '../collector/mask';

export type RedFlagCode = 'no_salary' | 'salary_unrealistic' | 'contacts_in_text' | 'payment_request' | 'self_employed_required' | 'vague_text' | 'easy_money';
export type RedFlagSeverity = 'low' | 'medium' | 'high';

export interface RedFlag {
  code: RedFlagCode;
  severity: RedFlagSeverity;
  /** Работодателю: что не так и как поправить. */
  reason: string;
  /** Кандидату: короткая пометка на приглашении. */
  candidateNote: string;
}

export interface TextCheckInput {
  /** Все тексты, которые увидит кандидат: заголовок, описание, команда, сообщение приглашения. */
  texts: readonly (string | null | undefined)[];
  /** ₽ в месяц; 0 или null – не указана. */
  salaryFrom?: number | null;
  salaryTo?: number | null;
}

/** Пороги вилки, ₽ в месяц (предложение): ниже нижнего – вряд ли штатная ИТ-работа, выше верхнего – нереальное обещание. */
export const SALARY_LIMITS: SalaryLimits = { minFrom: 25_000, maxTo: 1_000_000, maxRatio: 3 };
export interface SalaryLimits {
  minFrom: number;
  maxTo: number;
  maxRatio: number;
}
/** Меньше слов – описание размытое. */
export const MIN_WORDS = 8;

const SEVERITY_WEIGHT: Record<RedFlagSeverity, number> = { low: 1, medium: 2, high: 3 };
const L = String.raw`(?<![\p{L}\d_])`;
const R = String.raw`(?![\p{L}\d_])`;

const PAYMENT = [
  /(оплат\p{L}*|внес\p{L}*|внест\p{L}*|купи\p{L}*|приобрест\p{L}*|оплачива\p{L}*\s+(?:сам|самостоятельно))\s+(?:\S+\s+){0,3}(?:обучени\p{L}*|курс\p{L}*|стажировк\p{L}*|оборудовани\p{L}*|материал\p{L}*|страховк\p{L}*|комплект\p{L}*|лицензи\p{L}*|ноутбук\p{L}*)/iu,
  /(?:вступительн\p{L}*|стартов\p{L}*|регистрационн\p{L}*|организационн\p{L}*)\s+(?:взнос|платеж|платёж|пакет)/iu,
  new RegExp(`${L}(?:залог|депозит)${R}`, 'iu'),
  /платн\p{L}*\s+(?:обучени\p{L}*|стажировк\p{L}*|курс\p{L}*)/iu,
  /за\s+свой\s+сч[её]т/iu,
];
/** Предложение с этим оборотом – компания платит сама, флаг не ставим. */
const PAYMENT_SAFE = /за\s+(?:наш|сч[её]т\s+компании|сч[её]т\s+работодателя|сч[её]т\s+нашей)|бесплатн\p{L}*|оплачиваем\p{L}*|компенсиру\p{L}*/iu;

const SELF_EMPLOYED = [
  new RegExp(`(?:только|обязательно|необходимо|требуется|нужно|нужен|нужна)\\s+(?:\\S+\\s+){0,2}(?:${L}ип${R}|самозанят\\p{L}*)`, 'iu'),
  new RegExp(`оформ\\p{L}*\\s+(?:\\S+\\s+){0,2}(?:${L}ип${R}|самозанят\\p{L}*)`, 'iu'),
  new RegExp(`(?:${L}ип${R}|самозанят\\p{L}*)\\s+(?:\\S+\\s+){0,1}обязательн\\p{L}*`, 'iu'),
];

const EASY_MONEY = [
  /доход\p{L}*\s+(?:без|от)\s+опыт\p{L}*/iu,
  /(?:лёгк|легк)\p{L}*\s+(?:заработ\p{L}*|деньги)/iu,
  /быстр\p{L}*\s+(?:заработ\p{L}*|деньги)/iu,
  /пассивн\p{L}*\s+доход/iu,
  /гарантирован\p{L}*\s+(?:доход|заработ\p{L}*)/iu,
  /без\s+вложени\p{L}*/iu,
  /без\s+опыта.{0,40}\d[\d\s]{3,}\s*(?:₽|руб|р\b)/iu,
  /\d[\d\s]*(?:тыс\p{L}*|000)\s*(?:₽|руб\p{L}*|р)?\s*(?:в|за)\s*(?:день|неделю)/iu,
];

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?\n])\s+/u).filter(Boolean);
}

/** Красные флаги текста и вилки. Пустой массив – ничего подозрительного (это не гарантия добросовестности). */
export function detectRedFlags(input: TextCheckInput, salaryLimits: SalaryLimits = SALARY_LIMITS): RedFlag[] {
  const text = input.texts
    .map((t) => (t ?? '').trim())
    .filter(Boolean)
    .join('\n');
  const flags: RedFlag[] = [];
  const from = input.salaryFrom ?? 0;
  const to = input.salaryTo ?? 0;

  if (!(from > 0) && !(to > 0)) {
    flags.push({
      code: 'no_salary',
      severity: 'high',
      reason: 'Не указана вилка зарплаты. Кандидаты не доверяют предложению без суммы.',
      candidateNote: 'Проверьте: в предложении нет вилки зарплаты.',
    });
  } else if ((from > 0 && from < salaryLimits.minFrom) || to > salaryLimits.maxTo || (from > 0 && to > from * salaryLimits.maxRatio)) {
    flags.push({
      code: 'salary_unrealistic',
      severity: 'medium',
      reason: `Вилка выглядит нереальной (ориентиры: от ${salaryLimits.minFrom} до ${salaryLimits.maxTo} ₽, «до» не больше чем в ${salaryLimits.maxRatio} раза выше «от»). Уточните суммы.`,
      candidateNote: 'Проверьте: вилка зарплаты выглядит нереалистично.',
    });
  }

  if (maskContacts(text).masked > 0) {
    flags.push({
      code: 'contacts_in_text',
      severity: 'medium',
      reason: 'В тексте почта, телефон или мессенджер. Способ связи компании указывается в профиле компании и показывается кандидату отдельно.',
      candidateNote: 'Проверьте: в тексте контакты для ухода из платформы. Общайтесь через способ связи компании.',
    });
  }

  if (sentences(text).some((s) => !PAYMENT_SAFE.test(s) && PAYMENT.some((re) => re.test(s)))) {
    flags.push({
      code: 'payment_request',
      severity: 'high',
      reason: 'В тексте похоже на просьбу оплатить обучение, оборудование, стажировку или внести взнос. Платформа не допускает предложений с оплатой от кандидата.',
      candidateNote: 'Проверьте: в тексте просят оплату. Работодатель не должен брать деньги с кандидата.',
    });
  }

  if (SELF_EMPLOYED.some((re) => re.test(text))) {
    flags.push({
      code: 'self_employed_required',
      severity: 'low',
      reason: 'Обязательное оформление ИП или самозанятости. Если это единственный вариант, скажите об этом прямо и укажите причину.',
      candidateNote: 'Проверьте: требуют оформить ИП или самозанятость.',
    });
  }

  if (EASY_MONEY.some((re) => re.test(text))) {
    flags.push({
      code: 'easy_money',
      severity: 'high',
      reason: 'Обещание лёгкого дохода или дохода без опыта. Так обычно пишут в фиктивных предложениях.',
      candidateNote: 'Проверьте: обещают доход без опыта и усилий.',
    });
  }

  const words = text.split(/\s+/u).filter((w) => /\p{L}/u.test(w)).length;
  if (words < MIN_WORDS) {
    flags.push({
      code: 'vague_text',
      severity: 'low',
      reason: `Описание размытое: меньше ${MIN_WORDS} слов. Назовите задачи, стек и команду.`,
      candidateNote: 'Проверьте: в предложении почти нет конкретики о задачах.',
    });
  }
  return flags;
}

/** Суммарная оценка: none – чисто, warn – присмотреться, high – есть серьёзный флаг или сумма от 3. */
export function riskLevel(flags: readonly RedFlag[]): 'none' | 'warn' | 'high' {
  const score = flags.reduce((s, f) => s + SEVERITY_WEIGHT[f.severity], 0);
  if (flags.some((f) => f.severity === 'high') || score >= 3) return 'high';
  return score > 0 ? 'warn' : 'none';
}

// --- Индекс доверия компании (концепция) ---

export interface CompanyTrustInput {
  name: string;
  description: string | null;
  industry: string | null;
  /** Контрольная сумма ИНН сходится (checkInn); реестры ФНС не проверяются – демо-метка. */
  innValid: boolean;
  contact: string | null;
  createdAt: Date;
  invitationsSent: number;
  invitationsDeclined: number;
  /** Жалобы кандидатов за COMPLAINT_WINDOW_DAYS, кроме отклонённых (dismissed). Нет данных – 0. */
  complaints?: number;
  /** Неявки работодателя на назначенные живые защиты за NO_SHOW_WINDOW_DAYS (опоздание > 15 минут). Нет данных - 0. */
  noShows?: number;
  now?: Date;
}

export interface TrustSignal {
  code: 'profile' | 'inn' | 'age' | 'declines' | 'complaints' | 'no_shows';
  label: string;
  /** Вклад в индекс, 0..points; у штрафов complaints и no_shows - отрицательный при points = 0. */
  earned: number;
  points: number;
}

export interface CompanyTrust {
  /** 0..100. КОНЦЕПЦИЯ: веса не калибровались, реальных обманщиков в данных нет. */
  index: number;
  band: 'low' | 'medium' | 'high';
  signals: TrustSignal[];
  concept: true;
}

// --- Жалобы кандидатов и санкции (R-X-01, доп. функционал) ---
// ПРЕДЛОЖЕНИЕ агента, не калибровано: реальных жалоб в данных нет. Модерации и апелляции нет (R-D-05),
// поэтому считаются все жалобы, кроме вручную отклонённых (status = dismissed).

/** Окно подсчёта жалоб, дней. */
export const COMPLAINT_WINDOW_DAYS = 30;
/** Пороги санкций. ПРЕДЛОЖЕНИЕ агента, не калибровано. */
export const COMPLAINT_SANCTIONS: ComplaintSanctions = { reducedAt: 3, reducedLimit: 5, blockedAt: 5 };
export interface ComplaintSanctions {
  reducedAt: number;
  reducedLimit: number;
  blockedAt: number;
}
/** Штраф индексу доверия за жалобу. ПРЕДЛОЖЕНИЕ агента, не калибровано. */
export const COMPLAINT_TRUST_PENALTY: ComplaintTrustPenalty = { perComplaint: 10, max: 40 };
export interface ComplaintTrustPenalty {
  perComplaint: number;
  max: number;
}

/** Окно подсчёта неявок работодателя, дней. */
export const NO_SHOW_WINDOW_DAYS = 30;
/** Штраф индексу доверия за неявку работодателя на назначенную защиту. ПРЕДЛОЖЕНИЕ агента, не калибровано. */
export const NO_SHOW_TRUST_PENALTY: NoShowTrustPenalty = { perNoShow: 15, max: 30 };
export interface NoShowTrustPenalty {
  perNoShow: number;
  max: number;
}

export interface InvitationSanction {
  /** none – обычный лимит; reduced – сниженный суточный лимит; blocked – отправка закрыта. */
  level: 'none' | 'reduced' | 'blocked';
  complaints: number;
  /** Действующий лимит приглашений за сутки (0 при блоке). */
  limit: number;
}

/** Санкция по числу жалоб за окно: ≥ reducedAt – лимит не больше reducedLimit, ≥ blockedAt – блок отправки. */
export function invitationSanction(complaints: number, baseLimit: number, sanctions: ComplaintSanctions = COMPLAINT_SANCTIONS): InvitationSanction {
  if (complaints >= sanctions.blockedAt) return { level: 'blocked', complaints, limit: 0 };
  if (complaints >= sanctions.reducedAt) return { level: 'reduced', complaints, limit: Math.min(baseLimit, sanctions.reducedLimit) };
  return { level: 'none', complaints, limit: baseLimit };
}

/** Начало окна подсчёта жалоб. */
export function complaintWindowStart(now = new Date(), windowDays = COMPLAINT_WINDOW_DAYS): Date {
  return new Date(now.getTime() - windowDays * DAY_MS);
}

/** Мало приглашений – долю отклонений не считаем: на малой выборке она случайна. */
export const TRUST_MIN_INVITATIONS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TrustWeights {
  profile: number;
  inn: number;
  age: number;
  declines: number;
}
/** Максимум баллов по сигналам индекса доверия (сумма 100). Настройка employer.trustWeights перекрывает. */
export const TRUST_WEIGHTS: TrustWeights = { profile: 35, inn: 25, age: 15, declines: 25 };

/** Параметры индекса доверия из настроек платформы; не заданное – умолчания из кода. */
export interface TrustConfig {
  weights?: TrustWeights;
  complaintPenalty?: ComplaintTrustPenalty;
  noShowPenalty?: NoShowTrustPenalty;
  complaintWindowDays?: number;
}

/**
 * Индекс доверия из уже имеющихся данных: заполненность профиля (35), ИНН с верной контрольной цифрой (25),
 * возраст аккаунта (15, полные баллы с 30 дней), доля отклонённых приглашений (25; без данных – половина),
 * минус штраф за жалобы кандидатов за 30 дней (COMPLAINT_TRUST_PENALTY) и за неявки на назначенные защиты
 * за 30 дней (NO_SHOW_TRUST_PENALTY: 15 за неявку, не больше 30), не ниже 0.
 */
export function companyTrust(c: CompanyTrustInput, cfg: TrustConfig = {}): CompanyTrust {
  const w = cfg.weights ?? TRUST_WEIGHTS;
  const complaintPenalty = cfg.complaintPenalty ?? COMPLAINT_TRUST_PENALTY;
  const noShowPenalty = cfg.noShowPenalty ?? NO_SHOW_TRUST_PENALTY;
  const windowDays = cfg.complaintWindowDays ?? COMPLAINT_WINDOW_DAYS;
  const filled = [c.name.trim().length >= 2, !!c.description?.trim(), !!c.industry?.trim(), !!c.contact?.trim()].filter(Boolean).length;
  const ageDays = Math.max(0, ((c.now ?? new Date()).getTime() - c.createdAt.getTime()) / DAY_MS);
  const declineShare = c.invitationsSent >= TRUST_MIN_INVITATIONS ? c.invitationsDeclined / c.invitationsSent : null;
  const signals: TrustSignal[] = [
    { code: 'profile', label: 'Профиль компании заполнен', earned: Math.round((filled / 4) * w.profile), points: w.profile },
    { code: 'inn', label: 'ИНН указан и проходит проверку контрольной цифры (демо, реестр не сверяется)', earned: c.innValid ? w.inn : 0, points: w.inn },
    { code: 'age', label: 'Возраст аккаунта', earned: Math.round(Math.min(1, ageDays / 30) * w.age), points: w.age },
    {
      code: 'declines',
      label: 'Доля отклонённых приглашений',
      earned: declineShare === null ? Math.floor(w.declines / 2) : Math.round((1 - Math.min(1, declineShare)) * w.declines),
      points: w.declines,
    },
  ];
  const complaints = Math.max(0, c.complaints ?? 0);
  if (complaints > 0) {
    signals.push({
      code: 'complaints',
      label: `Жалобы кандидатов за ${windowDays} дней: ${complaints}`,
      earned: -Math.min(complaintPenalty.max, complaints * complaintPenalty.perComplaint),
      points: 0,
    });
  }
  const noShows = Math.max(0, c.noShows ?? 0);
  if (noShows > 0) {
    signals.push({
      code: 'no_shows',
      label: `Неявки на назначенные защиты за ${NO_SHOW_WINDOW_DAYS} дней: ${noShows}`,
      earned: -Math.min(noShowPenalty.max, noShows * noShowPenalty.perNoShow),
      points: 0,
    });
  }
  const index = Math.max(0, signals.reduce((s, x) => s + x.earned, 0));
  return { index, band: index >= 70 ? 'high' : index >= 40 ? 'medium' : 'low', signals, concept: true };
}
