import { expect, test } from '@playwright/test';

test('health отвечает 200', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, db: 'up' });
});
