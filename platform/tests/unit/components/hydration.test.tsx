import { act, cleanup } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import { OnboardingChat } from '@/components/onboarding/OnboardingChat';
import type { OnboardingView } from '@/server/onboarding/types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const view = {
  name: 'Иван',
  role: 'candidate',
  scenario: 'candidate',
  consent: { version: 'v1', docUrl: '/consent' },
  progress: { done: 1, total: 10 },
  history: [],
  current: { id: 'goal', kind: 'one', eyebrow: 'Цель', label: 'Цель', question: 'Зачем ты здесь?', lead: 'Начнём.', allowCustom: false, required: false, options: [{ value: 'job', label: 'Работа' }] },
  summary: null,
  laterTarget: '/consultant',
  test: { href: '/profile', ready: false },
  onboarded: false,
} as unknown as OnboardingView;

it('гидрация ленты онбординга: первый клиентский рендер совпадает с серверным (без matchMedia на сервере, с ним на клиенте)', async () => {
  // Сервер: нет window.matchMedia (prefersReducedMotion() === true).
  const html = renderToString(<OnboardingChat initial={view} consentText={[]} />);
  // Клиент: браузер без reduced-motion.
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a));
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  const onRecoverableError = vi.fn();
  await act(async () => {
    hydrateRoot(host, <OnboardingChat initial={view} consentText={[]} />, { onRecoverableError });
  });
  spy.mockRestore();
  expect(onRecoverableError).not.toHaveBeenCalled();
  expect(errors).toEqual([]);
  host.remove();
});
