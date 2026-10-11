import { expect, type Page } from '@playwright/test';

/** Curated resume-stage candidate through the real jury demo page. Keep the guard's return path. */
export async function signInAsDemoCandidate(page: Page) {
  const next = new URL(page.url()).searchParams.get('next');
  await page.goto(`/demo${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  await page.getByText('Все профили по этапам пути', { exact: true }).click();
  const specialists = page.getByRole('group', { name: 'Специалисты', exact: true });
  await expect(specialists).toBeVisible();
  await specialists.getByRole('button', { name: 'Войти как Юлия Власова', exact: true }).click();
}
