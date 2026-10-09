import { expect, test, type Page } from '@playwright/test';

// R-E-03..R-E-07: вход работодателя через /auth → подборка по потребности → приглашение →
// кандидат из пула принимает → работодатель видит контакты. Нужен сид (db:seed: auth, employer, recommend, claims).
// Запускает интегратор; сценарий переживает повторный прогон (если приглашение уже есть — шаг отправки пропускается).
const EMPLOYER = /Анна Кравец/;
const POOL_TOP = 'Глеб Соколов'; // первый в подборке по потребности «Backend платежей» (demo-vac-be-m-1)
const VACANCY_URL = '**/employer/needs/demo-vac-be-m-1';

async function loginFromAuth(page: Page, name: RegExp | string, landing: string) {
  await page.goto('/auth');
  // кандидаты пула работодателя свёрнуты в <details>; открываем, если нужный лежит там
  const button = page.getByRole('button', { name: typeof name === 'string' ? `Войти как Демо: ${name}` : name });
  if (!(await button.isVisible())) await page.getByText(/ещё \d+ кандидат/).click();
  await button.click();
  await page.waitForURL(landing);
}

test('E-02: на /auth основной список короткий, кандидаты для подборки свёрнуты', async ({ page }) => {
  await page.goto('/auth');
  const more = page.getByText(/ещё \d+ кандидат\S* для подборки/);
  await expect(more).toBeVisible();
  const details = page.locator('details', { has: more });
  expect(await details.evaluate((el: HTMLDetailsElement) => el.open)).toBe(false);
  await more.click();
  await expect(details.getByRole('button', { name: /^Войти как / }).first()).toBeVisible();
});

test('E-02: работодатель → подборка → приглашение → кандидат принимает → контакты открыты', async ({ page }) => {
  // 1. работодатель: подборка по потребности
  await loginFromAuth(page, new RegExp(`Войти как .*${EMPLOYER.source}`), '**/employer');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto('/employer/needs/demo-vac-be-m-1');
  await page.waitForURL(VACANCY_URL);
  const cards = page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3 }) });
  const top = cards.first();
  const alreadyAccepted = await top.getByText(/Приглашение принято. Контакты:/).isVisible();
  if (!alreadyAccepted) await expect(top.getByRole('heading', { level: 3 })).toContainText(/Кандидат #[0-9A-F]{6}/);
  // тип источника виден, ссылок и цитат нет (R-E-07)
  await expect(top.getByText(/доказано: (GitHub|Codeforces|Stack Overflow|статья|ФСП)/).first()).toBeVisible();
  if (!alreadyAccepted) await expect(top).not.toContainText(POOL_TOP);

  // 2. приглашение (если ещё не отправлено)
  const invite = top.getByRole('button', { name: /^Пригласить:/ });
  if (await invite.isVisible()) {
    await invite.click();
    await top.getByLabel('Что предлагаешь').fill('Платёжная команда, Go и Kafka, удалёнка');
    await top.getByLabel(/Зарплата/).fill('230000');
    await top.getByRole('button', { name: 'Отправить приглашение' }).click();
    await expect(top.getByText(/Приглашение:/)).toBeVisible();
  }

  // 3. кандидат принимает
  await loginFromAuth(page, POOL_TOP, '**/consultant');
  await page.goto('/invitations');
  const accept = page.getByRole('button', { name: 'Принять' }).first();
  if (await accept.isVisible()) await accept.click();
  await expect(page.getByText(/Приглашение принято/).first()).toBeVisible();

  // 4. работодатель видит имя и контакты
  await loginFromAuth(page, new RegExp(`Войти как .*${EMPLOYER.source}`), '**/employer');
  await page.goto('/employer/needs/demo-vac-be-m-1');
  await expect(page.getByText(POOL_TOP).first()).toBeVisible();
  await expect(page.getByText(/Приглашение принято. Контакты:/)).toBeVisible();
});
