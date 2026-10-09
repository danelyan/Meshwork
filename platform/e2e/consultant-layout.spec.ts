import { test, expect } from '@playwright/test';

test('consultant layout keeps the composer usable on desktop and phone', async ({ page }) => {
  for (const width of [1280, 768, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/design/head-motion-preview');
    await expect(page.getByRole('heading', { name: 'Карьерный консультант' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Сообщение' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Профиль', exact: true })).toHaveAttribute('href', '/profile');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const input = await page.getByRole('textbox', { name: 'Сообщение' }).boundingBox();
    expect(input!.y + input!.height).toBeLessThanOrEqual(800);
    if (width <= 1050) await expect(page.locator('canvas')).toBeHidden();
    await page.getByRole('textbox', { name: 'Сообщение' }).fill('Хочу обновить профиль');
    await expect(page.getByRole('button', { name: 'Отправить' })).toBeEnabled();
  }
});
