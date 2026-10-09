import { expect, test } from '@playwright/test';

// E-02: новый демо-пользователь проходит онбординг-чат с согласия (демо-аккаунты уже онбординговые,
// поэтому берём «Новый пользователь» на /demo). Роль спрашивает сам чат; обращение на «ты».
test('E-02: /demo → «Новый пользователь» → онбординг с согласия', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Новый пользователь' }).click();
  await page.waitForURL('**/onboarding');
  // лента-чат: текущий вопрос помощника — #ob-q (появляется после «печатает»)
  const question = page.locator('#ob-q');
  await expect(question).toBeVisible();
  await expect(question).toContainText(/согласи|данн/i);
  await expect(question).not.toContainText(/\b[Вв]ы\b|ваш/);
  // согласие → следующий вопрос — роль
  await page.getByRole('button', { name: /соглас/i }).first().click();
  await expect(question).toContainText(/Кто ты на платформе/);
  await expect(page.getByRole('list', { name: 'Переписка с помощником' })).toBeVisible();
});

test('E-02: у существующего демо-аккаунта «пройти онбординг заново» открывает чат', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: /^Пройти онбординг заново: / }).first().click();
  await page.waitForURL('**/onboarding');
  await expect(page.locator('#ob-q')).toBeVisible();
});
