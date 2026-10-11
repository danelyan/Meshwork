import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Четыре проекта (docs: vitest guide/projects):
//  - unit        — tests/unit/**/*.test.ts, Node, без БД;
//  - components  — tests/unit/**/*.test.tsx, jsdom + Testing Library;
//  - runner      — tests/runner/**/*.test.ts, Node, файлы последовательно (npm run test:runner);
//  - integration — tests/integration/**, реальный Postgres (TEST_DATABASE_URL), файлы последовательно.
export default defineConfig({
  plugins: [react()],
  // Алиас @/* из tsconfig: встроенный resolve.tsconfigPaths Vite 8 вместо плагина vite-tsconfig-paths из доки Next.js.
  resolve: {
    tsconfigPaths: true,
    // `server-only` (session.ts, auth/page.ts, auth/access.ts): Next.js подставляет его сам, пакета в
    // зависимостях нет (docs Next.js: установка необязательна). В тестах — пустой модуль из сборки Next,
    // тот же, что Next отдаёт серверному коду (условие react-server).
    alias: { 'server-only': fileURLToPath(new URL('./node_modules/next/dist/compiled/server-only/empty.js', import.meta.url)) },
  },
  test: {
    // Демо-флаги стенда из .env не должны протекать в тесты (docs: test.env
    // перекрывает process.env воркеров; process.loadEnvFile не перезаписывает заданное).
    env: { LLM_STUB_DEMO: 'false', COLLECTOR_FIXTURES: 'false', TEST_DEMO_INTERVALS: 'false', JURY_INSIGHTS: 'false', TEST_INTEGRITY_ACTION: 'silent', MAIL_PROVIDER: 'log' },
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
        // lane runner: сервис автопроверки в локальном режиме (настоящие процессы vitest, ~30 с).
        // Нужен npm ci в runner/sandbox/node; запуск — npm run test:runner.
        extends: true,
        test: {
          name: 'runner',
          include: ['tests/runner/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 60_000,
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
