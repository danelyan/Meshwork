import { expect, test } from '@playwright/test';

// E-02: новый демо-пользователь отмечает согласие на /demo (при регистрации), затем онбординг-чат
// сразу начинается с выбора роли (шаг согласия в чате – только страховка для старых аккаунтов).
// Демо-аккаунты уже онбординговые, поэтому берём «Новый пользователь». Обращение на «ты».
// Знакомство идёт в ленте /consultant – один адрес с чатом (решение владельца 10.10).
test('E-02: /demo → галка согласия → «Новый пользователь» → онбординг с выбора роли', async ({ page }) => {
  await page.goto('/demo');
  const start = page.getByRole('button', { name: 'Новый пользователь' });
  await expect(start).toBeDisabled();
  await page.getByRole('checkbox', { name: /Согласен\(на\) на обработку персональных данных/ }).check();
  await expect(start).toBeEnabled();
  await start.click();
  await page.waitForURL('**/consultant');
  // лента-чат: текущий вопрос помощника – #ob-q; он появляется после «печатает» и посимвольного набора вступления
  // (набор идёт в реальном времени, на нагруженной машине дольше 5 с по умолчанию)
  const question = page.locator('#ob-q');
  await expect(question).toBeVisible({ timeout: 30_000 });
  await expect(question).toContainText(/Ты здесь как кто/);
  await expect(question).not.toContainText(/\b[Вв]ы\b|ваш/);
  await expect(page.getByRole('list', { name: 'Переписка с помощником' })).toBeVisible();
});

// Персона этапа 2 «Павел Нестеров»: знакомство начато, часть ответов уже сохранена, продолжение - в ленте чата.
test('E-02: персона «Знакомство» с /demo открывает ленту знакомства с сохранёнными ответами', async ({ page }) => {
  await page.goto('/demo');
  await page.getByText('Все профили по этапам пути').click();
  await page.getByRole('button', { name: 'Войти как Павел Нестеров' }).first().click();
  await page.waitForURL('**/consultant');
  await expect(page.getByRole('list', { name: 'Переписка с помощником' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Знакомство · пройдено \d+ из \d+ вопрос/i)).toBeVisible();
});
