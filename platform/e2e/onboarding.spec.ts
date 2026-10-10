import { expect, test } from '@playwright/test';

// E-02: новый демо-пользователь отмечает согласие на /demo (при регистрации), затем онбординг-чат
// сразу начинается с выбора роли (шаг согласия в чате — только страховка для старых аккаунтов).
// Демо-аккаунты уже онбординговые, поэтому берём «Новый пользователь». Обращение на «ты».
// Знакомство идёт в ленте /consultant — один адрес с чатом (решение владельца 10.10).
test('E-02: /demo → галка согласия → «Новый пользователь» → онбординг с выбора роли', async ({ page }) => {
  await page.goto('/demo');
  const start = page.getByRole('button', { name: 'Новый пользователь' });
  await expect(start).toBeDisabled();
  await page.getByRole('checkbox', { name: /Согласен\(на\) на обработку персональных данных/ }).check();
  await expect(start).toBeEnabled();
  await start.click();
  await page.waitForURL('**/consultant');
  // лента-чат: текущий вопрос помощника — #ob-q; он появляется после «печатает» и посимвольного набора вступления
  // (набор идёт в реальном времени, на нагруженной машине дольше 5 с по умолчанию)
  const question = page.locator('#ob-q');
  await expect(question).toBeVisible({ timeout: 30_000 });
  await expect(question).toContainText(/Ты здесь как кто/);
  await expect(question).not.toContainText(/\b[Вв]ы\b|ваш/);
  await expect(page.getByRole('list', { name: 'Переписка с помощником' })).toBeVisible();
});

test('E-02: у существующего демо-аккаунта «пройти онбординг заново» открывает чат', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: /^Пройти онбординг заново: / }).first().click();
  await page.waitForURL('**/consultant');
  try {
    await expect(page.locator('#ob-q')).toBeVisible();
  } finally {
    // «Заново» сбрасывает onboardedAt у общего сид-аккаунта (первый демо-профиль, тот же, что берёт
    // consultant.spec): без возврата следующие прогоны на этой БД попадают в чат знакомства, а не в ленту.
    const res = await page.request.post('/api/auth/onboarding/complete');
    expect(res.ok()).toBe(true);
  }
});
