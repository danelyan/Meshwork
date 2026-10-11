import { expect, test } from '@playwright/test';

import { signInAsDemoCandidate } from './helpers';

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
  // внутри ожидания до 30 + 60 с (шаги и карточки на stub-LLM под нагрузкой): общий лимит 30 с им мало
  test.setTimeout(150_000);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Твой код.');
  // «Приступим» открывает окно входа и сохраняет режим знакомства после входа.
  await page.getByRole('link', { name: /Приступим/ }).first().click();
  await signInAsDemoCandidate(page);
  await page.waitForURL('**/consultant?mode=intake');
  await expect(page.getByRole('heading', { name: 'Карьерный консультант' })).toBeVisible();

  // резюме скрепкой (чип вложения) + ссылка прямо в тексте сообщения
  // до гидратации onChange у input ещё нет и файл теряется молча - повторяем, пока чип не появится
  const chips = page.getByRole('list', { name: 'Вложения' });
  await expect(async () => {
    if (!(await chips.isVisible())) await page.getByTestId('composer').locator('input[type=file]').setInputFiles(RESUME);
    await expect(chips).toContainText(/КБ|МБ/, { timeout: 20_000 });
  }).toPass({ timeout: 60_000 });
  await page.getByLabel('Сообщение', { exact: true }).fill('Собери мне профиль, код — github.com/demo-ryabinin');
  await page.getByRole('button', { name: 'Отправить' }).click();

  // лента шагов появляется, затем карточки утверждений с цитатой, источником и уровнем
  // шаги группируются в блоки между сообщениями: списков с этим именем может быть несколько
  await expect(page.getByRole('list', { name: 'Шаги консультанта' }).first()).toBeVisible({ timeout: 30_000 });
  const cards = page.getByRole('article');
  // на общей БД прошлый прогон уже занёс эти утверждения в профиль: тогда помощник честно пишет «Новых утверждений нет»
  const known = page.getByRole('region', { name: 'Найденные утверждения' }).getByText(/Новых утверждений нет/);
  await expect(cards.first().or(known).first()).toBeVisible({ timeout: 60_000 });
  if (await cards.first().isVisible()) {
    await expect(cards.first().locator('blockquote')).toContainText('«');
    await expect(cards.first().getByText(/Источник:/)).toBeVisible();
    await expect(cards.first().getByText(/Не доказывает:/)).toBeVisible();

    // подтверждаем первое, поправляем второе, отклоняем третье (если есть)
    await cards.first().getByRole('button', { name: 'Да' }).click();
    await expect(cards.first().getByText('Подтверждено')).toBeVisible({ timeout: 30_000 });

    // подтвердить остальные со слов
    const bulk = page.getByRole('button', { name: /Подтвердить все со слов/ });
    if (await bulk.isVisible()) await bulk.click();
  }

  // профиль: утверждения сгруппированы по уровням
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Профиль' }).click();
  await page.waitForURL('**/profile');
  await expect(page.getByRole('link', { name: 'PDF-профиль' })).toHaveAttribute('href', '/api/profile/pdf');
  await expect(page.getByText(/со слов|артефакт/).first()).toBeVisible();
});

test('С1: файл больше 5 МБ отклоняется сообщением, до сервера не уходит', async ({ page }) => {
  await page.goto('/auth');
  await signInAsDemoCandidate(page);
  await page.waitForURL('**/consultant');
  const uploadRequests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/uploads') uploadRequests.push(request.url());
  });
  const oversized = {
    name: 'big.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  };
  // Как в С1 выше: input присутствует в SSR до подключения обработчика onChange.
  await expect(async () => {
    await page.getByTestId('composer').locator('input[type=file]').setInputFiles(oversized);
    await expect(page.getByText(/больше 5 МБ/)).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  expect(uploadRequests).toEqual([]);
});
