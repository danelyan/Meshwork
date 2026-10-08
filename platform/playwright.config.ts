import { defineConfig, devices } from '@playwright/test';

// Сквозные сценарии (С1 и др.). Запуск — интегратор: `npm run build && npm run e2e`.
// Локально поднимает `next dev`, в CI — `next start` (по default-config Next.js testmode).
const PORT = Number(process.env.E2E_PORT ?? 3100);
const isCI = process.env.CI === 'true';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
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
  },
});
