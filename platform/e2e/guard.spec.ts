import { expect, test } from '@playwright/test';

import { signInAsDemoCandidate } from './helpers';

// Граница доверия E-02: страницы кандидата без входа не рендерятся — guard ведёт на /auth?next=…
// (окно входа над главной), демо-вход в окне возвращает на исходную страницу. Чужой next (open redirect) игнорируется.
for (const path of ['/consultant', '/profile', '/test']) {
  test(`гость на ${path} → /auth?next → окно входа → обратно на ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForURL(`**/auth?next=${encodeURIComponent(path)}`);
    await signInAsDemoCandidate(page);
    await page.waitForURL(`**${path}`);
  });
}

test('кандидат на /employer → /consultant', async ({ page }) => {
  await page.goto('/auth');
  await signInAsDemoCandidate(page);
  await page.waitForURL('**/consultant');
  await page.goto('/employer');
  await page.waitForURL('**/consultant');
});

test('open redirect: /auth?next=//evil.com игнорируется — вход ведёт на /consultant', async ({ page }) => {
  await page.goto('/auth?next=//evil.com');
  await signInAsDemoCandidate(page);
  await page.waitForURL('**/consultant');
  expect(new URL(page.url()).hostname).toBe('127.0.0.1');
});
