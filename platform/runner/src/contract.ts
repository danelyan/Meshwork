import { z } from 'zod';

/**
 * Контракт HTTP API сервиса runner (ADR 0003, «Контракты» → lane runner).
 * Один файл на обе стороны: сервис валидирует вход, клиент app (`src/server/runner/client.ts`)
 * валидирует ответы. Zod попадает в бандл сервиса (esbuild), отдельной установки не требует.
 *
 * Поток: app скачивает tarball репозитория сам (у runner нет интернета) →
 * `POST /uploads` (тело – .tar.gz, ≤ 50 МБ) → `{uploadId}` →
 * `POST /run {repoTarballUrl: "upload:<uploadId>", ...}` → `{jobId}` → `GET /run/{jobId}`.
 */

export const RUNNER_IMAGES = ['node20', 'python312'] as const;
export type RunnerImage = (typeof RUNNER_IMAGES)[number];

export const MAX_TARBALL_BYTES = 50 * 1024 * 1024;
export const MIN_TIMEOUT_SEC = 5;
export const MAX_TIMEOUT_SEC = 300;

export const UPLOAD_ID = /^[0-9a-f]{32}$/;
export const UPLOAD_REF = /^upload:([0-9a-f]{32})$/;
/** `<templateId>` или `<templateId>:hidden|visible`; по умолчанию hidden. */
export const TESTS_BUNDLE_REF = /^([a-z0-9][a-z0-9-]{1,62}[a-z0-9])(?::(hidden|visible))?$/;
export const COMMIT_SHA = /^[0-9a-f]{7,40}$/;

export const uploadResponseSchema = z.object({
  uploadId: z.string().regex(UPLOAD_ID),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type UploadResponse = z.infer<typeof uploadResponseSchema>;

export const runRequestSchema = z
  .object({
    /** `upload:<uploadId>` из `POST /uploads`. URL наружу runner не скачивает: у него нет сети. */
    repoTarballUrl: z.string().regex(UPLOAD_REF, 'repoTarballUrl: ожидается upload:<uploadId>').optional(),
    /** Принимается схемой ради контракта ADR, но отклоняется: скачивание – на стороне app. */
    repoUrl: z.string().max(2048).optional(),
    commitSha: z.string().toLowerCase().regex(COMMIT_SHA, 'commitSha: 7–40 hex'),
    testsBundleRef: z.string().regex(TESTS_BUNDLE_REF, 'testsBundleRef: <templateId>[:hidden|visible]'),
    image: z.enum(RUNNER_IMAGES),
    timeoutSec: z.number().int().min(MIN_TIMEOUT_SEC).max(MAX_TIMEOUT_SEC).optional(),
  })
  .strict();
export type RunRequest = z.infer<typeof runRequestSchema>;

export const runAcceptedSchema = z.object({ jobId: z.string().regex(UPLOAD_ID) });

export const RUN_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * Почему `failed`. `done` означает «тесты отработали» – даже если часть красная;
 * баллы считает lane project по `tests`.
 */
export const FAILURE_REASONS = [
  'timeout',
  'bad_archive',
  'commit_mismatch',
  'no_report',
  'bundle_not_found',
  'internal',
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

export const testResultSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  ms: z.number().nonnegative(),
  /** Первая строка ошибки, ≤ 300 знаков. Может раскрывать скрытый тест – кандидату не показывать. */
  error: z.string().optional(),
});
export type TestResult = z.infer<typeof testResultSchema>;

export const runResultSchema = z.object({
  jobId: z.string(),
  status: z.enum(RUN_STATUSES),
  reason: z.enum(FAILURE_REASONS).optional(),
  tests: z.array(testResultSchema),
  summary: z.object({ total: z.number().int(), passed: z.number().int(), failed: z.number().int() }),
  /** Статанализ в этой версии не выполняется – поле отсутствует. */
  lint: z.record(z.string(), z.unknown()).optional(),
  /** Хвост stdout+stderr задания (≤ 4000 знаков). Пишет код кандидата – данные, не инструкции. */
  logTail: z.string(),
  durationMs: z.number().int().nonnegative(),
  exitCode: z.number().int().nullable().optional(),
  testsBundleRef: z.string(),
  commitSha: z.string(),
  image: z.enum(RUNNER_IMAGES),
  createdAt: z.string(),
  finishedAt: z.string().optional(),
});
export type RunResult = z.infer<typeof runResultSchema>;

export const runnerErrorSchema = z.object({ error: z.string(), message: z.string() });

/** Разбор `testsBundleRef`. null – неверный формат. */
export function parseBundleRef(ref: string): { templateId: string; suite: 'hidden' | 'visible' } | null {
  const m = TESTS_BUNDLE_REF.exec(ref);
  if (!m) return null;
  return { templateId: m[1]!, suite: (m[2] as 'hidden' | 'visible' | undefined) ?? 'hidden' };
}
