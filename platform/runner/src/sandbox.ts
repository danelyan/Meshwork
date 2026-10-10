import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

import type { RunnerImage } from './contract';
import type { RunnerConfig } from './config';

/**
 * Запуск одного задания: короткоживущий процесс с жёсткими рамками.
 *
 * Всегда: пустое окружение (только наш фиксированный набор, без секретов сервиса), своя группа
 * процессов (по таймауту — SIGKILL всей группе), rlimit через `ulimit` в обёртке `sh`
 * (CPU-секунды, размер файла, дескрипторы; в контейнере ещё число процессов и для python
 * адресное пространство), oom_score_adj=1000 — при нехватке памяти ядро убьёт задание, не сервис.
 * В контейнере сервис — непривилегированный uid 1001; задание запускает setuid-помощник
 * `fsp-sandbox` (sandbox/helper/fsp-sandbox.c) под uid 2000 без capabilities и с no_new_privs.
 * Тем же помощником (от имени uid 2000) добиваются все процессы задания и чистятся его tmp/out —
 * сервис сам сигнал чужому uid послать не может. Сеть режется на уровне контейнера (internal-сеть).
 * Локально на macOS (`RUNNER_LOCAL=1`): тот же uid, а сеть наружу и запись вне tmp/out режет
 * `sandbox-exec`. На Linux без Docker локальный режим сеть не режет — только для разработки.
 */

export interface JobPaths {
  jobDir: string;
  repoDir: string;
  tmpDir: string;
  outDir: string;
}

export interface SandboxSpec extends JobPaths {
  image: RunnerImage;
  testEnvironment: 'node' | 'jsdom';
  timeoutSec: number;
}

export interface SandboxCommand {
  file: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  /** Путь к fsp-sandbox, если задание идёт под отдельным uid (контейнер): им же — killall. */
  helper?: string;
  reportFile: string;
  reportKind: 'vitest-json' | 'junit-xml';
}

export interface SandboxOutcome {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  log: string;
  durationMs: number;
}

const LOG_KEEP = 64 * 1024;
const FILE_SIZE_MB = 64;
const NOFILE = 512;
const NPROC = 256;

/** Обёртка: rlimit и oom_score_adj, затем exec в команду. Аргументы позиционные — окружение чистое. */
export const LIMIT_WRAPPER = [
  'cpu=$1 fs=$2 nf=$3 np=$4 vm=$5; shift 5',
  'ulimit -t "$cpu" && ulimit -f "$fs" && ulimit -n "$nf" || { echo "fsp-runner: ulimit failed" >&2; exit 97; }',
  'if [ "$np" != - ]; then ulimit -u "$np" || exit 97; fi',
  'if [ "$vm" != - ]; then ulimit -v "$vm" || exit 97; fi',
  '{ echo 1000 > /proc/self/oom_score_adj; } 2>/dev/null',
  'exec "$@"',
].join('\n');

/** Профиль sandbox-exec для локального режима macOS: наружу только localhost, запись — только tmp/out. */
export function macSandboxProfile(writable: string[]): string {
  const allow = writable.map((p) => `(subpath ${JSON.stringify(p)})`).join(' ');
  return [
    '(version 1)',
    '(allow default)',
    '(deny network-outbound (remote ip "*:*"))',
    '(allow network-outbound (remote ip "localhost:*"))',
    '(deny file-write*)',
    `(allow file-write* ${allow} (literal "/dev/null") (literal "/dev/zero") (regex #"^/dev/fd/"))`,
  ].join('');
}

export function isRoot(): boolean {
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

/** Контейнерный режим: Linux, не RUNNER_LOCAL, задан помощник смены uid. */
export function isContainerMode(cfg: RunnerConfig, platform: NodeJS.Platform = process.platform): boolean {
  return !cfg.local && platform === 'linux' && Boolean(cfg.sandboxHelper);
}

export function buildCommand(cfg: RunnerConfig, spec: SandboxSpec, opts: { container: boolean; platform: NodeJS.Platform }): SandboxCommand {
  const linuxContainer = opts.container && opts.platform === 'linux' && Boolean(cfg.sandboxHelper);
  const baseEnv: Record<string, string> = {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOME: spec.tmpDir,
    TMPDIR: spec.tmpDir,
    LANG: 'C.UTF-8',
    TZ: 'Europe/Moscow',
    CI: '1',
    NO_COLOR: '1',
  };
  let argv: string[];
  let env: Record<string, string>;
  let reportFile: string;
  let reportKind: SandboxCommand['reportKind'];
  if (spec.image === 'node20') {
    reportFile = path.join(spec.outDir, 'report.json');
    reportKind = 'vitest-json';
    argv = [
      cfg.nodeBin,
      path.join(cfg.nodeDepsDir, 'vitest/vitest.mjs'),
      'run',
      '--root',
      spec.repoDir,
      '--config',
      cfg.vitestConfig,
      '--configLoader',
      'native',
    ];
    env = {
      ...baseEnv,
      NODE_OPTIONS: `--max-old-space-size=${cfg.memMb}`,
      NODE_PATH: cfg.nodeDepsDir,
      FSP_REPO_DIR: spec.repoDir,
      FSP_CACHE_DIR: path.join(spec.tmpDir, '.vite'),
      FSP_TEST_ENV: spec.testEnvironment,
      FSP_REPORT_FILE: reportFile,
    };
  } else {
    reportFile = path.join(spec.outDir, 'report.xml');
    reportKind = 'junit-xml';
    const testsDir = path.join(spec.repoDir, '.platform-tests');
    argv = [
      cfg.pythonBin,
      '-B',
      '-m',
      'pytest',
      '-q',
      '-p',
      'no:cacheprovider',
      '-c',
      cfg.pytestIni,
      '--rootdir',
      spec.repoDir,
      '--confcutdir',
      testsDir,
      `--junitxml=${reportFile}`,
      testsDir,
    ];
    env = {
      ...baseEnv,
      PYTHONPATH: spec.repoDir,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONNOUSERSITE: '1',
      PYTEST_DISABLE_PLUGIN_AUTOLOAD: '1',
    };
  }

  const cpu = String(spec.timeoutSec + 5);
  const fsize = String((FILE_SIZE_MB * 1024 * 1024) / 512); // POSIX sh: блоки по 512 байт
  const nproc = linuxContainer ? String(NPROC) : '-'; // на macOS RLIMIT_NPROC — на всего пользователя
  // RLIMIT_AS ломает V8 (резервирует адресное пространство) — node ограничивается кучей и памятью контейнера.
  const vmem = spec.image === 'python312' && opts.platform === 'linux' ? String(cfg.memMb * 1024) : '-';
  const wrapped = ['/bin/sh', '-c', LIMIT_WRAPPER, 'fsp-job', cpu, fsize, String(NOFILE), nproc, vmem, ...argv];

  if (cfg.local && opts.platform === 'darwin') {
    return {
      file: '/usr/bin/sandbox-exec',
      args: ['-p', macSandboxProfile([spec.tmpDir, spec.outDir]), ...wrapped],
      env,
      cwd: spec.repoDir,
      reportFile,
      reportKind,
    };
  }
  if (linuxContainer) {
    return {
      file: cfg.sandboxHelper!,
      args: ['exec', ...wrapped],
      env,
      cwd: spec.repoDir,
      helper: cfg.sandboxHelper!,
      reportFile,
      reportKind,
    };
  }
  return { file: wrapped[0]!, args: wrapped.slice(1), env, cwd: spec.repoDir, reportFile, reportKind };
}

const execFileP = promisify(execFile);

/** Через помощник: от имени uid задания kill(-1) — все его процессы (setsid не спасает). */
export async function helperKillAll(helper: string): Promise<void> {
  await execFileP(helper, ['killall'], { env: {} as NodeJS.ProcessEnv, timeout: 10_000 }).catch(() => undefined);
}

/** Через помощник: удалить содержимое каталога, созданное заданием (сервису чужие файлы не удалить). */
export async function helperClean(helper: string, dir: string): Promise<void> {
  await execFileP(helper, ['clean', dir], { env: {} as NodeJS.ProcessEnv, timeout: 30_000 }).catch(() => undefined);
}

export function runSandboxed(cmd: SandboxCommand, timeoutSec: number): Promise<SandboxOutcome> {
  const started = Date.now();
  return new Promise((resolve) => {
    let log = '';
    const append = (chunk: Buffer) => {
      log += chunk.toString('utf8');
      if (log.length > LOG_KEEP * 2) log = log.slice(-LOG_KEEP);
    };
    const child = spawn(cmd.file, cmd.args, {
      cwd: cmd.cwd,
      env: cmd.env as NodeJS.ProcessEnv, // ровно этот набор, без process.env сервиса
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let timedOut = false;
    const killGroup = () => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, 'SIGKILL'); // в контейнере EPERM (чужой uid) — там работает helperKillAll
      } catch {
        /* группа уже пуста */
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
      if (cmd.helper) void helperKillAll(cmd.helper);
    }, timeoutSec * 1000);
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    let done = false;
    // 'exit', а не 'close': фоновый процесс кандидата может держать открытым stdout.
    const finish = async (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      killGroup(); // фоновые процессы, оставленные кодом кандидата
      if (cmd.helper) await helperKillAll(cmd.helper);
      // дочитать то, что уже в трубе, но не ждать её закрытия
      await new Promise((r) => setTimeout(r, 50));
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ exitCode, signal, timedOut, log: log.slice(-LOG_KEEP), durationMs: Date.now() - started });
    };
    child.on('error', (err) => {
      append(Buffer.from(`\nfsp-runner: spawn failed: ${err.message}\n`));
      void finish(null, null);
    });
    child.on('exit', (code, signal) => void finish(code, signal));
  });
}
