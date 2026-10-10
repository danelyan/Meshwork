import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, chown, cp, mkdir, readdir, readFile, realpath, rm, stat, symlink } from 'node:fs/promises';
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
import { buildCommand, helperClean, isContainerMode, runSandboxed, type SandboxCommand, type SandboxOutcome } from './sandbox';
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
  uploadBytes: number;
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

  /** Байты архивов, ждущих на диске: незабранные загрузки + задания в очереди. */
  private pendingBytes(): number {
    let sum = 0;
    for (const u of this.uploads.values()) sum += u.bytes;
    for (const id of this.queue) sum += this.jobs.get(id)?.uploadBytes ?? 0;
    return sum;
  }

  /** Принять tarball потоком в свой каталог, не больше 50 МБ; общий объём ожидающих — не больше maxPendingBytes. */
  async receiveUpload(body: Readable, declaredLength: number | undefined): Promise<UploadResponse> {
    if (declaredLength !== undefined && declaredLength > MAX_TARBALL_BYTES) {
      throw new RunnerError('payload_too_large', `Архив больше ${MAX_TARBALL_BYTES / 1024 / 1024} МБ`, 413);
    }
    this.gcUploads();
    const pending = this.pendingBytes();
    if (this.uploads.size >= this.cfg.maxQueue || pending + (declaredLength ?? 0) > this.cfg.maxPendingBytes) {
      throw new RunnerError('queue_full', 'Очередь проверок заполнена, повторите позже', 429);
    }
    const uploadId = newId();
    const file = path.join(this.uploadsDir, `${uploadId}.tar.gz`);
    const hash = createHash('sha256');
    const maxPending = this.cfg.maxPendingBytes;
    let bytes = 0;
    try {
      await pipeline(
        body,
        async function* (source: AsyncIterable<Buffer>) {
          for await (const chunk of source) {
            bytes += chunk.length;
            if (bytes > MAX_TARBALL_BYTES) throw new RunnerError('payload_too_large', 'Архив больше 50 МБ', 413);
            if (pending + bytes > maxPending) throw new RunnerError('queue_full', 'Очередь проверок заполнена, повторите позже', 429);
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

  /** Поставить задание в очередь. При любом отказе загрузка удаляется: повтор — с новой загрузкой. */
  async submit(req: RunRequest): Promise<{ jobId: string }> {
    try {
      return await this.enqueue(req);
    } catch (err) {
      const id = req.repoTarballUrl ? UPLOAD_REF.exec(req.repoTarballUrl)?.[1] : undefined;
      const upload = id ? this.uploads.get(id) : undefined;
      if (id && upload) {
        this.uploads.delete(id);
        await rm(upload.file, { force: true });
      }
      throw err;
    }
  }

  private async enqueue(req: RunRequest): Promise<{ jobId: string }> {
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
    const uploadId = UPLOAD_REF.exec(req.repoTarballUrl)![1]!;
    const upload = this.uploads.get(uploadId);
    if (!upload) throw new RunnerError('upload_not_found', 'Загрузка не найдена или истекла', 404);
    if (this.queue.length >= this.cfg.maxQueue) throw new RunnerError('queue_full', 'Очередь проверок заполнена, повторите позже', 429);
    this.uploads.delete(uploadId);

    const jobId = newId();
    const timeoutSec = Math.min(req.timeoutSec ?? template.timeLimitSec, MAX_TIMEOUT_SEC);
    this.jobs.set(jobId, {
      uploadBytes: upload.bytes,
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
    const container = isContainerMode(this.cfg);
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
      // cp переносит режимы из образа (шаблоны там 0700/0600 у uid сервиса) — заданию нужно чтение.
      await makeReadable(testsDir);

      // 3. Пакеты платформы: вверх по дереву от repo/ лежит node_modules → предустановленный набор.
      if (job.template.image === 'node20') await symlink(this.cfg.nodeDepsDir, path.join(jobDir, 'node_modules'), 'dir');

      // 4. Записываемые каталоги задания.
      await mkdir(tmpDir, { mode: 0o700 });
      await mkdir(outDir, { mode: 0o700 });
      if (container) {
        // Владелец — сервис, группа — задание (setgid-каталог): задание пишет, сервис читает отчёт.
        for (const dir of [tmpDir, outDir]) {
          await chown(dir, process.getuid!(), this.cfg.sandboxGid);
          await chmod(dir, 0o2770);
        }
      }

      const cmd = buildCommand(
        this.cfg,
        { jobDir, repoDir, tmpDir, outDir, image: job.template.image, testEnvironment: job.template.testEnvironment, timeoutSec: job.timeoutSec },
        { container, platform: process.platform },
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
      if (container && this.cfg.sandboxHelper) {
        // Файлы задания принадлежат uid 2000 — удалить их может только он (через помощник).
        await helperClean(this.cfg.sandboxHelper, tmpDir);
        await helperClean(this.cfg.sandboxHelper, outDir);
      }
      await rm(jobDir, { recursive: true, force: true }).catch((err: Error) => console.error(`runner: не удалось убрать ${jobId}: ${err.message}`));
    }
  }
}

/** chmod a+rX рекурсивно: каталоги 0755, файлы 0644 (симлинков в наборе тестов нет). */
export async function makeReadable(dir: string): Promise<void> {
  await chmod(dir, 0o755);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) await makeReadable(p);
    else if (entry.isFile()) await chmod(p, 0o644);
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
