// Вызов runner из lane project: обёртка над клиентом лейна runner (server/runner/client.ts — submitRun,
// getRun; контракт runner/src/contract.ts). Без RUNNER_URL/RUNNER_TOKEN — stub-режим: детерминированный
// результат по имени шаблона и маркерам в адресе репозитория, без сети (тесты, демо без песочницы).
import { createHash } from 'node:crypto';

import { getEnv } from '../env';
import { AppError } from '../errors';
import { getRun, submitRun, type RunResult } from '../runner/client';

import { countTests, visibleTestNames, type LoadedTemplate } from './templates';

export interface RunOutcome {
  status: 'done' | 'failed';
  /** Причина failed по контракту runner (timeout, bad_archive, commit_mismatch, …). */
  reason?: string;
  tests: { name: string; passed: boolean }[];
  passed: number;
  total: number;
  durationMs?: number;
  lint?: Record<string, unknown>;
}

export interface RunInput {
  template: LoadedTemplate;
  suite: 'hidden' | 'visible';
  /** .tar.gz репозитория (уже скачан приложением); null только в stub-режиме. */
  tarball: Uint8Array | null;
  repoUrl: string;
  commitSha: string;
  /** Сохранить jobId, чтобы после рестарта дождаться того же задания, а не ставить новое. */
  onJob?: (jobId: string) => Promise<void> | void;
}

export interface ProjectRunner {
  readonly mode: 'stub' | 'runner';
  run(input: RunInput): Promise<RunOutcome>;
  /** Дождаться уже поставленного задания (рестарт приложения посреди проверки). */
  resume(jobId: string): Promise<RunOutcome>;
}

const POLL_MS = 2_000;
/** runner держит одно задание за раз — ждём с запасом на очередь. */
const WAIT_MS = 10 * 60_000;

function fromRunResult(r: RunResult): RunOutcome {
  return {
    status: r.status === 'done' ? 'done' : 'failed',
    reason: r.reason,
    tests: r.tests.map((t) => ({ name: t.name, passed: t.passed })),
    passed: r.summary.passed,
    total: r.summary.total,
    durationMs: r.durationMs,
    lint: r.lint,
  };
}

async function waitFor(jobId: string, sleep: (ms: number) => Promise<void>): Promise<RunOutcome> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const r = await getRun(jobId);
    if (r.status === 'done' || r.status === 'failed') return fromRunResult(r);
    if (Date.now() > deadline) throw new AppError('runner_timeout', 'Проверка не завершилась за 10 минут', 504);
    await sleep(POLL_MS);
  }
}

export function createHttpRunner(sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): ProjectRunner {
  return {
    mode: 'runner',
    async run(input) {
      if (!input.tarball) throw new AppError('bad_request', 'Нет архива репозитория для проверки', 400);
      const { manifest } = input.template;
      const { jobId } = await submitRun({
        source: { kind: 'tarball', data: new Uint8Array(input.tarball) },
        commitSha: input.commitSha,
        testsBundleRef: input.suite === 'visible' ? `${manifest.id}:visible` : manifest.id,
        image: manifest.image,
        timeoutSec: manifest.timeLimitSec,
      });
      await input.onJob?.(jobId);
      return waitFor(jobId, sleep);
    },
    resume: (jobId) => waitFor(jobId, sleep),
  };
}

function hashInt(s: string): number {
  return createHash('sha256').update(s).digest().readUInt32BE(0);
}

/**
 * Stub: сколько тестов в наборе шаблона, столько и в отчёте. Адрес с `reference`/`solved` — всё зелёное,
 * с `starter`/`empty` — всё красное, `runner-fail` — failed(timeout); иначе не проходит 0–2 теста
 * (по хешу id шаблона — одно и то же для одного шаблона).
 */
export function createStubRunner(): ProjectRunner {
  return {
    mode: 'stub',
    async run({ template, suite, repoUrl }) {
      if (/runner-fail/i.test(repoUrl)) return { status: 'failed', reason: 'timeout', tests: [], passed: 0, total: 0 };
      const names = suite === 'visible' ? visibleTestNames(template) : Array.from({ length: countTests(template, 'hidden') }, (_, i) => `скрытый тест #${i + 1}`);
      const total = names.length;
      let failing: number;
      if (/reference|solved/i.test(repoUrl)) failing = 0;
      else if (/starter|empty/i.test(repoUrl)) failing = total;
      else failing = suite === 'visible' ? 0 : hashInt(template.manifest.id) % Math.min(3, Math.max(1, total));
      const tests = names.map((name, i) => ({ name, passed: i < total - failing }));
      return { status: 'done', tests, passed: total - failing, total, durationMs: 0 };
    },
    async resume() {
      throw new AppError('not_found', 'В stub-режиме заданий runner нет', 404);
    },
  };
}

let override: ProjectRunner | null = null;

/** Только для тестов. */
export function setProjectRunner(r: ProjectRunner | null): void {
  override = r;
}

export function getProjectRunner(): ProjectRunner {
  if (override) return override;
  const env = getEnv();
  return env.RUNNER_URL && env.RUNNER_TOKEN ? createHttpRunner() : createStubRunner();
}
