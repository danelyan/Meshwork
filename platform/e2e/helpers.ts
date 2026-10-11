import { expect, type Page } from '@playwright/test';

/**
 * Вход демо-кандидатом через модальное окно входа (оно открывается на `/auth` и по ссылкам на `/auth`):
 * роль не спрашивается — персона этапа 3 «Юлия Власова» (профиль из резюме) из группы «Специалисты». Дальше окно само ведёт на `next` или `/consultant`.
 */
export async function signInAsDemoCandidate(page: Page) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Войти как Юлия Власова' }).click();
}
