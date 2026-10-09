import { expect, test } from '@playwright/test';

// Сценарий С1 «Первый вход: собери мне профиль» (E-01-career-consultant.md § 3).
// Запускает интегратор: нужны сид демо-кандидатов, collector/agent/claims и LLM_PROVIDER=stub.
// Резюме: по умолчанию крошечный PDF из кода; своё можно задать E2E_RESUME=/path/cv.pdf
// (синтетические резюме лежат в eval/resumes/*.md — их надо сначала сконвертировать в PDF).
const RESUME: string | { name: string; mimeType: string; buffer: Buffer } = process.env.E2E_RESUME ?? {
  name: 'cv.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
      '4 0 obj<</Length 58>>stream\nBT /F1 12 Tf 10 50 Td (Backend developer. Node.js REST API.) Tj ET\nendstream endobj\n' +
      '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF',
  ),
};

test('С1: вход → резюме и ссылка → шаги → карточки → подтверждение → профиль', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Твой код.');
  // главная ведёт на /auth (только Яндекс ID); демо-аккаунты лежат на /demo (DEMO_LOGIN=true)
  await page.getByRole('link', { name: /Приступим/ }).first().click();
  await page.waitForURL('**/auth');
  await expect(page.getByRole('button', { name: /^Войти как / })).toHaveCount(0);
  await page.getByRole('main').getByRole('link', { name: 'Демо для жюри' }).click(); // в подвале такая же ссылка
  await page.waitForURL('**/demo');

  // демо-вход за первого кандидата
  await page.getByRole('button', { name: /^Войти как / }).first().click();
  await page.waitForURL('**/consultant');
  await expect(page.getByRole('heading', { name: 'Карьерный консультант' })).toBeVisible();

  // резюме скрепкой (чип вложения) + ссылка прямо в тексте сообщения
  await page.setInputFiles('input[type=file]', RESUME);
  await expect(page.getByRole('list', { name: 'Вложения' })).toContainText(/КБ|МБ/);
  await page.getByLabel('Сообщение', { exact: true }).fill('Собери мне профиль, код — github.com/demo-ryabinin');
  await page.getByRole('button', { name: 'Отправить' }).click();

  // лента шагов появляется, затем карточки утверждений с цитатой, источником и уровнем
  await expect(page.getByRole('list', { name: 'Шаги консультанта' })).toBeVisible({ timeout: 30_000 });
  const cards = page.getByRole('article');
  await expect(cards.first()).toBeVisible({ timeout: 60_000 });
  await expect(cards.first().locator('blockquote')).toContainText('«');
  await expect(cards.first().getByText(/Источник:/)).toBeVisible();
  await expect(cards.first().getByText(/Не доказывает:/)).toBeVisible();

  // подтверждаем первое, поправляем второе, отклоняем третье (если есть)
  await cards.first().getByRole('button', { name: 'Да' }).click();
  await expect(cards.first().getByText('Подтверждено')).toBeVisible();

  // подтвердить остальные со слов
  const bulk = page.getByRole('button', { name: /Подтвердить все со слов/ });
  if (await bulk.isVisible()) await bulk.click();

  // профиль: утверждения сгруппированы по уровням
  await page.getByRole('link', { name: 'Профиль' }).click();
  await page.waitForURL('**/profile');
  await expect(page.getByRole('button', { name: 'Печать / PDF' })).toBeVisible();
  await expect(page.getByText(/со слов|артефакт/).first()).toBeVisible();
});

test('С1: файл больше 5 МБ отклоняется сообщением, до сервера не уходит', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: /^Войти как / }).first().click();
  await page.waitForURL('**/consultant');
  await page.setInputFiles('input[type=file]', {
    name: 'big.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(page.getByText(/больше 5 МБ/)).toBeVisible();
});
