import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Три проекта (docs: vitest guide/projects):
//  - unit        — tests/unit/**/*.test.ts, Node, без БД;
//  - components  — tests/unit/**/*.test.tsx, jsdom + Testing Library;
//  - integration — tests/integration/**, реальный Postgres (TEST_DATABASE_URL), файлы последовательно.
export default defineConfig({
  plugins: [react()],
  // Алиас @/* из tsconfig: встроенный resolve.tsconfigPaths Vite 8 вместо плагина vite-tsconfig-paths из доки Next.js.
  resolve: { tsconfigPaths: true },
  test: {
    // Демо-флаги стенда из .env не должны протекать в тесты (docs: test.env
    // перекрывает process.env воркеров; process.loadEnvFile не перезаписывает заданное).
    env: { LLM_STUB_DEMO: 'false', COLLECTOR_FIXTURES: 'false', TEST_DEMO_INTERVALS: 'false', MAIL_PROVIDER: 'log' },
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup/unit.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          include: ['tests/unit/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['tests/setup/unit.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup/integration.ts'],
          globalSetup: ['tests/setup/integration-global.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
