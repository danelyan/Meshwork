import { cleanup, render, screen } from '@testing-library/react';

import { AvatarScene } from '@/components/avatar/AvatarScene';
import { StageStrip } from '@/components/consultant/StageStrip';
import type { SceneAsideData } from '@/server/consultant/aside';
import type { IntroStages } from '@/server/consultant/stages';

vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/components/avatar/HeadView', () => ({ HeadView: () => <div data-testid="head-view" /> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

afterEach(cleanup);

const stages: IntroStages = {
  title: 'Знакомство с Кирой',
  done: 8,
  total: 15,
  items: [
    { id: 'specialization', label: 'Специализация', note: 'Backend', state: 'done' },
    { id: 'grade', label: 'Грейд', note: 'Middle · со слов', state: 'done' },
    { id: 'materials', label: 'Резюме и опыт', note: 'сейчас', state: 'now' },
    { id: 'terms', label: 'Условия', note: 'формат и зарплата', state: 'next' },
    { id: 'test', label: 'Тест', note: 'подтверждает грейд', state: 'next' },
  ],
};

describe('StageStrip – полоса этапов знакомства', () => {
  it('показывает этапы, заполненность и отмечает текущий этап', () => {
    render(<StageStrip data={stages} />);
    expect(screen.getByRole('region', { name: 'Знакомство с Кирой' })).toBeTruthy();
    expect(screen.getByTestId('stage-count').textContent).toBe('Заполнено 8 из 15');
    expect(screen.getAllByRole('listitem').map((li) => li.getAttribute('data-state'))).toEqual(['done', 'done', 'now', 'next', 'next']);
    expect(screen.getByTestId('stage-materials').getAttribute('aria-current')).toBe('step');
    expect(screen.getByTestId('stage-specialization').textContent).toContain('✓');
    expect(screen.getByTestId('stage-test').textContent).toContain('подтверждает грейд');
  });

  it('«светлячок» бежит до текущего этапа; у первого этапа и у пройденного пути его нет', () => {
    const { container, rerender } = render(<StageStrip data={stages} />);
    const dot = container.querySelector('i[aria-hidden="true"]') as HTMLElement;
    expect(dot.style.getPropertyValue('--run-to')).toBe('40%');
    rerender(<StageStrip data={{ ...stages, items: stages.items.map((s) => ({ ...s, state: 'done' as const })) }} />);
    expect(container.querySelector('i[aria-hidden="true"]')).toBeNull();
    rerender(<StageStrip data={{ ...stages, items: stages.items.map((s, i) => ({ ...s, state: i === 0 ? ('now' as const) : ('next' as const) })) }} />);
    expect(container.querySelector('i[aria-hidden="true"]')).toBeNull();
  });

  it('без этапов ничего не рисует', () => {
    render(<StageStrip data={{ ...stages, items: [] }} />);
    expect(screen.queryByTestId('stage-strip')).toBeNull();
  });
});

describe('AvatarScene call-side – полоса над сценой', () => {
  const aside = (over: Partial<SceneAsideData>): SceneAsideData => ({ role: 'candidate', steps: [], docs: null, hint: { title: '', text: '' }, ...over });

  it('с этапами полоса стоит перед сценой и не попадает в панель чата', () => {
    render(
      <AvatarScene variant="call-side" aside={aside({ stages })}>
        <div data-testid="feed">лента</div>
      </AvatarScene>,
    );
    const strip = screen.getByTestId('stage-strip');
    const scene = screen.getByTestId('scene-call-side');
    expect(scene.contains(strip)).toBe(false);
    expect(strip.nextElementSibling).toBe(scene);
    expect(screen.getByTestId('side-panel').contains(screen.getByTestId('feed'))).toBe(true);
  });

  it('без этапов сцена рисуется как раньше, без полосы', () => {
    render(
      <AvatarScene variant="call-side" aside={aside({})}>
        <div data-testid="feed">лента</div>
      </AvatarScene>,
    );
    expect(screen.queryByTestId('stage-strip')).toBeNull();
    expect(screen.getByTestId('scene-call-side')).toBeTruthy();
  });
});
