import os from 'node:os';
import path from 'node:path';

/**
 * Настройки сервиса runner из окружения. В Docker все пути задаёт `runner/Dockerfile`;
 * локально (`RUNNER_LOCAL=1`, macOS без Docker) пути по умолчанию считаются от `platform/`.
 */
export interface RunnerConfig {
  /** Общий секрет с app. Не задан — все запросы, кроме /health, получают 503. */
  token?: string;
  host: string;
  port: number;
  /** Локальный режим: без смены пользователя; на macOS сеть и запись режет sandbox-exec. */
  local: boolean;
  workDir: string;
  templatesDir: string;
  nodeBin: string;
  nodeDepsDir: string;
  vitestConfig: string;
  pythonBin: string;
  pytestIni: string;
  /** uid/gid задания; применяются, только если сервис запущен от root (в контейнере). */
  sandboxUid: number;
  sandboxGid: number;
  /** Лимит памяти задания, МБ (V8 heap для node, RLIMIT_AS для python). */
  memMb: number;
  maxQueue: number;
  /** Сколько завершённых заданий держать в памяти. */
  keepJobs: number;
  /** Сколько хранить загрузку, которую не забрали в /run. */
  uploadTtlMs: number;
}

const int = (v: string | undefined, def: number, min: number, max: number) => {
  const n = v === undefined || v === '' ? def : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`runner: число вне диапазона ${min}..${max}: ${v}`);
  return n;
};

export function loadConfig(env: Record<string, string | undefined> = process.env, cwd = process.cwd()): RunnerConfig {
  const local = env.RUNNER_LOCAL === '1' || env.RUNNER_LOCAL === 'true';
  const base = path.resolve(cwd, env.RUNNER_BASE_DIR ?? 'runner');
  const token = env.RUNNER_TOKEN?.trim();
  if (token !== undefined && token !== '' && token.length < 32) throw new Error('RUNNER_TOKEN — не короче 32 символов');
  return {
    token: token || undefined,
    host: env.RUNNER_HOST ?? (local ? '127.0.0.1' : '0.0.0.0'),
    port: int(env.RUNNER_PORT, 8090, 1, 65535),
    local,
    workDir: path.resolve(env.RUNNER_WORK_DIR ?? path.join(os.tmpdir(), 'fsp-runner')),
    templatesDir: path.resolve(cwd, env.RUNNER_TEMPLATES_DIR ?? 'project-templates'),
    nodeBin: env.RUNNER_NODE_BIN ?? process.execPath,
    nodeDepsDir: path.resolve(env.RUNNER_NODE_DEPS ?? path.join(base, 'sandbox/node/node_modules')),
    vitestConfig: path.resolve(env.RUNNER_VITEST_CONFIG ?? path.join(base, 'sandbox/node/vitest.job.config.mjs')),
    pythonBin: env.RUNNER_PYTHON ?? 'python3',
    pytestIni: path.resolve(env.RUNNER_PYTEST_INI ?? path.join(base, 'sandbox/python/pytest.job.ini')),
    sandboxUid: int(env.RUNNER_SANDBOX_UID, 2000, 1, 65534),
    sandboxGid: int(env.RUNNER_SANDBOX_GID, 2000, 1, 65534),
    memMb: int(env.RUNNER_JOB_MEM_MB, 768, 128, 8192),
    maxQueue: int(env.RUNNER_MAX_QUEUE, 20, 1, 1000),
    keepJobs: int(env.RUNNER_KEEP_JOBS, 500, 10, 100_000),
    uploadTtlMs: int(env.RUNNER_UPLOAD_TTL_SEC, 900, 10, 86_400) * 1000,
  };
}
