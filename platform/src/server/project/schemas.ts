// Контракты модуля project (ADR 0003, ступень 2; «Дополнение 10.10» — лента заданий).
import { z } from 'zod';

/** Сколько взятых и ещё не сданных заданий может держать кандидат одновременно (ADR 0003, п. 6). */
export const PROJECT_MAX_ACTIVE = 3;
/** Срок по умолчанию: после него взятое, но не сданное задание не держит слот. */
export const DEFAULT_DEADLINE_DAYS = 7;
/** Сабмитов одного кандидата на одно задание (повторная сдача после исправлений). */
export const MAX_SUBMISSIONS_PER_TASK = 5;
export const MAX_REQUIRED_CRITERIA = 8;
export const MAX_WISH_CRITERIA = 6;
export const AI_LOG_MAX = 20_000;

export const SpecJson = z.object({
  title: z.string().min(3).max(160),
  /** Легенда в домене работодателя (без названия компании и зарплаты). */
  domainStory: z.string().min(10).max(2000),
  /** Требования: контракт шаблона в терминах домена + пожелания. */
  requirements: z.array(z.string().min(3).max(400)).min(1).max(15),
  /** Как проверяется: автотесты контракта + критерии работодателя. */
  acceptance: z.array(z.string().min(3).max(400)).min(1).max(12),
  notes: z.string().max(1500),
});
export type SpecJson = z.infer<typeof SpecJson>;

export interface StoredSpec extends SpecJson {
  /** contract.md шаблона дословно на момент генерации: модель контракт не пересказывает. */
  contractMd: string;
  /** llm — легенда и требования от модели; fallback — детерминированная сборка (stub или сбой модели). */
  source: 'llm' | 'fallback';
}

/**
 * Что пишет модель (project_spec): только легенду в домене работодателя и требования ПОВЕРХ контракта
 * (критерии и пожелания работодателя). Заголовок, «как проверяется», заметки и сам контракт собирает код.
 */
export const SpecLlmOut = z.object({
  domainStory: z.string().min(10).max(2000),
  requirements: z.array(z.string().min(3).max(400)).max(12),
});
export type SpecLlmOut = z.infer<typeof SpecLlmOut>;

export const RubricCriterion = z.object({
  id: z.string().min(1).max(80),
  text: z.string().min(3).max(300),
  catalogId: z.string().max(64).optional(),
  source: z.enum(['required', 'wish']),
});
export type RubricCriterion = z.infer<typeof RubricCriterion>;
export const RubricJson = z.object({ criteria: z.array(RubricCriterion).max(MAX_REQUIRED_CRITERIA + MAX_WISH_CRITERIA) });
export type RubricJson = z.infer<typeof RubricJson>;

/** Ответ модели при генерации критериев из пожеланий (project_rubric, режим «составить»). */
export const WishCriteriaOut = z.object({ criteria: z.array(z.string().min(3).max(300)).max(MAX_WISH_CRITERIA) });

/** Ответ модели при проверке (project_rubric, режим «оценить»). */
export const RubricVerdictOut = z.object({
  results: z
    .array(
      z.object({
        id: z.string(),
        passed: z.boolean(),
        evidence: z.string().max(600),
        file: z.string().max(300).nullable().optional(),
      }),
    )
    .max(MAX_REQUIRED_CRITERIA + MAX_WISH_CRITERIA),
});

export type RubricFlag = 'evidence_unverified' | 'no_evidence' | 'possible_prompt_injection' | 'not_evaluated';

export interface RubricResult {
  id: string;
  text: string;
  source: 'required' | 'wish';
  catalogId?: string;
  passed: boolean | null;
  evidence: string;
  file?: string | null;
  flag?: RubricFlag;
}

export interface TestOutcome {
  name: string;
  passed: boolean;
}

export interface ResultJson {
  /** approach — сдача подходом: автотестов нет (tests 0/0), оценка только рубрикой. Нет поля — код. */
  kind?: 'code' | 'approach';
  tests: { passed: number; total: number; score: number };
  /** Видимые тесты — кандидату можно показать имена и статус. */
  visibleTests: TestOutcome[];
  /** Скрытые тесты — только работодателю (имена раскрывают набор). */
  hiddenTests: TestOutcome[];
  lint: { status: 'skipped' | 'done'; note: string; details?: unknown };
  rubric: { source: 'llm' | 'fallback'; results: RubricResult[]; injectionSuspected: boolean };
  platformOwnedViolations: { path: string; reason: 'modified' | 'missing' }[];
  runner: { mode: 'stub' | 'runner'; durationMs?: number };
}

// --- входы API ---

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const ProjectTaskInput = z.object({
  /** Не задан — первый шаблон под направление/грейд/подкатегорию потребности. */
  templateId: z.string().min(3).max(64).optional(),
  subcategoryId: z.string().max(64).optional(),
  requiredCatalogIds: z.array(z.string().min(1).max(64)).max(MAX_REQUIRED_CRITERIA).default([]),
  wishesText: optText(2000),
  visibility: z.enum(['open', 'invited']).default('open'),
  deadlineDays: z.number().int().min(1).max(30).nullish(),
});
export type ProjectTaskInput = z.infer<typeof ProjectTaskInput>;

export const APPROACH_MIN = 200;
export const APPROACH_MAX = 8_000;

/**
 * Сдача: кодом (`kind: 'code'`, по умолчанию — репозиторий GitHub, автотесты и рубрика) или подходом
 * (`kind: 'approach'` — текст решения без кода; оценивается только рубрикой, ТЗ: «решить её или предложить подход»).
 */
export const SubmissionInput = z
  .object({
    kind: z.enum(['code', 'approach']).default('code'),
    repoUrl: z.string().trim().min(10).max(300).optional(),
    approachText: z.string().trim().max(APPROACH_MAX).optional(),
    aiLogText: z.string().trim().max(AI_LOG_MAX).default(''),
    /** Не задан — последний коммит ветки по умолчанию на момент сдачи. */
    commitSha: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[0-9a-f]{7,40}$/, 'commitSha: 7–40 hex')
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'code' && !v.repoUrl) ctx.addIssue({ code: 'custom', path: ['repoUrl'], message: 'Нужна ссылка на репозиторий GitHub' });
    if (v.kind === 'approach' && (v.approachText ?? '').length < APPROACH_MIN) {
      ctx.addIssue({ code: 'custom', path: ['approachText'], message: `Опиши подход хотя бы в ${APPROACH_MIN} символах: что сделаешь, в каком порядке, какие ограничения учтёшь` });
    }
  });
export type SubmissionInput = z.infer<typeof SubmissionInput>;

export const InviteToDefenseInput = z
  .object({
    message: z.string().trim().min(10, 'Опиши задачу хотя бы в 10 символах').max(2000),
    salaryFrom: z.number().int().min(1).max(10_000_000),
    salaryTo: z.number().int().min(1).max(10_000_000),
  })
  .refine((v) => v.salaryTo >= v.salaryFrom, { error: 'Зарплата «до» меньше «от»', path: ['salaryTo'] });
export type InviteToDefenseInput = z.infer<typeof InviteToDefenseInput>;
