import { existsSync } from 'node:fs';

/**
 * URL тестовой БД: TEST_DATABASE_URL из окружения или .env, иначе fsp_test_foundation.
 * Защита: имя БД обязано содержать "test" — тесты её очищают.
 */
export function resolveTestDatabaseUrl(): string {
  if (!process.env.TEST_DATABASE_URL && existsSync('.env')) {
    try {
      process.loadEnvFile('.env');
    } catch {
      /* нет .env — ок */
    }
  }
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54329/fsp_test_foundation';
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.includes('test')) {
    throw new Error(`TEST_DATABASE_URL должен указывать на тестовую БД (в имени "test"), получено: ${dbName}`);
  }
  return url;
}
