import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { RunResult } from '../../runner/src/contract';
import { dirEntries, makeTarGz, type TarSpec } from '../helpers/tar';

/**
 * runner в настоящем контейнере (compose-сервис runner): uid 1001, задания — uid 2000 через setuid-
 * помощник, сеть internal. Тяжёлый (сборка образа ~1,5 мин) — только по RUNNER_DOCKER=1:
 *   RUNNER_DOCKER=1 npx vitest run --project runner tests/runner/docker.test.ts
 */
const PROJECT = 'fsp-runner-it';
const FIX = path.resolve('tests/fixtures/runner');
const token = 'd'.repeat(48);
let dir: string;
let out: { health: { mode: string }; noauth: number; results: Record<string, RunResult & { rejected?: unknown }> };

const compose = (...args: string[]) =>
  execFileSync('docker', ['compose', '-p', PROJECT, ...args], { env: { ...process.env, RUNNER_TOKEN: token }, stdio: 'pipe', timeout: 600_000 });

describe.runIf(process.env.RUNNER_DOCKER === '1')('runner в Docker (смена uid, internal-сеть)', () => {
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'fsp-runner-docker-'));
    const backend = path.join(FIX, 'backend-solution');
    const real = readFileSync(path.join(backend, 'src/app.js'));
    const withApp = (app: string, extra: TarSpec[] = []) =>
      dirEntries(backend, 'c', extra).map((e) => (e.path.endsWith('/src/app.js') ? { ...e, data: app } : e));
    const files: Record<string, TarSpec[]> = {
      'correct.tgz': dirEntries(backend),
      'frontend.tgz': dirEntries(path.join(FIX, 'frontend-solution')),
      'loop.tgz': withApp('while (true) {}\nexport function createApp() {}\n'),
      'fetch.tgz': withApp(
        "import { createApp as r } from './real.js';\nlet net; try { await fetch('http://1.1.1.1', { signal: AbortSignal.timeout(4000) }); net = 'OPEN'; } catch (e) { net = 'blocked:' + (e.cause?.code ?? e.name); }\nconsole.log('NETCHECK ' + net);\nexport const createApp = r;\n",
        [{ path: 'src/real.js', data: real }],
      ),
      'tamper.tgz': withApp(
        "import fs from 'node:fs';\nimport { execSync } from 'node:child_process';\nimport { createApp as r } from './real.js';\nconst t = (n, f) => { try { f(); console.log('TAMPER ' + n + ' OK'); } catch (e) { console.log('TAMPER ' + n + ' denied'); } };\nt('rewrite-hidden', () => fs.writeFileSync(process.env.FSP_REPO_DIR + '/.platform-tests/notes.hidden.test.js', 'x'));\nt('environ', () => fs.readFileSync('/proc/1/environ'));\nt('kill-service', () => process.kill(1, 0));\nt('templates', () => fs.readdirSync('/opt/runner/templates'));\nt('helper', () => execSync('/opt/runner/bin/fsp-sandbox killall', { stdio: 'pipe' }));\nexport const createApp = r;\n",
        [
          { path: 'src/real.js', data: real },
          { path: '.platform-tests/notes.hidden.test.js', data: "import {it} from 'vitest'; it('fake green', () => {});" },
          { path: 'vitest.config.js', data: "export default { test: { include: ['**/*.test.js'] } };" },
        ],
      ),
    };
    for (const [name, entries] of Object.entries(files)) writeFileSync(path.join(dir, name), makeTarGz(entries));
    writeFileSync(
      path.join(dir, 'cases.json'),
      JSON.stringify([
        { name: 'correct', file: 'correct.tgz', bundle: 'backend-junior-api' },
        { name: 'frontend', file: 'frontend.tgz', bundle: 'frontend-junior-widget' },
        { name: 'loop', file: 'loop.tgz', bundle: 'backend-junior-api', timeoutSec: 5 },
        { name: 'fetch', file: 'fetch.tgz', bundle: 'backend-junior-api' },
        { name: 'tamper', file: 'tamper.tgz', bundle: 'backend-junior-api' },
      ]),
    );
    writeFileSync(path.join(dir, 'client.mjs'), readFileSync(path.resolve('tests/runner/docker-client.mjs')));
    compose('up', '-d', '--build', '--wait', 'runner');
    const stdout = execFileSync(
      'docker',
      ['run', '--rm', '--network', `${PROJECT}_runner-net`, '-e', `TOK=${token}`, '-v', `${dir}:/cases:ro`, '--entrypoint', 'node', `${PROJECT}-runner`, '/cases/client.mjs'],
      { stdio: 'pipe', timeout: 300_000 },
    ).toString();
    out = JSON.parse(stdout.trim().split('\n').at(-1)!);
  }, 900_000);

  afterAll(() => {
    try {
      compose('down');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('контейнерный режим, без токена 401', () => {
    expect(out.health.mode).toBe('container');
    expect(out.noauth).toBe(401);
  });

  it('верные решения зелёные (cp-права тестов платформы не мешают uid 2000)', () => {
    expect(out.results.correct!.summary).toEqual({ total: 13, passed: 13, failed: 0 });
    expect(out.results.frontend!.summary).toEqual({ total: 9, passed: 9, failed: 0 });
  });

  it('while(true) → timeout', () => {
    expect(out.results.loop).toMatchObject({ status: 'failed', reason: 'timeout' });
  });

  it('сети наружу нет', () => {
    expect(out.results.fetch!.logTail).toMatch(/NETCHECK blocked:/);
    expect(out.results.fetch!.summary.passed).toBe(13);
  });

  it('задание не переписывает тесты, не читает окружение и шаблоны, не убивает сервис, не запускает помощник', () => {
    const r = out.results.tamper!;
    expect(r.summary).toEqual({ total: 13, passed: 13, failed: 0 });
    expect(r.tests.some((t) => /fake/.test(t.name))).toBe(false);
    expect(r.logTail).not.toMatch(/TAMPER \S+ OK/);
    for (const n of ['rewrite-hidden', 'environ', 'kill-service', 'templates', 'helper']) expect(r.logTail).toContain(`TAMPER ${n} denied`);
  });
});
