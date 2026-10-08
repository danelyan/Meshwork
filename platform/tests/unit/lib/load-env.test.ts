import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadPlatformEnv } from '../../../scripts/load-env.mjs';

describe('loadPlatformEnv', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  function envFile(body: string) {
    const f = join(mkdtempSync(join(tmpdir(), 'envtest-')), '.env');
    writeFileSync(f, body);
    return f;
  }

  it('DATABASE_URL не задан → читает .env', () => {
    delete process.env.DATABASE_URL;
    delete process.env.POLISH_TEST_VAR;
    const f = envFile('DATABASE_URL=postgresql://x@127.0.0.1:1/mine\nPOLISH_TEST_VAR=1\n');
    expect(loadPlatformEnv(f)).toBe(f);
    expect(process.env.DATABASE_URL).toBe('postgresql://x@127.0.0.1:1/mine');
    expect(process.env.POLISH_TEST_VAR).toBe('1');
  });

  it('DATABASE_URL уже задан → файл не читается и ничего не перезаписывается', () => {
    process.env.DATABASE_URL = 'postgresql://x@127.0.0.1:1/explicit';
    const f = envFile('DATABASE_URL=postgresql://x@127.0.0.1:1/other\n');
    expect(loadPlatformEnv(f)).toBeNull();
    expect(process.env.DATABASE_URL).toBe('postgresql://x@127.0.0.1:1/explicit');
  });

  it('файла нет → null, без ошибки', () => {
    delete process.env.DATABASE_URL;
    expect(loadPlatformEnv('/nonexistent/.env')).toBeNull();
  });
});
