import { expect, test } from '@playwright/test';

// ADR 0004: переключение роли на одной учётке. «Новый пользователь» с /demo (личный демо-аккаунт; на общих
// сид-аккаунтах вторую роль не создать) → кандидат → «Я ещё и нанимаю - создать компанию» → режим работодателя и обратно.
test('E-05: кандидат становится работодателем на той же учётке и возвращается', async ({ page }) => {
  test.setTimeout(90_000); // dev-сервер компилирует страницы по первому заходу, на нагруженной машине 30 с мало
  await page.goto('/demo');
  await page.getByRole('checkbox', { name: /Согласен\(на\) на обработку персональных данных/ }).check();
  await page.getByRole('button', { name: 'Новый пользователь' }).click();
  await page.waitForURL('**/consultant');
  // Первая роль — как в знакомстве (тот же API, что шаг «Ты здесь как кто?»).
  expect((await page.request.post('/api/auth/role', { data: { role: 'candidate' } })).ok()).toBe(true);
  // Новый аккаунт по умолчанию попадает в 11-шаговую регистрацию без шапки с переключателем: завершаем её тем же API.
  expect((await page.request.post('/api/auth/onboarding/complete')).ok()).toBe(true);
  await page.goto('/consultant');

  const header = page.getByRole('banner');
  const account = header.getByRole('button', { name: /Аккаунт, активная роль/ });
  // После полной навигации кнопка видна до гидратации и клик теряется — повторяем, пока панель не откроется.
  const openAccount = () =>
    expect(async () => {
      if ((await account.getAttribute('aria-expanded')) !== 'true') await account.click();
      await expect(account).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
  await expect(account).toContainText('Кандидат');
  await openAccount();
  await header.getByRole('button', { name: 'Я ещё и нанимаю - создать компанию' }).click();
  await header.getByLabel('Название компании').fill('ООО Переключатель');
  const switched = page.waitForResponse((r) => r.url().includes('/api/auth/role/switch'));
  await header.getByRole('button', { name: 'Создать' }).click();
  expect((await switched).ok()).toBe(true);
  // Новая роль начинается с регистрации работодателя (11 шагов, без шапки): завершаем её тем же API.
  expect((await page.request.post('/api/auth/onboarding/complete')).ok()).toBe(true);
  // страница ещё может доделывать собственную полную навигацию после переключения - тогда goto прерывается, повторяем
  await expect(async () => {
    await page.goto('/consultant');
  }).toPass({ timeout: 15_000 });
  await expect(account).toContainText('Работодатель', { timeout: 15_000 });
  await openAccount();
  await expect(header.getByRole('button', { name: /^Работодатель · ООО Переключатель/ })).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('Escape');
  // Страница кандидата в режиме работодателя закрыта: редирект в профиль компании.
  await page.goto('/profile');
  await page.waitForURL('**/employer/company');

  await openAccount();
  await header.getByRole('button', { name: 'Кандидат' }).click();
  await expect(account).toContainText('Кандидат', { timeout: 15_000 });
  await openAccount();
  await expect(header.getByRole('button', { name: /Работодатель/ })).toBeVisible();
});
