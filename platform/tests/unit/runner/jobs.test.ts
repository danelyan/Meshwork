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
