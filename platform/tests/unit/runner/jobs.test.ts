import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../../../runner/src/config';
import { JobManager } from '../../../runner/src/jobs';
import type { SandboxOutcome } from '../../../runner/src/sandbox';
import { dirEntries, makeTarGz } from '../../helpers/tar';

/** Очередь и лимиты runner без настоящих процессов: run подменён и ждёт команды теста. */
let work: string;
let release: () => void;
let open = false;
let jobs: JobManager;
const tarball = () => makeTarGz(dirEntries(path.resolve('tests/fixtures/runner/backend-solution')));
const body = (b: Buffer) => Readable.from([b]);
const req = (uploadId: string) => ({
  repoTarballUrl: `upload:${uploadId}`,
  commitSha: 'abc1234',
  testsBundleRef: 'backend-junior-api',
  image: 'node20' as const,
});

beforeEach(async () => {
  work = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'fsp-runner-q-')));
  const cfg = loadConfig({ RUNNER_LOCAL: '1', RUNNER_WORK_DIR: work, RUNNER_MAX_QUEUE: '2', RUNNER_MAX_PENDING_MB: '50' });
  open = false;
  let gate = new Promise<void>((r) => (release = r));
  const run = async (): Promise<SandboxOutcome> => {
    if (!open) await gate;
    gate = new Promise<void>((r) => (release = r));
    return { exitCode: 1, signal: null, timedOut: false, log: '', durationMs: 1 };
  };
  jobs = new JobManager(cfg, { run });
  await jobs.init();
});

afterEach(async () => {
  open = true;
  release?.();
  await jobs.idle();
  rmSync(work, { recursive: true, force: true });
});

describe('runner очередь и лимиты', () => {
  it('429 queue_full, когда очередь заполнена, и архив отклонённого запроса удаляется', async () => {
    const upload = async () => (await jobs.receiveUpload(body(tarball()), undefined)).uploadId;
    await jobs.submit(req(await upload())); // сразу running
    await new Promise((r) => setTimeout(r, 20));
    await jobs.submit(req(await upload()));
    await jobs.submit(req(await upload())); // очередь = 2
    const last = await upload();
    await expect(jobs.submit(req(last))).rejects.toMatchObject({ code: 'queue_full', status: 429 });
    expect(existsSync(path.join(work, 'uploads', `${last}.tar.gz`))).toBe(false);
    await expect(jobs.submit(req(last))).rejects.toMatchObject({ code: 'upload_not_found' });
  });

  it('429 на /uploads: лимит числа незабранных загрузок и объёма ожидающих архивов', async () => {
    await jobs.receiveUpload(body(tarball()), undefined);
    await jobs.receiveUpload(body(tarball()), undefined);
    await expect(jobs.receiveUpload(body(tarball()), undefined)).rejects.toMatchObject({ code: 'queue_full', status: 429 });
  });

  it('объявленный размер сверх свободного объёма — 429 до чтения тела', async () => {
    await jobs.receiveUpload(body(tarball()), undefined);
    await expect(jobs.receiveUpload(body(Buffer.alloc(1)), 50 * 1024 * 1024)).rejects.toMatchObject({ code: 'queue_full' });
  });

  it('отказ по шаблону тоже удаляет загрузку', async () => {
    const { uploadId } = await jobs.receiveUpload(body(tarball()), undefined);
    await expect(jobs.submit({ ...req(uploadId), image: 'python312' })).rejects.toMatchObject({ code: 'image_mismatch' });
    expect(existsSync(path.join(work, 'uploads', `${uploadId}.tar.gz`))).toBe(false);
  });
});

describe('runner: чтение отчёта задания', () => {
  it('обычный файл читается; симлинк, FIFO, каталог и слишком большой файл — отказ без зависания', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdirSync, symlinkSync, writeFileSync } = await import('node:fs');
    const { readReportSafe } = await import('../../../runner/src/jobs');
    const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'fsp-report-')));
    try {
      writeFileSync(path.join(d, 'ok.json'), '{"a":1}');
      expect(await readReportSafe(path.join(d, 'ok.json'))).toBe('{"a":1}');

      writeFileSync(path.join(d, 'secret'), 'SECRET');
      symlinkSync(path.join(d, 'secret'), path.join(d, 'link.json'));
      await expect(readReportSafe(path.join(d, 'link.json'))).rejects.toThrow();

      execFileSync('mkfifo', [path.join(d, 'fifo.json')]);
      const started = Date.now();
      await expect(readReportSafe(path.join(d, 'fifo.json'))).rejects.toThrow(/не обычный файл/);
      expect(Date.now() - started).toBeLessThan(1000);

      mkdirSync(path.join(d, 'dir.json'));
      await expect(readReportSafe(path.join(d, 'dir.json'))).rejects.toThrow();

      writeFileSync(path.join(d, 'big.json'), Buffer.alloc(2048));
      await expect(readReportSafe(path.join(d, 'big.json'), 1024)).rejects.toThrow(/лимит/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
