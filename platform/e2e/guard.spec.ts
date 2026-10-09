import { expect, test } from '@playwright/test';

// Граница доверия E-02: страницы кандидата без входа не рендерятся — guard ведёт на /auth?next=…,
// демо-вход возвращает на исходную страницу. Чужой next (open redirect) игнорируется.
for (const path of ['/consultant', '/profile', '/test']) {
  test(`гость на ${path} → /auth?next → /demo → вход → обратно на ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForURL(`**/auth?next=${encodeURIComponent(path)}`);
    await page.getByRole('main').getByRole('link', { name: 'Демо для жюри' }).click();
    await page.waitForURL(`**/demo?next=${encodeURIComponent(path)}`);
    await page.getByRole('button', { name: /^Войти как / }).first().click();
    await page.waitForURL(`**${path}`);
  });
}

test('кандидат на /employer → /consultant', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: /^Войти как / }).first().click();
  await page.waitForURL('**/consultant');
  await page.goto('/employer');
  await page.waitForURL('**/consultant');
});

test('open redirect: /auth?next=//evil.com — демо-ссылка без next', async ({ page }) => {
  await page.goto('/auth?next=//evil.com');
  await expect(page.getByRole('main').getByRole('link', { name: 'Демо для жюри' })).toHaveAttribute('href', '/demo');
});
