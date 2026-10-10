import { expect, type Page } from '@playwright/test';

/**
 * Вход демо-кандидатом через модальное окно входа (оно открывается на `/auth` и по ссылкам на `/auth`):
 * шаг 1 — роль «Ищу работу», шаг 2 — первый демо-профиль. Дальше окно само ведёт на `next` или `/consultant`.
 */
export async function signInAsDemoCandidate(page: Page) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /Ищу работу/ }).click();
  await dialog.getByRole('button', { name: /Продолжить/ }).click();
  await dialog.getByRole('region', { name: 'Демо-профиль' }).getByRole('button', { name: / →$/ }).first().click();
}
