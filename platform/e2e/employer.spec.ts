import { PrismaClient } from '@prisma/client';
import { expect, test, type Page } from '@playwright/test';

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// R-E-03..R-E-07: вход работодателя через /demo → подборка по потребности → приглашение →
// кандидат из пула принимает → работодатель видит контакты. Нужен сид (db:seed: auth, employer, recommend, claims).
// Запускает интегратор; сценарий переживает повторный прогон (если приглашение уже есть – шаг отправки пропускается).
const POOL_TOP = 'Глеб Соколов'; // первый в подборке по потребности «Backend платежей» (demo-vac-be-m-1)
// кандидаты пула по Frontend: E-02 их не приглашает, поэтому имена у них скрыты в любом порядке прогона
const FRONTEND_POOL = ['Никита Захаров', 'Вера Лебедева', 'Тимур Гусев', 'Алина Морозова'];
const VACANCY_URL = '**/employer/needs/demo-vac-be-m-1';

// Тест создаёт потребность «E2E …» в той же БД, что и dev-сервер (DATABASE_URL из .env), - убираем за собой,
// иначе мусор виден на «Моей карте» и в подборке. Заодно подчищаем хвосты упавших прогонов.
test.afterAll(async () => {
  const envFile = resolve(__dirname, '../.env');
  if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
  const db = new PrismaClient();
  try {
    await db.vacancy.deleteMany({ where: { title: { startsWith: 'E2E ' }, company: { isDemo: true } } });
  } finally {
    await db.$disconnect();
  }
});

// Работодатель входит персоной с /demo; кандидат пула в списки входа не попадает (решение владельца 11.10) -
// его аккаунт открывает тот же API, что кнопки входа.
async function loginAsEmployer(page: Page) {
  await page.goto('/demo');
  await page.getByRole('button', { name: /^Войти как .*Анна Кравец/ }).first().click();
  // Дом работодателя: помощник (10.10) или подборка – первый шаг маршрута жюри на /demo ведёт в /employer (11.10).
  await page.waitForURL(/\/(consultant|employer(\/search)?)(\?.*)?$/);
}

async function loginAsPoolCandidate(page: Page, candidateId: string) {
  const res = await page.request.post('/api/demo/login', { data: { candidateId } });
  expect(res.ok()).toBe(true);
}

test('E-02: на /demo персоны по этапам, кандидаты пула в списках входа не показаны', async ({ page }) => {
  await page.goto('/demo');
  await page.getByText('Все профили по этапам пути').click();
  await expect(page.getByRole('button', { name: 'Войти как Юлия Власова' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Войти как Демо: / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Глеб Соколов/ })).toHaveCount(0);
});

test('E-02: работодатель → подборка → приглашение → кандидат принимает → контакты открыты', async ({ page }) => {
  // 1. работодатель: подборка по потребности
  await loginAsEmployer(page);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto('/employer/needs/demo-vac-be-m-1');
  await page.waitForURL(VACANCY_URL);
  const cards = page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3 }) });
  const top = cards.first();
  const alreadyAccepted = (await top.getByRole('heading', { level: 3 }).filter({ hasText: POOL_TOP }).count()) > 0; // принявший кандидат показан по имени
  if (!alreadyAccepted) await expect(top.getByRole('heading', { level: 3 })).toContainText(/Кандидат #[0-9A-F]{6}/);
  // тип источника виден, ссылок и цитат нет (R-E-07); утверждения лежат в свёрнутом блоке доказательств карточки
  await top.getByText('Доказательства и этапы оценки').click();
  await expect(top.getByText(/доказано: (GitHub|Codeforces|Stack Overflow|статья|ФСП)/).first()).toBeVisible();
  if (!alreadyAccepted) await expect(top).not.toContainText(POOL_TOP);

  // 2. приглашение (если ещё не отправлено)
  const invite = top.getByRole('button', { name: /^Пригласить:/ });
  if (await invite.isVisible()) {
    await invite.click();
    // форма приглашения открывается модальным окном (<dialog>), а не внутри карточки
    const dialog = page.getByRole('dialog', { name: /^Приглашение: / });
    await dialog.getByLabel('Почему именно этот кандидат').fill('Платёжная команда, Go и Kafka, удалёнка');
    await dialog.getByLabel('Зарплата от, ₽ в месяц').fill('230000');
    await dialog.getByLabel('до, ₽ в месяц').fill('260000');
    await dialog.getByRole('button', { name: 'Отправить приглашение' }).click();
    await expect(page.getByText(/Приглашение (отправлено|просмотрено)/).first()).toBeVisible();
  }

  // 3. кандидат принимает
  await loginAsPoolCandidate(page, 'demo-pool-be-m-pay');
  await page.goto('/invitations');
  // до принятия: вилка и способ связи компании (ТЗ 2.2)
  await expect(page.getByText(/Связь с компанией: /).first()).toBeVisible();
  const accept = page.getByRole('button', { name: 'Принять' }).first();
  // Г5 (ADR 0005): принять можно только с отдельной галочкой раскрытия имени и контактов этой компании.
  if (await accept.isVisible()) {
    await page.getByLabel(/Раскрыть этому работодателю/).first().check();
    await accept.click();
  }
  await expect(page.getByText(/Контакты открыты/).first()).toBeVisible();

  // 4. работодатель видит имя и контакты
  await loginAsEmployer(page);
  await page.goto('/employer/needs/demo-vac-be-m-1');
  await expect(page.getByText(POOL_TOP).first()).toBeVisible();
  // контакт задаёт сам кандидат («Как с тобой связаться»); без него показывается почта аккаунта
  await expect(page.getByText(/@example\.(com|test)|Кандидат не указал контакт/).first()).toBeVisible();
});

test('Помощник работодателя (демо без модели): подборка карточками → «Пригласить» → форма; имён нет', async ({ page }) => {
  test.setTimeout(120_000);
  await loginAsEmployer(page);
  // свежая потребность этого прогона на Frontend: сценарий не зависит от того, кого принял E-02 по Backend
  const list = await (await page.request.get('/api/employer/vacancies')).json();
  const sample = list.vacancies.find((v: { id: string }) => v.id === 'demo-vac-fe-j-2');
  const title = `E2E Frontend Junior ${Date.now()}`;
  const created = await page.request.post('/api/employer/vacancies', {
    data: { title, specialization: 'frontend', grade: 'junior', subcategoryId: 'frontend.ui-app', salaryFrom: 100000, salaryTo: 150000, stack: ['React'], needs: sample.needs },
  });
  expect(created.status()).toBe(201);
  await page.getByRole('navigation', { name: 'Разделы кабинета' }).getByRole('link', { name: 'ИИ-помощник' }).click();
  await page.waitForURL('**/consultant');
  await page.getByLabel('Сообщение помощнику').fill(`Подбери под мою потребность ${title}`);
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  const block = page.getByTestId('assistant-candidates').last();
  await expect(block).toBeVisible({ timeout: 60_000 });
  const first = block.getByTestId('assistant-candidate').first();
  await expect(first.getByRole('heading', { level: 3 })).toContainText(/Кандидат #[0-9A-F]{6}/);
  // граница доверия: имени из пула нет ни в карточках, ни в ответе помощника
  for (const name of FRONTEND_POOL) await expect(page.getByText(name)).toHaveCount(0);
  await page.getByLabel('Сообщение помощнику').fill('Пригласи первого');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  const draft = page.getByTestId('assistant-invitation-draft').last();
  await expect(draft).toBeVisible({ timeout: 60_000 });
  // у свежей потребности и непринятых кандидатов открытого приглашения нет, форма на месте
  await expect(draft.getByRole('button', { name: 'Отправить приглашение' })).toBeVisible();
});
