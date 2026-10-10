import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../runner/src/config';
import { JobManager } from '../../runner/src/jobs';
import { createRunnerServer } from '../../runner/src/server';
import { getRun, submitRun, type RunResult } from '@/server/runner/client';

import { dirEntries, makeTarGz, paxRecord, type TarSpec } from '../helpers/tar';

/**
 * Интеграция runner в локальном режиме (RUNNER_LOCAL=1, без Docker): настоящий HTTP-сервис,
 * настоящий vitest из runner/sandbox/node, лимиты процесса. На macOS сеть и запись режет
 * sandbox-exec — проверки сети и записи идут только там (на Linux их даёт контейнер).
 * Нужен `npm ci` в runner/sandbox/node. Запуск: npm run test:runner.
 */

const FIXTURES = path.resolve('tests/fixtures/runner');
const token = 'r'.repeat(40);
const isMac = process.platform === 'darwin';
let work: string;
let base: string;
let close: () => Promise<void>;

beforeAll(async () => {
  work = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'fsp-runner-it-')));
  const cfg = loadConfig({ RUNNER_LOCAL: '1', RUNNER_TOKEN: token, RUNNER_WORK_DIR: work });
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

async function runTarball(entries: TarSpec[], opts: { bundle?: string; commitSha?: string; timeoutSec?: number } = {}): Promise<RunResult> {
  const deps = { baseUrl: base, token };
  const { jobId } = await submitRun(
    {
      source: { kind: 'tarball', data: makeTarGz(entries) },
      commitSha: opts.commitSha ?? 'abc1234',
      testsBundleRef: opts.bundle ?? 'be-webapi-junior-notes',
      image: 'node20',
      ...(opts.timeoutSec ? { timeoutSec: opts.timeoutSec } : {}),
    },
    deps,
  );
  for (;;) {
    const r = await getRun(jobId, deps);
    if (r.status === 'done' || r.status === 'failed') return r;
    await new Promise((res) => setTimeout(res, 200));
  }
}

const backendWith = (appJs: string, extra: TarSpec[] = []) =>
  dirEntries(path.join(FIXTURES, 'backend-solution'), 'cand-notes-abc1234', extra).map((e) =>
    e.path.endsWith('/src/app.js') ? { ...e, data: appJs } : e,
  );

describe('runner service (local)', () => {
  it('без токена — 401, /health открыт', async () => {
    expect((await fetch(`${base}/run/${'a'.repeat(32)}`)).status).toBe(401);
    const health = await (await fetch(`${base}/health`)).json();
    expect(health).toMatchObject({ ok: true, mode: 'local', configured: true });
  });

  it('1. верное решение backend → все скрытые тесты зелёные', async () => {
    const r = await runTarball(dirEntries(path.join(FIXTURES, 'backend-solution')));
    expect(r.status).toBe('done');
    expect(r.summary.total).toBe(13);
    expect(r.summary.failed).toBe(0);
  });

  it('верное решение frontend (jsdom + Testing Library) → зелёные', async () => {
    const r = await runTarball(dirEntries(path.join(FIXTURES, 'frontend-solution')), { bundle: 'fe-uiapp-junior-widget' });
    expect(r.status).toBe('done');
    expect(r.summary).toEqual({ total: 9, passed: 9, failed: 0 });
  });

  it('видимый набор по ссылке :visible', async () => {
    const r = await runTarball(dirEntries(path.join(FIXTURES, 'backend-solution')), { bundle: 'be-webapi-junior-notes:visible' });
    expect(r.status).toBe('done');
    expect(r.summary).toEqual({ total: 3, passed: 3, failed: 0 });
  });

  it('2. while(true) → timeout, задание остановлено вовремя', async () => {
    const started = Date.now();
    const r = await runTarball(backendWith('while (true) {}\nexport function createApp() {}\n'), { timeoutSec: 5 });
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it.runIf(isMac)('3. fetch наружу из кода кандидата → ошибка сети, тесты при этом идут', async () => {
    const app = `
import { createApp as real } from './real.js';
let net = 'unknown';
try {
  await fetch('https://example.com', { signal: AbortSignal.timeout(4000) });
  net = 'OPEN';
} catch (e) {
  net = 'blocked:' + (e.cause?.code ?? e.name);
}
console.log('NETCHECK ' + net);
export const createApp = real;
`;
    const real = dirEntries(path.join(FIXTURES, 'backend-solution'), 'cand-notes-abc1234').find((e) => e.path.endsWith('/src/app.js'))!;
    const r = await runTarball(backendWith(app, [{ path: 'src/real.js', data: real.data }]));
    expect(r.status).toBe('done');
    expect(r.summary.failed).toBe(0);
    expect(r.logTail).toMatch(/NETCHECK blocked:/);
    expect(r.logTail).not.toMatch(/NETCHECK OPEN/);
  });

  it('4. подмена тестов в репозитории не влияет: свой .platform-tests, свой vitest.config, правка видимых', async () => {
    const real = dirEntries(path.join(FIXTURES, 'backend-solution'), 'cand-notes-abc1234').find((e) => e.path.endsWith('/src/app.js'))!;
    const fakes: TarSpec[] = [
      { path: '.platform-tests/notes.hidden.test.js', data: "import {it} from 'vitest'; it('fake green', () => {});" },
      { path: '.platform-tests/extra.test.js', data: "import {it} from 'vitest'; it('extra fake', () => {});" },
      { path: 'vitest.config.js', data: "export default { test: { include: ['**/*.test.js'] } };" },
      { path: 'tests/visible/notes.test.js', data: "import {it} from 'vitest'; it('visible fake', () => {});" },
    ];
    // Заглушка: тесты платформы должны остаться красными, подделки — не запуститься.
    const stub = "export function createApp() { return (req, res) => { res.writeHead(501); res.end('{}'); }; }\n";
    const red = await runTarball(backendWith(stub, fakes));
    expect(red.status).toBe('done');
    expect(red.summary).toEqual({ total: 13, passed: 0, failed: 13 });
    expect(red.tests.map((t) => t.name).join('|')).not.toMatch(/fake/);

    // Верное решение, которое во время прогона пытается переписать тест платформы.
    const tamper = `
import fs from 'node:fs';
import path from 'node:path';
import { createApp as real } from './real.js';
try {
  fs.writeFileSync(path.join(process.env.FSP_REPO_DIR ?? '.', '.platform-tests/notes.hidden.test.js'), "import {it} from 'vitest'; it('ok', () => {});");
  console.log('TAMPER written');
} catch (e) { console.log('TAMPER denied ' + e.code); }
export const createApp = real;
`;
    const green = await runTarball(backendWith(tamper, [...fakes, { path: 'src/real.js', data: real.data }]));
    expect(green.status).toBe('done');
    expect(green.summary.total).toBe(13);
    expect(green.tests.map((t) => t.name).join('|')).not.toMatch(/fake/);
    if (isMac) expect(green.logTail).toMatch(/TAMPER denied/);
  });

  it('симлинк в архиве → bad_archive', async () => {
    const r = await runTarball([...dirEntries(path.join(FIXTURES, 'backend-solution')), { path: 'cand/evil', type: '2', linkname: '/etc/passwd' }]);
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('bad_archive');
  });

  it('архив другого коммита (pax comment GitHub) → commit_mismatch', async () => {
    const r = await runTarball(
      [{ path: 'pax_global_header', type: 'g', data: paxRecord('comment', 'f'.repeat(40)) }, ...dirEntries(path.join(FIXTURES, 'backend-solution'))],
      { commitSha: 'abc1234' },
    );
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('commit_mismatch');
  });

  it('образ не совпадает с шаблоном → 400 image_mismatch', async () => {
    await expect(
      submitRun(
        { source: { kind: 'tarball', data: makeTarGz(dirEntries(path.join(FIXTURES, 'backend-solution'))) }, commitSha: 'abc1234', testsBundleRef: 'be-webapi-junior-notes', image: 'python312' },
        { baseUrl: base, token },
      ),
    ).rejects.toMatchObject({ code: 'image_mismatch', status: 400 });
  });
});
