import { describe, expect, it, vi } from 'vitest';

import { downloadGithubTarball, getRun, parseGithubRepoUrl, submitRun } from '@/server/runner/client';

const token = 'k'.repeat(40);
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const doneResult = {
  jobId: 'b'.repeat(32),
  status: 'done',
  tests: [{ name: 'health', passed: true, ms: 3 }],
  summary: { total: 1, passed: 1, failed: 0 },
  logTail: '',
  durationMs: 900,
  exitCode: 0,
  testsBundleRef: 'backend-junior-api',
  commitSha: 'abcdef1',
  image: 'node20',
  createdAt: '2026-10-10T12:00:00.000Z',
};

describe('runner client: ссылка на репозиторий', () => {
  it.each([
    ['https://github.com/octo/notes-api', { owner: 'octo', repo: 'notes-api' }],
    ['https://github.com/octo/notes-api.git', { owner: 'octo', repo: 'notes-api' }],
    ['https://github.com/octo/notes-api/', { owner: 'octo', repo: 'notes-api' }],
  ])('%s', (url, expected) => {
    expect(parseGithubRepoUrl(url)).toEqual(expected);
  });

  it.each([
    'http://github.com/octo/r',
    'https://gitlab.com/octo/r',
    'https://github.com/octo',
    'https://github.com/octo/r/tree/main',
    'https://user:pass@github.com/octo/r',
    'https://github.com:8443/octo/r',
    'https://github.com/-bad/r',
    'https://github.com/octo/..',
  ])('отклоняет %s', (url) => {
    expect(parseGithubRepoUrl(url)).toBeNull();
  });
});

describe('runner client: submitRun / getRun', () => {
  it('загрузка архива, затем /run со ссылкой upload:<id> и Bearer-токеном', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith('/uploads')) return json(201, { uploadId: 'a'.repeat(32), bytes: 3, sha256: 'c'.repeat(64) });
      return json(202, { jobId: 'b'.repeat(32) });
    });
    const downloadTarball = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const res = await submitRun(
      { source: { kind: 'github', repoUrl: 'https://github.com/octo/notes-api' }, commitSha: 'ABCDEF1', testsBundleRef: 'backend-junior-api', image: 'node20' },
      { baseUrl: 'http://runner:8090/', token, fetch: fetchMock as unknown as typeof fetch, downloadTarball },
    );
    expect(res).toEqual({ jobId: 'b'.repeat(32) });
    expect(downloadTarball).toHaveBeenCalledWith({ owner: 'octo', repo: 'notes-api' }, 'abcdef1');
    expect(calls.map((c) => c.url)).toEqual(['http://runner:8090/uploads', 'http://runner:8090/run']);
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({
      repoTarballUrl: `upload:${'a'.repeat(32)}`,
      commitSha: 'abcdef1',
      testsBundleRef: 'backend-junior-api',
      image: 'node20',
    });
  });

  it('не на GitHub — 400 до скачивания', async () => {
    await expect(
      submitRun(
        { source: { kind: 'github', repoUrl: 'https://evil.example/x' }, commitSha: 'abcdef1', testsBundleRef: 'backend-junior-api', image: 'node20' },
        { baseUrl: 'http://runner:8090', token, fetch: vi.fn() as unknown as typeof fetch },
      ),
    ).rejects.toMatchObject({ code: 'bad_request', status: 400 });
  });

  it('без настройки — runner_unavailable 503', async () => {
    await expect(getRun('b'.repeat(32), { baseUrl: '', token: '' })).rejects.toMatchObject({ code: 'runner_unavailable', status: 503 });
    await expect(getRun('b'.repeat(32), { baseUrl: 'http://r', token: 'short' })).rejects.toMatchObject({ status: 503 });
  });

  it('getRun валидирует ответ и переводит 404 в not_found', async () => {
    const ok = vi.fn(async () => json(200, doneResult));
    expect((await getRun('b'.repeat(32), { baseUrl: 'http://r', token, fetch: ok as unknown as typeof fetch })).summary.passed).toBe(1);
    const missing = vi.fn(async () => json(404, { error: 'job_not_found', message: 'нет' }));
    await expect(getRun('b'.repeat(32), { baseUrl: 'http://r', token, fetch: missing as unknown as typeof fetch })).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    });
    const broken = vi.fn(async () => json(200, { status: 'weird' }));
    await expect(getRun('b'.repeat(32), { baseUrl: 'http://r', token, fetch: broken as unknown as typeof fetch })).rejects.toMatchObject({
      code: 'runner_unavailable',
    });
    await expect(getRun('../etc', { baseUrl: 'http://r', token })).rejects.toMatchObject({ code: 'bad_request' });
  });
});

describe('runner client: скачивание через SSRF-фильтр', () => {
  it('api.github.com, указывающий на внутренний адрес, не скачивается', async () => {
    const resolve = vi.fn(async () => [{ address: '10.0.0.5', family: 4 }]);
    await expect(downloadGithubTarball({ owner: 'octo', repo: 'r' }, 'abcdef1', resolve)).rejects.toMatchObject({ code: 'blocked_url' });
  });

  it('commitSha проверяется до сети', async () => {
    await expect(downloadGithubTarball({ owner: 'octo', repo: 'r' }, 'main')).rejects.toMatchObject({ code: 'bad_request' });
  });
});
