import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, chown, cp, mkdir, readFile, realpath, rm, stat, symlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

import {
  MAX_TARBALL_BYTES,
  MAX_TIMEOUT_SEC,
  UPLOAD_REF,
  parseBundleRef,
  type FailureReason,
  type RunRequest,
  type RunResult,
  type TestResult,
  type UploadResponse,
} from './contract';
import type { RunnerConfig } from './config';
import { parseJunitXml, parseVitestJson, summarize } from './report';
import { buildCommand, isRoot, runSandboxed, type SandboxCommand, type SandboxOutcome } from './sandbox';
import { ArchiveError, parseTarGz, writeEntries } from './tar';
import { PLATFORM_TESTS_DIR, bundleDir, loadTemplate, ownedPrefix, type TemplateManifest } from './templates';

export class RunnerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RunnerError';
  }
}

const LOG_TAIL = 4000;
const newId = () => randomBytes(16).toString('hex');
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');

interface Upload {
  file: string;
  bytes: number;
  expiresAt: number;
}

interface Job {
  result: RunResult;
  request: RunRequest;
  template: TemplateManifest;
  suite: 'hidden' | 'visible';
  uploadFile: string;
  timeoutSec: number;
}

/** Хуки для тестов: подменить запуск процесса. */
export interface JobManagerDeps {
  run?: (cmd: SandboxCommand, timeoutSec: number) => Promise<SandboxOutcome>;
  now?: () => number;
}

/**
 * Очередь в памяти, одно задание за раз. Рестарт сервиса теряет очередь и результаты:
 * клиент получает 404 и решает сам (lane project — пометить сабмит failed и предложить повтор).
 */
export class JobManager {
  private readonly jobs = new Map<string, Job>();
  private readonly uploads = new Map<string, Upload>();
  private readonly queue: string[] = [];
  private busy = false;
  private readonly run: NonNullable<JobManagerDeps['run']>;
  private readonly now: () => number;

  constructor(
    private readonly cfg: RunnerConfig,
    deps: JobManagerDeps = {},
  ) {
    this.run = deps.run ?? runSandboxed;
    this.now = deps.now ?? Date.now;
  }

  get uploadsDir() {
    return path.join(this.cfg.workDir, 'uploads');
  }
  get jobsDir() {
    return path.join(this.cfg.workDir, 'jobs');
  }

  async init(): Promise<void> {
    // macOS: /var → /private/var; профиль sandbox-exec сравнивает настоящие пути.
    await mkdir(this.cfg.workDir, { recursive: true, mode: 0o711 });
    this.cfg.workDir = await realpath(this.cfg.workDir);
    await rm(this.uploadsDir, { recursive: true, force: true });
    await rm(this.jobsDir, { recursive: true, force: true });
    await mkdir(this.uploadsDir, { recursive: true, mode: 0o700 });
    await mkdir(this.jobsDir, { recursive: true, mode: 0o711 });
    await chmod(this.cfg.workDir, 0o711).catch(() => undefined);
  }

  stats() {
    return { queued: this.queue.length, running: this.busy, jobs: this.jobs.size, uploads: this.uploads.size };
  }

  /** Принять tarball потоком в свой каталог, не больше 50 МБ. */
  async receiveUpload(body: Readable, declaredLength: number | undefined): Promise<UploadResponse> {
    if (declaredLength !== undefined && declaredLength > MAX_TARBALL_BYTES) {
      throw new RunnerError('payload_too_large', `Архив больше ${MAX_TARBALL_BYTES / 1024 / 1024} МБ`, 413);
    }
    this.gcUploads();
    const uploadId = newId();
    const file = path.join(this.uploadsDir, `${uploadId}.tar.gz`);
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      await pipeline(
        body,
        async function* (source: AsyncIterable<Buffer>) {
          for await (const chunk of source) {
            bytes += chunk.length;
            if (bytes > MAX_TARBALL_BYTES) throw new RunnerError('payload_too_large', 'Архив больше 50 МБ', 413);
            hash.update(chunk);
            yield chunk;
          }
        },
        createWriteStream(file, { mode: 0o600 }),
      );
    } catch (err) {
      await rm(file, { force: true });
      if (err instanceof RunnerError) throw err;
      throw new RunnerError('upload_failed', 'Не удалось принять архив', 400);
    }
    if (bytes === 0) {
      await rm(file, { force: true });
      throw new RunnerError('bad_request', 'Пустое тело', 400);
    }
    this.uploads.set(uploadId, { file, bytes, expiresAt: this.now() + this.cfg.uploadTtlMs });
    return { uploadId, bytes, sha256: hash.digest('hex') };
  }

  private gcUploads() {
    const t = this.now();
    for (const [id, u] of this.uploads) {
      if (u.expiresAt < t) {
        this.uploads.delete(id);
        void rm(u.file, { force: true });
      }
    }
  }

  async submit(req: RunRequest): Promise<{ jobId: string }> {
    if (req.repoUrl !== undefined && req.repoTarballUrl === undefined) {
      throw new RunnerError(
        'repo_url_not_supported',
        'У runner нет сети: app скачивает tarball сам и передаёт его через POST /uploads (repoTarballUrl=upload:<id>)',
        422,
      );
    }
    if (!req.repoTarballUrl) throw new RunnerError('bad_request', 'Нужен repoTarballUrl', 400);
    const bundle = parseBundleRef(req.testsBundleRef)!;
    let template: TemplateManifest | null;
    try {
      template = await loadTemplate(this.cfg.templatesDir, bundle.templateId);
    } catch (err) {
      throw new RunnerError('bad_template', `Шаблон ${bundle.templateId} повреждён: ${(err as Error).message}`, 500);
    }
    if (!template) throw new RunnerError('bundle_not_found', `Нет шаблона ${bundle.templateId}`, 404);
    if (template.image !== req.image) {
      throw new RunnerError('image_mismatch', `Шаблон ${template.id} проверяется в образе ${template.image}, а не ${req.image}`, 400);
    }
    if (this.queue.length >= this.cfg.maxQueue) throw new RunnerError('queue_full', 'Очередь проверок заполнена, повторите позже', 429);

    const uploadId = UPLOAD_REF.exec(req.repoTarballUrl)![1]!;
    const upload = this.uploads.get(uploadId);
    if (!upload) throw new RunnerError('upload_not_found', 'Загрузка не найдена или истекла', 404);
    this.uploads.delete(uploadId);

    const jobId = newId();
    const timeoutSec = Math.min(req.timeoutSec ?? template.timeLimitSec, MAX_TIMEOUT_SEC);
    this.jobs.set(jobId, {
      request: req,
      template,
      suite: bundle.suite,
      uploadFile: upload.file,
      timeoutSec,
      result: {
        jobId,
        status: 'queued',
        tests: [],
        summary: { total: 0, passed: 0, failed: 0 },
        logTail: '',
        durationMs: 0,
        testsBundleRef: req.testsBundleRef,
        commitSha: req.commitSha,
        image: req.image,
        createdAt: new Date(this.now()).toISOString(),
      },
    });
    this.queue.push(jobId);
    this.gcJobs();
    void this.pump();
    return { jobId };
  }

  get(jobId: string): RunResult | undefined {
    return this.jobs.get(jobId)?.result;
  }

  private gcJobs() {
    if (this.jobs.size <= this.cfg.keepJobs) return;
    for (const [id, job] of this.jobs) {
      if (this.jobs.size <= this.cfg.keepJobs) break;
      if (job.result.status === 'done' || job.result.status === 'failed') this.jobs.delete(id);
    }
  }

  /** Дождаться, пока очередь опустеет (тесты, остановка сервиса). */
  async idle(): Promise<void> {
    while (this.busy || this.queue.length) await new Promise((r) => setTimeout(r, 20));
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    const jobId = this.queue.shift();
    if (!jobId) return;
    this.busy = true;
    const job = this.jobs.get(jobId)!;
    try {
      await this.execute(jobId, job);
    } catch (err) {
      this.fail(job, 'internal', `fsp-runner: внутренняя ошибка: ${(err as Error).message}`);
    } finally {
      this.busy = false;
      void this.pump();
    }
  }

  private fail(job: Job, reason: FailureReason, log: string, extra: Partial<RunResult> = {}) {
    Object.assign(job.result, {
      status: 'failed',
      reason,
      logTail: stripAnsi(log).slice(-LOG_TAIL),
      finishedAt: new Date(this.now()).toISOString(),
      ...extra,
    });
  }

  private async execute(jobId: string, job: Job): Promise<void> {
    const started = this.now();
    job.result.status = 'running';
    const jobDir = path.join(this.jobsDir, jobId);
    const repoDir = path.join(jobDir, 'repo');
    const tmpDir = path.join(jobDir, 'tmp');
    const outDir = path.join(jobDir, 'out');
    const root = isRoot() && process.platform === 'linux' && !this.cfg.local;
    try {
      // 1. Архив → repo/ (владелец — сервис; заданию только чтение).
      let parsed;
      try {
        parsed = parseTarGz(await readFile(job.uploadFile));
      } catch (err) {
        if (err instanceof ArchiveError) return this.fail(job, 'bad_archive', `fsp-runner: архив отклонён: ${err.message}`);
        throw err;
      } finally {
        await rm(job.uploadFile, { force: true });
      }
      if (parsed.comment && /^[0-9a-f]{40}$/.test(parsed.comment) && !parsed.comment.startsWith(job.request.commitSha)) {
        return this.fail(job, 'commit_mismatch', `fsp-runner: архив собран из коммита ${parsed.comment}, ожидался ${job.request.commitSha}`);
      }
      await mkdir(jobDir, { mode: 0o755 });
      try {
        await writeEntries(repoDir, parsed.entries);
      } catch (err) {
        return this.fail(job, 'bad_archive', `fsp-runner: архив не распаковался: ${(err as Error).message}`);
      }

      // 2. Пути платформы в копии кандидата удаляются; тесты платформы — только из образа.
      for (const pattern of [...job.template.platformOwned, `${PLATFORM_TESTS_DIR}/**`]) {
        const prefix = ownedPrefix(pattern);
        if (prefix) await rm(path.join(repoDir, prefix), { recursive: true, force: true });
      }
      const bundle = await bundleDir(this.cfg.templatesDir, job.template, job.suite);
      if (!bundle) return this.fail(job, 'bundle_not_found', `fsp-runner: нет набора тестов ${job.request.testsBundleRef}`);
      // hidden → .platform-tests/, visible → .platform-tests/visible/ (та же глубина, что tests/visible/ у кандидата).
      const testsDir = path.join(repoDir, PLATFORM_TESTS_DIR);
      await mkdir(testsDir, { mode: 0o755 });
      await cp(bundle, job.suite === 'hidden' ? testsDir : path.join(testsDir, 'visible'), { recursive: true, dereference: false, verbatimSymlinks: true });

      // 3. Пакеты платформы: вверх по дереву от repo/ лежит node_modules → предустановленный набор.
      if (job.template.image === 'node20') await symlink(this.cfg.nodeDepsDir, path.join(jobDir, 'node_modules'), 'dir');

      // 4. Записываемые каталоги задания.
      await mkdir(tmpDir, { mode: 0o700 });
      await mkdir(outDir, { mode: 0o700 });
      if (root) {
        await chown(tmpDir, this.cfg.sandboxUid, this.cfg.sandboxGid);
        await chown(outDir, this.cfg.sandboxUid, this.cfg.sandboxGid);
      }

      const cmd = buildCommand(
        this.cfg,
        { jobDir, repoDir, tmpDir, outDir, image: job.template.image, testEnvironment: job.template.testEnvironment, timeoutSec: job.timeoutSec },
        { root, platform: process.platform },
      );
      const outcome = await this.run(cmd, job.timeoutSec);
      const durationMs = this.now() - started;
      // Пути задания в журнале не нужны получателю: заменяем на <job>.
      const log = outcome.log.split(jobDir).join('<job>');

      if (outcome.timedOut) {
        return this.fail(job, 'timeout', `${log}\nfsp-runner: превышено время ${job.timeoutSec} с, задание остановлено`, {
          durationMs,
          exitCode: outcome.exitCode,
        });
      }
      let tests: TestResult[] | null = null;
      try {
        const text = await readFile(cmd.reportFile, 'utf8');
        tests = cmd.reportKind === 'vitest-json' ? parseVitestJson(text, repoDir) : parseJunitXml(text);
      } catch {
        tests = null;
      }
      if (!tests || tests.length === 0) {
        return this.fail(job, 'no_report', `${log}\nfsp-runner: тесты не дали отчёта (код выхода ${outcome.exitCode ?? outcome.signal})`, {
          durationMs,
          exitCode: outcome.exitCode,
        });
      }
      Object.assign(job.result, {
        status: 'done',
        tests,
        summary: summarize(tests),
        logTail: stripAnsi(log).slice(-LOG_TAIL),
        durationMs,
        exitCode: outcome.exitCode,
        finishedAt: new Date(this.now()).toISOString(),
      });
    } finally {
      await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** Для /health и тестов: существует ли каталог. */
export async function dirExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}
