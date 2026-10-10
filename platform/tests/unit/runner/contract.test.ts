import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../../runner/src/config';
import { parseBundleRef, runRequestSchema } from '../../../runner/src/contract';
import { buildCommand, macSandboxProfile } from '../../../runner/src/sandbox';
import { tokenMatches } from '../../../runner/src/server';
import { ownedPrefix } from '../../../runner/src/templates';

const valid = {
  repoTarballUrl: `upload:${'a'.repeat(32)}`,
  commitSha: 'ABCDEF1',
  testsBundleRef: 'backend-junior-api',
  image: 'node20',
  timeoutSec: 60,
};

describe('runner contract: POST /run', () => {
  it('принимает валидный запрос, sha в нижнем регистре', () => {
    expect(runRequestSchema.parse(valid).commitSha).toBe('abcdef1');
  });

  it.each([
    ['чужая схема ссылки', { repoTarballUrl: 'https://evil.example/x.tgz' }],
    ['file://', { repoTarballUrl: 'file:///etc/passwd' }],
    ['sha не hex', { commitSha: 'main' }],
    ['образ не из списка', { image: 'ubuntu' }],
    ['таймаут больше 300', { timeoutSec: 301 }],
    ['таймаут меньше 5', { timeoutSec: 1 }],
    ['путь в bundle', { testsBundleRef: '../etc' }],
    ['лишнее поле', { env: { A: '1' } }],
  ])('отклоняет: %s', (_n, patch) => {
    expect(runRequestSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it('testsBundleRef: hidden по умолчанию, visible явно', () => {
    expect(parseBundleRef('backend-junior-api')).toEqual({ templateId: 'backend-junior-api', suite: 'hidden' });
    expect(parseBundleRef('backend-junior-api:visible')).toEqual({ templateId: 'backend-junior-api', suite: 'visible' });
    expect(parseBundleRef('x:secret')).toBeNull();
  });

  it('platformOwned: только точный путь или каталог/**', () => {
    expect(ownedPrefix('tests/visible/**')).toBe('tests/visible');
    expect(ownedPrefix('contract.md')).toBe('contract.md');
    expect(ownedPrefix('../x/**')).toBeNull();
    expect(ownedPrefix('src/*.js')).toBeNull();
  });
});

describe('runner auth', () => {
  const token = 't'.repeat(40);
  it('Bearer с точным совпадением', () => {
    expect(tokenMatches(token, `Bearer ${token}`)).toBe(true);
    expect(tokenMatches(token, `Bearer ${token}x`)).toBe(false);
    expect(tokenMatches(token, token)).toBe(false);
    expect(tokenMatches(undefined, `Bearer ${token}`)).toBe(false);
  });

  it('короткий RUNNER_TOKEN — ошибка конфигурации', () => {
    expect(() => loadConfig({ RUNNER_TOKEN: 'short' })).toThrow(/32/);
  });
});

describe('runner sandbox: команда задания', () => {
  const cfg = loadConfig(
    { RUNNER_TOKEN: 's'.repeat(40), RUNNER_NODE_BIN: '/usr/local/bin/node', RUNNER_SANDBOX_HELPER: '/opt/runner/bin/fsp-sandbox' },
    '/srv/platform',
  );
  const spec = {
    jobDir: '/work/jobs/j',
    repoDir: '/work/jobs/j/repo',
    tmpDir: '/work/jobs/j/tmp',
    outDir: '/work/jobs/j/out',
    image: 'node20' as const,
    testEnvironment: 'node' as const,
    timeoutSec: 30,
  };

  it('контейнер: смена uid через setuid-помощник, лимит процессов, окружение без секретов сервиса', () => {
    const cmd = buildCommand(cfg, spec, { container: true, platform: 'linux' });
    expect(cmd.file).toBe('/opt/runner/bin/fsp-sandbox');
    expect(cmd.helper).toBe('/opt/runner/bin/fsp-sandbox');
    expect(cmd.args.slice(0, 3)).toEqual(['exec', '/bin/sh', '-c']);
    expect(cmd.args.slice(4, 10)).toEqual(['fsp-job', '35', String((64 * 1024 * 1024) / 512), '512', '256', '-']);
    expect(Object.keys(cmd.env).sort()).toEqual(
      ['CI', 'FSP_CACHE_DIR', 'FSP_REPO_DIR', 'FSP_REPORT_FILE', 'FSP_TEST_ENV', 'HOME', 'LANG', 'NODE_OPTIONS', 'NODE_PATH', 'NO_COLOR', 'PATH', 'TMPDIR', 'TZ'].sort(),
    );
    expect(JSON.stringify(cmd.env)).not.toContain('s'.repeat(40));
    expect(cmd.args).toContain('--config');
    expect(cmd.args).toContain(cfg.vitestConfig);
    expect(cmd.args).not.toContain('install');
  });

  it('python: RLIMIT_AS и конфиг pytest платформы', () => {
    const cmd = buildCommand(cfg, { ...spec, image: 'python312' }, { container: true, platform: 'linux' });
    expect(cmd.args[9]).toBe(String(768 * 1024));
    expect(cmd.args).toContain('-c');
    expect(cmd.args).toContain('/work/jobs/j/repo/.platform-tests');
    expect(cmd.env.PYTEST_DISABLE_PLUGIN_AUTOLOAD).toBe('1');
  });

  it('локально на macOS: sandbox-exec, без смены uid и без RLIMIT_NPROC', () => {
    const local = loadConfig({ RUNNER_LOCAL: '1' }, '/srv/platform');
    const cmd = buildCommand(local, spec, { container: false, platform: 'darwin' });
    expect(cmd.file).toBe('/usr/bin/sandbox-exec');
    expect(cmd.helper).toBeUndefined();
    expect(cmd.args[1]).toBe(macSandboxProfile([spec.tmpDir, spec.outDir]));
    expect(cmd.args[1]).toContain('(deny network-outbound');
    expect(cmd.args.slice(5, 11)).toEqual(['fsp-job', '35', String((64 * 1024 * 1024) / 512), '512', '-', '-']);
  });
});
