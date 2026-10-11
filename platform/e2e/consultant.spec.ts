import { expect, test } from '@playwright/test';

import { signInAsDemoCandidate } from './helpers';

// Сценарий С1 «Первый вход: собери мне профиль» (E-01-career-consultant.md § 3).
// Запускает интегратор: нужны сид демо-кандидатов, collector/agent/claims и LLM_PROVIDER=stub.
// Резюме: по умолчанию крошечный PDF из кода; своё можно задать E2E_RESUME=/path/cv.pdf
// (синтетические резюме лежат в eval/resumes/*.md – их надо сначала сконвертировать в PDF).
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
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Не ищи работу.');
  // Демо доступно отдельной страницей; входим настоящей персоной из её списка.
  await page.getByRole('link', { name: /Для жюри: маршрут/ }).click();
  await signInAsDemoCandidate(page);
  await page.waitForURL(/\/consultant(\?.*)?$/);
  const navigation = page.getByRole('navigation', { name: 'Разделы кабинета' });
  await expect(navigation.getByRole('link', { name: 'Консультант', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('scene-call-side')).toBeVisible();
  await expect(page.getByText('Кира', { exact: true }).first()).toBeVisible();
  const message = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await expect(message).toBeVisible();
  // Без scrollIntoView: поле должно помещаться сразу, иначе shell снова отодвинул ввод за экран.
  await expect.poll(async () => {
    const box = await message.boundingBox();
    const viewport = page.viewportSize();
    return Boolean(box && viewport && box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1);
  }, { message: 'Поле сообщения целиком находится в desktop viewport до загрузки резюме' }).toBe(true);
  const history = page.getByRole('region', { name: 'История разговора', exact: true });
  const composer = page.getByTestId('composer');
  const demoNote = page.getByRole('note').filter({ hasText: 'Демо-режим без языковой модели' }).first();
  await expect(history).toBeVisible();
  await expect.poll(async () => (await history.boundingBox())?.height ?? 0, {
    message: 'История разговора сохраняет не меньше 120px высоты на desktop',
  }).toBeGreaterThan(120);
  await expect.poll(async () => {
    const [historyBox, composerBox, noteBox] = await Promise.all([history.boundingBox(), composer.boundingBox(), demoNote.boundingBox()]);
    return Boolean(historyBox && composerBox && noteBox && historyBox.y + historyBox.height <= composerBox.y + 1 && noteBox.y + noteBox.height <= historyBox.y + 1);
  }, { message: 'История разговора размещена между демо-пометкой и composer без перекрытия' }).toBe(true);


  // резюме скрепкой (чип вложения) + ссылка прямо в тексте сообщения
  // до гидратации onChange у input ещё нет и файл теряется молча - повторяем, пока чип не появится
  const chips = page.getByRole('list', { name: 'Вложения' });
  await expect(async () => {
    if (!(await chips.isVisible())) await page.getByTestId('composer').locator('input[type=file]').setInputFiles(RESUME);
    await expect(chips).toContainText(/КБ|МБ/, { timeout: 20_000 });
  }).toPass({ timeout: 60_000 });
  const claimRegions = page.getByRole('region', { name: 'Найденные утверждения' });
  const previousClaimRegions = await claimRegions.count();
  await message.fill('Собери мне профиль, код - github.com/demo-ryabinin');
  await page.getByRole('button', { name: 'Отправить' }).click();

  // лента шагов появляется, затем карточки утверждений с цитатой, источником и уровнем
  // шаги группируются в блоки между сообщениями: списков с этим именем может быть несколько
  await expect(page.getByRole('list', { name: 'Шаги консультанта' }).first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => claimRegions.count(), { timeout: 60_000 }).toBeGreaterThan(previousClaimRegions);
  const latestClaims = claimRegions.last();
  const cards = latestClaims.getByRole('article');
  const known = latestClaims.getByText(/Новых утверждений нет/);
  // Повторный прогон допускает уже известное; чистый QA-прогон требует новых карточек и клика Да.
  const requireNew = process.env.E2E_REQUIRE_NEW_CLAIMS === 'true';
  let confirmedClaim: { statement: string; level: string } | null = null;
  await expect(requireNew ? cards.first() : cards.first().or(known).first()).toBeVisible({ timeout: 60_000 });
  if (await cards.first().isVisible()) {
    await expect(cards.first().locator('blockquote').or(cards.first().getByText('Дословно из вашего документа'))).toBeVisible();
    await expect(cards.first().getByText(/Источник:/)).toBeVisible();
    await expect(cards.first().getByText(/Не доказывает:/)).toBeVisible();
    const fresh = cards.filter({ has: page.getByRole('button', { name: 'Да', exact: true }) }).first();
    if (requireNew) await expect(fresh).toBeVisible();
    if (await fresh.isVisible()) {
      const name = (await fresh.getAttribute('aria-label')) ?? '';
      const level = await fresh.locator('[data-level]').getAttribute('data-level');
      expect(level).toBeTruthy();
      confirmedClaim = { statement: name.replace(/^Утверждение:\s*/, ''), level: level! };
      await fresh.getByRole('button', { name: 'Да', exact: true }).click();
      await expect(latestClaims.getByRole('article', { name, exact: true }).getByText('Подтверждено')).toBeVisible({ timeout: 30_000 });
    }
    const bulk = latestClaims.getByRole('button', { name: /Подтвердить все со слов/ });
    if (await bulk.isVisible()) await bulk.click();
  }

  // профиль: утверждения сгруппированы по уровням
  await page.getByRole('navigation', { name: 'Разделы кабинета' }).getByRole('link', { name: 'Профиль' }).click();
  await page.waitForURL('**/profile');
  await expect(page.getByRole('link', { name: 'PDF-профиль', exact: true })).toHaveAttribute('href', '/api/profile/pdf');
  const evidence = page.getByRole('region', { name: 'Утверждения о навыках', exact: true });
  await expect(evidence).toBeVisible();
  if (confirmedClaim) {
    await expect(evidence.getByText(confirmedClaim.statement, { exact: true })).toBeVisible();
    await expect(evidence.locator(`[data-level="${confirmedClaim.level}"]`)).toBeVisible();
    const persistedClaim = evidence.getByRole('listitem').filter({ has: page.getByText(confirmedClaim.statement, { exact: true }) });
    await expect(persistedClaim.getByRole('button', { name: 'Да', exact: true })).toHaveCount(0);
  } else {
    await expect(evidence.locator('[data-level]').first()).toBeVisible();
  }
});

test('С1: файл больше 5 МБ отклоняется сообщением, до сервера не уходит', async ({ page }) => {
  await page.goto('/demo');
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
