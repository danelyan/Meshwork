import { expect, test } from '@playwright/test';

test('unknown route renders the custom 404 and a working home link', async ({ page }) => {
  const response = await page.goto('/this-page-does-not-exist-404');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Даже он не знает, где эта страница.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'На главную', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'На главную', exact: true }).click();
  await expect(page).toHaveURL('/');
});

test('mobile 404 stays readable with reduced motion and no WebGL', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (String(args[0]).includes('webgl')) return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto('/this-page-does-not-exist-404');
  await expect(page.getByRole('heading', { name: 'Даже он не знает, где эта страница.' })).toBeVisible();
  await expect(page.getByTestId('avatar-fallback')).toBeVisible();
  await expect(page.getByRole('link', { name: 'На главную', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
