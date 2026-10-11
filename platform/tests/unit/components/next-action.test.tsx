import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { AsideProvider } from '@/components/consultant/aside-refresh';
import { NextAction, nextStep } from '@/components/consultant/NextAction';
import type { JourneyStep, SceneAsideData } from '@/server/consultant/aside';

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

afterEach(cleanup);

const step = (id: string, state: JourneyStep['state']): JourneyStep => ({ id, label: id, short: id, note: '', href: '/', state });
const aside = (over: Partial<SceneAsideData>): SceneAsideData => ({ role: 'candidate', steps: [], docs: null, hint: { title: '', text: '' }, ...over });

describe('nextStep – главное действие шага', () => {
  it('кандидат: шаг «сейчас» с экраном даёт действие', () => {
    expect(nextStep(aside({ steps: [step('intro', 'done'), step('test', 'now')] }))).toEqual({ label: 'Пройти тест на грейд', href: '/test' });
    expect(nextStep(aside({ steps: [step('project', 'now')] }))?.href).toBe('/projects');
    expect(nextStep(aside({ steps: [step('invites', 'now')] }))?.href).toBe('/invitations');
  });

  it('работодатель: потребность, подборка, приглашения', () => {
    expect(nextStep(aside({ role: 'employer', steps: [step('needs', 'now')] }))?.href).toBe('/employer/needs/new');
    expect(nextStep(aside({ role: 'employer', steps: [step('search', 'now')] }))).toEqual({ label: 'Открыть подборку', href: '/employer' });
  });

  it('действия нет: идёт знакомство, шаг закрыт блокером, созвон и защита, путь пройден, данных нет', () => {
    expect(nextStep(aside({ steps: [step('test', 'now')], onboarding: { done: 1, total: 9, current: 'Город' } }))).toBeNull();
    expect(nextStep(aside({ steps: [step('test', 'now')], stepBlock: { step: 'test', blocker: { text: 'Сначала согласие' } } }))).toBeNull();
    expect(nextStep(aside({ steps: [step('call', 'now')] }))).toBeNull();
    expect(nextStep(aside({ steps: [step('live_defense', 'now')] }))).toBeNull();
    expect(nextStep(aside({ steps: [step('test', 'done')] }))).toBeNull();
    expect(nextStep(undefined)).toBeNull();
  });
});

describe('NextAction – полоса над вводом', () => {
  it('вне сцены консультанта ничего не рисует', () => {
    render(<NextAction onAttach={() => undefined} />);
    expect(screen.queryByTestId('next-action')).toBeNull();
  });

  it('кандидат: ссылка шага и «Загрузить резюме» открывает выбор файла', () => {
    const onAttach = vi.fn();
    render(
      <AsideProvider initial={aside({ steps: [step('test', 'now')] })}>
        <NextAction onAttach={onAttach} />
      </AsideProvider>,
    );
    expect(screen.getByRole('link', { name: /Пройти тест на грейд/ }).getAttribute('href')).toBe('/test');
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить резюме' }));
    expect(onAttach).toHaveBeenCalledTimes(1);
  });

  it('кандидат без вложений в композере: только главное действие', () => {
    render(
      <AsideProvider initial={aside({ steps: [step('test', 'now')] })}>
        <NextAction />
      </AsideProvider>,
    );
    expect(screen.getByRole('link', { name: /Пройти тест на грейд/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Загрузить резюме' })).toBeNull();
  });

  it('работодатель: рядом «Описать новую вакансию», но не дважды, когда это и есть шаг', () => {
    const { rerender } = render(
      <AsideProvider initial={aside({ role: 'employer', steps: [step('search', 'now')] })}>
        <NextAction />
      </AsideProvider>,
    );
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/employer', '/employer/needs/new']);
    rerender(
      <AsideProvider initial={aside({ role: 'employer', steps: [step('needs', 'now')] })}>
        <NextAction />
      </AsideProvider>,
    );
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/employer/needs/new']);
  });
});
