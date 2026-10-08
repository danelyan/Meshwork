import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

// С prisma.config.ts Prisma CLI не читает .env сам (docs: Prisma Config) —
// грузим встроенным в Node process.loadEnvFile, без dotenv.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
});
