import { execSync } from 'node:child_process';

import { resolveTestDatabaseUrl } from '../helpers/test-db-url';

/** Один раз на прогон: применить миграции к тестовой БД (создать её — scripts/db-local.sh create). */
export default function setup() {
  const url = resolveTestDatabaseUrl();
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  });
}
