import { Agent, request } from 'undici';
import { z } from 'zod';

import {
  MAX_TARBALL_BYTES,
  RUNNER_IMAGES,
  TESTS_BUNDLE_REF,
  COMMIT_SHA,
  runAcceptedSchema,
  runResultSchema,
  runnerErrorSchema,
  uploadResponseSchema,
  type RunResult,
} from '../../../runner/src/contract';
import { GITHUB_HANDLE, githubHeaders } from '../collector/github';
import { checkUrl, type Resolver } from '../collector/ssrf';
import { pinnedLookup } from '../collector/url';
import { getEnv } from '../env';
import { AppError } from '../errors';

/**
 * Клиент app → runner (lane runner, ADR 0003). У runner нет интернета, поэтому tarball репозитория
 * скачивает app: GitHub REST `/repos/{o}/{r}/tarball/{sha}` → редирект на codeload; каждый хоп
 * через SSRF-проверку (collector/ssrf.ts) с пиннингом адреса (collector/url.ts), ≤ 50 МБ, таймаут.
 * Дальше `POST /uploads` (тело – архив) и `POST /run {repoTarballUrl: "upload:<id>"}`.
 *
 * Результат runner – данные из процесса, где исполнялся код кандидата: `logTail` и `tests[].error`
 * не показывать кандидату как есть (раскрывают скрытые тесты) и не подавать в LLM как инструкции.
 */

export type { RunResult, TestResult } from '../../../runner/src/contract';

export const submitRunInputSchema = z.object({
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('github'), repoUrl: z.string().max(2048) }),
    /** Готовый .tar.gz (эталонные решения шаблонов, тесты, демо без сети). */
    z.object({ kind: z.literal('tarball'), data: z.instanceof(Uint8Array) }),
  ]),
  commitSha: z.string().toLowerCase().regex(COMMIT_SHA, 'commitSha: 7–40 hex'),
  testsBundleRef: z.string().regex(TESTS_BUNDLE_REF),
  image: z.enum(RUNNER_IMAGES),
  timeoutSec: z.number().int().min(5).max(300).optional(),
});
export type SubmitRunInput = z.input<typeof submitRunInputSchema>;

export interface RunnerClientDeps {
  baseUrl?: string;
  token?: string;
  fetch?: typeof fetch;
  /** Подмена скачивания (тесты). */
  downloadTarball?: (repo: GithubRepo, commitSha: string) => Promise<Uint8Array>;
  resolve?: Resolver;
}

export interface GithubRepo {
  owner: string;
  repo: string;
}

const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const DOWNLOAD_HOSTS = new Set(['api.github.com', 'codeload.github.com']);
const DOWNLOAD_TIMEOUT_MS = 30_000;
const RUNNER_TIMEOUT_MS = 30_000;

const runnerUnavailable = (message: string) => new AppError('runner_unavailable', message, 503);

/** `https://github.com/<owner>/<repo>(.git)` → {owner, repo}. Другие хосты – null. */
export function parseGithubRepoUrl(raw: string): GithubRepo | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || (url.hostname !== 'github.com' && url.hostname !== 'www.github.com')) return null;
  if (url.username || url.password || url.port) return null;
  const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  const owner = parts[0]!;
  const repo = parts[1]!.replace(/\.git$/, '');
  if (!GITHUB_HANDLE.test(owner) || !REPO_NAME.test(repo) || repo === '.' || repo === '..') return null;
  return { owner, repo };
}

/** Скачать tarball коммита с GitHub через SSRF-фильтр. Ручные редиректы только на хосты GitHub. */
export async function downloadGithubTarball(repo: GithubRepo, commitSha: string, resolve?: Resolver): Promise<Uint8Array> {
  if (!COMMIT_SHA.test(commitSha)) throw new AppError('bad_request', 'commitSha: 7–40 hex', 400);
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  let current = `https://api.github.com/repos/${repo.owner}/${repo.repo}/tarball/${commitSha}`;
  for (let hop = 0; hop < 4; hop++) {
    const target = await checkUrl(current, resolve);
    if (target.url.protocol !== 'https:' || !DOWNLOAD_HOSTS.has(target.url.hostname)) {
      throw new AppError('blocked_url', `Редирект на неожиданный хост ${target.url.hostname}`, 400);
    }
    const agent = new Agent({ connect: { lookup: pinnedLookup(target), timeout: 10_000 }, maxResponseSize: MAX_TARBALL_BYTES + 1 });
    try {
      const headers = target.url.hostname === 'api.github.com' ? githubHeaders() : { 'user-agent': 'MESHWORK-Runner/1.0' };
      const res = await request(target.url, {
        method: 'GET',
        dispatcher: agent,
        signal,
        headers: { 'user-agent': 'MESHWORK-Runner/1.0', ...headers, accept: 'application/vnd.github+json' },
      });
      if (res.statusCode >= 300 && res.statusCode < 400) {
        const location = res.headers.location;
        await res.body.dump();
        if (typeof location !== 'string') throw new AppError('fetch_failed', 'GitHub вернул редирект без адреса', 502);
        current = new URL(location, target.url).href;
        continue;
      }
      if (res.statusCode === 404) {
        await res.body.dump();
        throw new AppError('not_found', 'Репозиторий или коммит не найден (или репозиторий приватный)', 404);
      }
      if (res.statusCode !== 200) {
        await res.body.dump();
        throw new AppError('fetch_failed', `GitHub ответил ${res.statusCode}`, 502);
      }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > MAX_TARBALL_BYTES) {
        await res.body.dump();
        throw new AppError('payload_too_large', 'Репозиторий больше 50 МБ в архиве', 413);
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of res.body) {
        size += (chunk as Buffer).length;
        if (size > MAX_TARBALL_BYTES) {
          res.body.destroy();
          throw new AppError('payload_too_large', 'Репозиторий больше 50 МБ в архиве', 413);
        }
        chunks.push(chunk as Buffer);
      }
      return Buffer.concat(chunks);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('fetch_failed', 'Не удалось скачать репозиторий с GitHub', 502);
    } finally {
      await agent.close().catch(() => undefined);
    }
  }
  throw new AppError('blocked_url', 'Слишком много редиректов', 400);
}

function runnerConfig(deps: RunnerClientDeps): { baseUrl: string; token: string; fetch: typeof fetch } {
  let baseUrl = deps.baseUrl;
  let token = deps.token;
  if (baseUrl === undefined || token === undefined) {
    const env = getEnv();
    baseUrl ??= env.RUNNER_URL;
    token ??= env.RUNNER_TOKEN;
  }
  if (!baseUrl || !token) throw runnerUnavailable('Автопроверка проектов не настроена (RUNNER_URL, RUNNER_TOKEN)');
  if (token.length < 32) throw runnerUnavailable('RUNNER_TOKEN короче 32 символов');
  return { baseUrl: baseUrl.replace(/\/+$/, ''), token, fetch: deps.fetch ?? fetch };
}

async function callRunner<T>(
  cfg: ReturnType<typeof runnerConfig>,
  path: string,
  init: RequestInit,
  schema: z.ZodType<T>,
): Promise<T> {
  let res: Response;
  try {
    res = await cfg.fetch(`${cfg.baseUrl}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(RUNNER_TIMEOUT_MS),
    });
  } catch {
    throw runnerUnavailable('Сервис автопроверки не отвечает');
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = runnerErrorSchema.safeParse(body);
    const code = err.success ? err.data.error : 'runner_error';
    const message = err.success ? err.data.message : `runner ответил ${res.status}`;
    if (res.status === 404) throw new AppError(code === 'job_not_found' ? 'not_found' : code, message, 404);
    if (res.status === 429) throw new AppError('rate_limited', message, 429);
    if (res.status >= 500 || res.status === 401) throw runnerUnavailable(message);
    throw new AppError(code, message, res.status === 413 ? 413 : 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw runnerUnavailable('Некорректный ответ runner');
  return parsed.data;
}

/** Отправить проект на проверку: скачать (если нужно) → загрузить в runner → поставить в очередь. */
export async function submitRun(input: SubmitRunInput, deps: RunnerClientDeps = {}): Promise<{ jobId: string }> {
  const data = submitRunInputSchema.parse(input);
  const cfg = runnerConfig(deps);
  let tarball: Uint8Array;
  if (data.source.kind === 'github') {
    const repo = parseGithubRepoUrl(data.source.repoUrl);
    if (!repo) throw new AppError('bad_request', 'Ожидается ссылка вида https://github.com/<owner>/<repo>', 400);
    tarball = await (deps.downloadTarball ?? ((r, sha) => downloadGithubTarball(r, sha, deps.resolve)))(repo, data.commitSha);
  } else {
    tarball = data.source.data;
  }
  if (tarball.byteLength > MAX_TARBALL_BYTES) throw new AppError('payload_too_large', 'Архив больше 50 МБ', 413);
  const upload = await callRunner(
    cfg,
    '/uploads',
    { method: 'POST', headers: { 'content-type': 'application/gzip' }, body: Buffer.from(tarball) },
    uploadResponseSchema,
  );
  return callRunner(
    cfg,
    '/run',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repoTarballUrl: `upload:${upload.uploadId}`,
        commitSha: data.commitSha,
        testsBundleRef: data.testsBundleRef,
        image: data.image,
        ...(data.timeoutSec ? { timeoutSec: data.timeoutSec } : {}),
      }),
    },
    runAcceptedSchema,
  );
}

/** Статус и результат задания. 404 `not_found` – задания нет (в том числе после рестарта runner). */
export async function getRun(jobId: string, deps: RunnerClientDeps = {}): Promise<RunResult> {
  if (!/^[0-9a-f]{32}$/.test(jobId)) throw new AppError('bad_request', 'Некорректный jobId', 400);
  return callRunner(runnerConfig(deps), `/run/${jobId}`, { method: 'GET' }, runResultSchema);
}
