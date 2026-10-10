import { expect, test } from '@playwright/test';

// ADR 0004: переключение роли на одной учётке. «Новый пользователь» с /demo (личный демо-аккаунт; на общих
// сид-аккаунтах вторую роль не создать) → кандидат → «Стать работодателем» → режим работодателя и обратно.
test('E-05: кандидат становится работодателем на той же учётке и возвращается', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('checkbox', { name: /Согласен\(на\) на обработку персональных данных/ }).check();
  await page.getByRole('button', { name: 'Новый пользователь' }).click();
  await page.waitForURL('**/consultant');
  // Первая роль — как в знакомстве (тот же API, что шаг «Ты здесь как кто?»).
  expect((await page.request.post('/api/auth/role', { data: { role: 'candidate' } })).ok()).toBe(true);
  await page.goto('/consultant');

  const header = page.getByRole('banner');
  const account = header.getByRole('button', { name: /Аккаунт, активная роль/ });
  await expect(account).toContainText('Кандидат');
  await account.click();
  await header.getByRole('button', { name: 'Работодатель' }).click();
  await header.getByLabel('Название компании').fill('ООО Переключатель');
  await header.getByRole('button', { name: 'Создать' }).click();

  await page.waitForURL('**/consultant');
  await expect(account).toContainText('Работодатель', { timeout: 15_000 });
  await account.click();
  await expect(header.getByRole('button', { name: /^Работодатель · ООО Переключатель/ })).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('Escape');
  // Страница кандидата в режиме работодателя закрыта: редирект в профиль компании.
  await page.goto('/profile');
  await page.waitForURL('**/employer/company');

  await account.click();
  await header.getByRole('button', { name: 'Кандидат' }).click();
  await expect(account).toContainText('Кандидат', { timeout: 15_000 });
  await account.click();
  await expect(header.getByRole('button', { name: /Работодатель/ })).toBeVisible();
});
