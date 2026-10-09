import { defineConfig } from '@playwright/test';
import config from './playwright.config';

// Layout-only checks against an already running app, without a database.
export default defineConfig({
  ...config,
  webServer: undefined,
  testMatch: 'consultant-layout.spec.ts',
  projects: [{ name: 'layout', use: { channel: process.env.PLAYWRIGHT_CHANNEL } }],
});
