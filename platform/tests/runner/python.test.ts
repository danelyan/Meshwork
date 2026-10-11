import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../runner/src/config';
import { JobManager } from '../../runner/src/jobs';
import { createRunnerServer } from '../../runner/src/server';
import { getRun, submitRun } from '@/server/runner/client';

import { dirEntries, makeTarGz } from '../helpers/tar';

/**
 * Образ python312 в локальном режиме: нужен venv с runner/sandbox/python/requirements.txt
 * (`python3 -m venv runner/sandbox/python/.venv && runner/sandbox/python/.venv/bin/pip install -r …`).
 * Без него тест пропускается. Шаблон – тестовый, из tests/fixtures/runner/templates.
 */
const PY = path.resolve('runner/sandbox/python/.venv/bin/python');
const FIXTURES = path.resolve('tests/fixtures/runner');
const token = 'p'.repeat(40);
let work: string;
let base: string;
let close: () => Promise<void>;

describe.skipIf(!existsSync(PY))('runner service: python312 (local)', () => {
  beforeAll(async () => {
    work = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'fsp-runner-py-')));
    const cfg = loadConfig({
      RUNNER_LOCAL: '1',
      RUNNER_TOKEN: token,
      RUNNER_WORK_DIR: work,
      RUNNER_PYTHON: PY,
      RUNNER_TEMPLATES_DIR: path.join(FIXTURES, 'templates'),
    });
    const jobs = new JobManager(cfg);
    await jobs.init();
    const server = createRunnerServer(cfg, jobs);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((r) => server.close(() => r()));
  });

  afterAll(async () => {
    await close?.();
    rmSync(work, { recursive: true, force: true });
  });

  it('pytest + FastAPI TestClient → junit-отчёт разобран', async () => {
    const deps = { baseUrl: base, token };
    const { jobId } = await submitRun(
      {
        source: { kind: 'tarball', data: makeTarGz(dirEntries(path.join(FIXTURES, 'python-solution'))) },
        commitSha: 'abc1234',
        testsBundleRef: 'python-smoke-api',
        image: 'python312',
      },
      deps,
    );
    let r = await getRun(jobId, deps);
    while (r.status === 'queued' || r.status === 'running') {
      await new Promise((res) => setTimeout(res, 200));
      r = await getRun(jobId, deps);
    }
    expect(r.status, r.logTail).toBe('done');
    expect(r.tests.map((t) => [t.name, t.passed])).toEqual([
      ['test_health::test_health', true],
      ['test_health::test_unknown_is_404', true],
    ]);
  });
});
