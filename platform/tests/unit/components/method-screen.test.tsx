import { cleanup, render, screen, within } from '@testing-library/react';

import { MethodScreen } from '@/components/method/MethodScreen';
import { POLICY_VERSION } from '@/server/test/policy';
import { bankInformation, methodPolicy, simulatedCandidates } from '@/server/validation/method';
import { simulatorSubcategories } from '@/server/validation/simulator';

afterEach(cleanup);

const subs = simulatorSubcategories();
const sub = subs[0]!;

it('/method: четыре блока, графики, карточки кандидатов и оговорка про симуляцию', () => {
  render(<MethodScreen policy={methodPolicy()} subcategories={subs} selected={sub} info={bankInformation(sub.id)} personas={simulatedCandidates(sub.id, 20)} />);
  for (const name of ['1. Этапы теста', '2. Где тест различает лучше всего', '3. Смоделированные кандидаты', '4. Подбор работодателю']) {
    expect(screen.getByRole('heading', { name })).toBeTruthy();
  }
  expect(screen.getByText(POLICY_VERSION)).toBeTruthy();
  expect(screen.getAllByRole('img', { name: /Информация Фишера|Стандартная ошибка/ })).toHaveLength(2);
  const personas = screen.getByRole('heading', { name: '3. Смоделированные кандидаты' }).closest('section')!;
  expect(within(personas).getAllByRole('listitem')).toHaveLength(8);
  for (const name of ['Середина зоны грейда', 'Уверенный: верхняя треть зоны']) {
    const row = within(personas).getByRole('heading', { name }).parentElement!;
    expect(within(row).getAllByRole('listitem')).toHaveLength(4);
  }
  expect(within(personas).getByText(/не люди/)).toBeTruthy();
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(sub.id);
  for (const href of ['/simulator', '/validation', '/mechanics', '/evaluate']) {
    expect(screen.getAllByRole('link').some((l) => l.getAttribute('href') === href)).toBe(true);
  }
  expect(screen.queryByRole('link', { name: '← Все страницы для жюри' })).toBeNull();
});

it('/method: обратная ссылка на /demo только при juryLink', () => {
  render(<MethodScreen policy={methodPolicy()} subcategories={subs} selected={sub} info={null} personas={null} juryLink />);
  expect(screen.getAllByRole('link', { name: '← Все страницы для жюри' })[0]!.getAttribute('href')).toBe('/demo');
});
