import { defineConfig, devices } from '@playwright/test';

// Сквозные сценарии (С1 и др.). Запуск — интегратор: `npm run build && npm run e2e`.
// Локально поднимает `next dev`, в CI — `next start` (по default-config Next.js testmode).
const PORT = Number(process.env.E2E_PORT ?? 3100);
const isCI = process.env.CI === 'true';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  // dev-сервер компилирует страницы по первому заходу, машина слабая: 5 с на ожидание (по умолчанию) мало
  expect: { timeout: 15_000 },
  timeout: 60_000,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: isCI ? `npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
    // Не зависим от .env: адрес приложения совпадает с baseURL теста, LLM без ключей размечает по словарю каталога.
    env: { APP_URL: `http://127.0.0.1:${PORT}`, LLM_PROVIDER: 'stub', LLM_STUB_DEMO: 'true', DEMO_LOGIN: 'true' },
  },
});
