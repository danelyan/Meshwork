import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { DEMO_HIRING_COMPANIES, getDemoHiringMatch, HiringShowcase } from '@/components/landing/HiringShowcase';

afterEach(cleanup);

it('computes company count and salary bounds from both source filters', () => {
  expect(DEMO_HIRING_COMPANIES).toHaveLength(9);
  expect(getDemoHiringMatch('Backend', 'Middle')).toMatchObject({ count: 4, minimum: 120, maximum: 420 });
  expect(getDemoHiringMatch('Backend', 'Senior')).toMatchObject({ count: 2, minimum: 280, maximum: 480 });
  expect(getDemoHiringMatch('Frontend', 'Junior')).toMatchObject({ count: 2, minimum: 100, maximum: 260 });
  expect(getDemoHiringMatch('Mobile', 'Middle')).toMatchObject({ count: 1, minimum: 260, maximum: 400 });
});

it('shows an explicit empty state without invented matches or salary', () => {
  render(<HiringShowcase signedIn={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'DevOps' }));
  fireEvent.click(screen.getByRole('button', { name: 'Junior' }));
  expect(getDemoHiringMatch('DevOps', 'Junior')).toMatchObject({ count: 0, minimum: 0, maximum: 0 });
  expect(screen.getByRole('status').textContent).toBe('0 компаний ищут DevOps Junior');
  expect(screen.getByText('Пока нет совпадений')).toBeTruthy();
  expect(document.querySelectorAll('[data-match="true"]')).toHaveLength(0);
});

it('updates selected chips and matching companies independently of the viewer profile', () => {
  render(<HiringShowcase signedIn={true} />);
  expect(screen.getByRole('status').textContent).toBe('4 компании ищут Backend Middle');
  fireEvent.click(screen.getByRole('button', { name: 'QA' }));
  expect(screen.getByRole('button', { name: 'QA' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Backend' }).getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('status').textContent).toBe('1 компания ищет QA Middle');
  const matches = document.querySelectorAll('[data-match="true"]');
  expect(matches).toHaveLength(2); // One real card and its aria-hidden looping duplicate.
  expect(matches[0]?.textContent).toContain('Бирюза');
});

it.each([false, true])('uses the existing entry destination, signed in=%s', signedIn => {
  render(<HiringShowcase signedIn={signedIn} />);
  const links = screen.getAllByRole('link');
  expect(links).toHaveLength(9);
  for (const link of links) expect(link.getAttribute('href')).toBe(signedIn ? '/consultant' : '/auth?next=%2Fconsultant');
  expect(screen.getByText('Демо-подборка · вымышленные компании и вакансии')).toBeTruthy();
});
