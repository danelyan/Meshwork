import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = resolve('scripts/configure-yandex.sh');
const clientId = 'd'.repeat(32);
const clientSecret = 'e'.repeat(32);
let directory: string;
let envFile: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'meshwork-yandex-config-'));
  envFile = join(directory, '.env');
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function configure(input = `${clientId}\n${clientSecret}\n`) {
  return spawnSync('bash', [script, envFile], { input, encoding: 'utf8' });
}

describe('stand Yandex OAuth configuration', () => {
  it('preserves unrelated settings, restricts permissions and never logs values', () => {
    const original = 'APP_URL=https://fsp2.ru\nSMTP_PASSWORD="test mail fixture"\n# comment\n';
    writeFileSync(envFile, original, { mode: 0o644 });
    const result = configure();
    expect(result.status).toBe(0);
    expect(readFileSync(envFile, 'utf8')).toBe(`${original}YANDEX_CLIENT_ID=${clientId}\nYANDEX_CLIENT_SECRET=${clientSecret}\n`);
    expect(statSync(envFile).mode & 0o777).toBe(0o600);
    expect(result.stdout + result.stderr).not.toContain(clientSecret);
    expect(result.stdout + result.stderr).not.toContain(clientId);
    expect(readdirSync(directory)).toEqual(['.env']);
  });

  it('replaces all old and exported values and is idempotent', () => {
    writeFileSync(envFile, 'YANDEX_CLIENT_ID=old\n export YANDEX_CLIENT_SECRET = old\nYANDEX_CLIENT_SECRET=duplicate\nSESSION_SECRET=test-fixture\n');
    expect(configure().status).toBe(0);
    const firstUpdate = readFileSync(envFile, 'utf8');
    expect(configure().status).toBe(0);
    const content = readFileSync(envFile, 'utf8');
    expect(content).toBe(firstUpdate);
    expect(content.match(/^YANDEX_CLIENT_ID=/gm)).toHaveLength(1);
    expect(content.match(/^YANDEX_CLIENT_SECRET=/gm)).toHaveLength(1);
    expect(content).toContain('SESSION_SECRET=test-fixture');
    expect(content).not.toContain('old');
    expect(content).not.toContain('duplicate');
  });

  it.each([
    'not-an-id\n' + clientSecret + '\n',
    clientId + '\nshort\n',
    clientId + '\n' + 'x'.repeat(16) + '$HOME\n',
    clientId + '\n',
  ])('rejects invalid or incomplete input without touching .env', (input) => {
    const original = 'APP_URL=https://fsp2.ru\n';
    writeFileSync(envFile, original);
    expect(configure(input).status).not.toBe(0);
    expect(readFileSync(envFile, 'utf8')).toBe(original);
    expect(readdirSync(directory)).toEqual(['.env']);
  });

  it('requires an existing .env and refuses symlinks', () => {
    expect(configure().status).not.toBe(0);
    const target = join(directory, 'target');
    writeFileSync(target, 'APP_URL=https://fsp2.ru\n');
    symlinkSync(target, envFile);
    expect(configure().status).not.toBe(0);
    expect(readFileSync(target, 'utf8')).toBe('APP_URL=https://fsp2.ru\n');
  });
});
