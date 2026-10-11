import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Лимит сдач и проверка сабмита (аудит 11.10): сбой сервиса проверки (503 от runner) в лимит не идёт,
// сбой прогона видимых тестов пишется в лог. Без БД: prisma подменён, runner – тестовый.
const db = vi.hoisted(() => ({ projectSubmission: { findUnique: vi.fn(), update: vi.fn() } }));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/consent/service', async (orig) => ({ ...(await orig<typeof import('@/server/consent/service')>()), hasAiAssessmentConsent: vi.fn(async () => false) }));

import { AppError } from '@/server/errors';
import { setProjectRunner, type ProjectRunner, type RunOutcome } from '@/server/project/runner-client';
import { MAX_SUBMISSIONS_PER_TASK } from '@/server/project/schemas';
import { countedSubmissions, MAX_SUBMISSION_ROWS_PER_TASK, processSubmission, RUNNER_UNAVAILABLE_ERROR } from '@/server/project/service';
import { getTemplates } from '@/server/project/templates';

const HIDDEN_OK: RunOutcome = { status: 'done', tests: [{ name: 'h1', passed: true }], passed: 1, total: 1, durationMs: 5 };

const submission = (id: string) => ({
  id,
  status: 'submitted',
  runnerJobId: null,
  commitSha: 'a'.repeat(40),
  repoUrl: 'https://github.com/someone/solution',
  candidateId: 'c1',
  aiLogText: null,
  projectTask: { templateId: getTemplates()[0]!.manifest.id, rubricJson: { criteria: [] } },
});

function useRunner(run: ProjectRunner['run']): void {
  setProjectRunner({ mode: 'stub', run, resume: vi.fn() });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.projectSubmission.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => submission(where.id));
});
afterEach(() => {
  setProjectRunner(null);
  vi.restoreAllMocks();
});

describe('лимит сдач: сбой сервиса проверки не засчитывается', () => {
  it('countedSubmissions: failed из-за недоступного сервиса проверки не в счёт, остальные сдачи – в счёт', () => {
    const rows = [
      { status: 'checked' as const, error: null },
      { status: 'failed' as const, error: RUNNER_UNAVAILABLE_ERROR },
      { status: 'failed' as const, error: RUNNER_UNAVAILABLE_ERROR },
      { status: 'failed' as const, error: 'Проверка не уложилась в лимит времени (зацикливание или слишком долгие тесты).' },
      { status: 'failed' as const, error: null },
    ];
    expect(countedSubmissions(rows)).toBe(3);
    // Общий потолок строк остаётся: незасчитанные сдачи не идут без конца.
    expect(MAX_SUBMISSION_ROWS_PER_TASK).toBeGreaterThan(MAX_SUBMISSIONS_PER_TASK);
  });

  it('503 от runner сохраняется как RUNNER_UNAVAILABLE_ERROR – по нему сдача и исключается из лимита', async () => {
    useRunner(async () => {
      throw new AppError('runner_unavailable', 'runner down', 503);
    });
    await processSubmission('sub-503');
    expect(db.projectSubmission.update).toHaveBeenLastCalledWith({ where: { id: 'sub-503' }, data: expect.objectContaining({ status: 'failed', error: RUNNER_UNAVAILABLE_ERROR }) });
    expect(countedSubmissions([{ status: 'failed', error: RUNNER_UNAVAILABLE_ERROR }])).toBe(0);
  });

  it('другой сбой runner – другая причина, сдача засчитывается', async () => {
    useRunner(async () => {
      throw new AppError('bad_request', 'bad archive', 400);
    });
    await processSubmission('sub-400');
    const data = db.projectSubmission.update.mock.calls.at(-1)![0].data as { status: string; error: string };
    expect(data.status).toBe('failed');
    expect(data.error).not.toBe(RUNNER_UNAVAILABLE_ERROR);
    expect(countedSubmissions([{ status: 'failed', error: data.error }])).toBe(1);
  });
});

describe('processSubmission: сбой прогона видимых тестов', () => {
  it('сдача проверена по скрытым тестам, сбой видимых записан в лог', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    useRunner(async (input) => {
      if (input.suite === 'visible') throw new Error('visible suite crashed');
      return HIDDEN_OK;
    });
    await processSubmission('sub-visible');
    expect(warn).toHaveBeenCalledWith('[project] visible tests run failed', 'sub-visible', 'visible suite crashed');
    const data = db.projectSubmission.update.mock.calls.at(-1)![0].data as { status: string; resultJson: { visibleTests: unknown[]; tests: { score: number }; lint: { status: string } } };
    expect(data.status).toBe('checked');
    expect(data.resultJson.visibleTests).toEqual([]);
    expect(data.resultJson.tests.score).toBe(100);
    expect(data.resultJson.lint.status).toBe('skipped');
  });
});
