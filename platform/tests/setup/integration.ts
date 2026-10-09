import { resolveTestDatabaseUrl } from '../helpers/test-db-url';

// До импорта src/server/db: Prisma читает DATABASE_URL при создании клиента.
process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.SESSION_SECRET ??= 'integration-test-secret-integration-0000';
process.env.LLM_PROVIDER = 'stub';
process.env.DEMO_LOGIN ??= 'true';
