import { expect, test } from '@playwright/test';

// Новый пользователь создаётся только через Яндекс ID (демо-вход на /demo выдаёт уже онбординговых), поэтому
// здесь — порядок ленты у демо-кандидата с уже известной ролью (регрессия E-02: роль из аккаунта
// не показывается «ответом» выше текущего вопроса, обращение на «ты»).
test('E-02: онбординг — роль из аккаунта не выше текущего вопроса, обращение на «ты»', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: /^Войти как / }).first().click();
  await page.waitForURL('**/consultant');
  await page.goto('/onboarding');
  // лента-чат: текущий вопрос помощника — #ob-q (появляется после «печатает»)
  const question = page.locator('#ob-q');
  await expect(question).toBeVisible();
  await expect(question).not.toHaveText('Кто ты на платформе?');
  const history = page.getByRole('list', { name: 'Переписка с помощником' });
  if (await history.isVisible()) {
    // шаг, закрытый фактом из аккаунта, ещё не наступил, пока перед ним есть открытый вопрос
    const firstQuestion = await question.innerText();
    if (/согласие|данными/i.test(firstQuestion)) await expect(history).not.toContainText('Ищу работу');
  }
  await expect(question).not.toContainText(/\b[Вв]ы\b|ваш/);
});
