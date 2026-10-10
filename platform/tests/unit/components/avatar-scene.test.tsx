import { cleanup, render, screen } from '@testing-library/react';

import { AvatarScene } from '@/components/avatar/AvatarScene';
import { SceneSlot } from '@/components/avatar/SceneSlots';
import { AssistantRow } from '@/components/chat/Thread';

vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/components/avatar/HeadView', () => ({ HeadView: () => <div data-testid="head-view" /> }));

afterEach(cleanup);

describe('AvatarScene call-side (вариант D)', () => {
  it('renders live onboarding slots outside the scrollable chat and restores the ordinary scene on unmount', () => {
    const view = render(<AvatarScene variant="call-side"><SceneSlot name="header"><h1>Создаём профиль</h1></SceneSlot><SceneSlot name="draft"><button>Изменить ответ</button></SceneSlot><p>Вопрос</p></AvatarScene>);
    const panel = screen.getByTestId('side-panel');
    expect(panel.contains(screen.getByRole('heading', { name: 'Создаём профиль' }))).toBe(false);
    expect(panel.contains(screen.getByRole('button', { name: 'Изменить ответ' }))).toBe(false);
    expect(screen.getByRole('complementary', { name: 'Черновик профиля' }).contains(screen.getByRole('button', { name: 'Изменить ответ' }))).toBe(true);
    expect(screen.getByTestId('scene-call-side').hasAttribute('data-onboarding')).toBe(true);
    view.rerender(<AvatarScene variant="call-side"><p>Обычный разговор</p></AvatarScene>);
    expect(screen.getByTestId('scene-call-side').hasAttribute('data-onboarding')).toBe(false);
    expect(screen.queryByRole('complementary', { name: 'Черновик профиля' })).toBeNull();
  });
  it('кладёт переданную ленту в левую панель, рядом голова и кнопки звонка', () => {
    render(
      <AvatarScene variant="call-side">
        <div data-testid="feed">лента</div>
      </AvatarScene>,
    );
    expect(screen.getByTestId('side-panel').contains(screen.getByTestId('feed'))).toBe(true);
    expect(screen.getByTestId('head-view')).toBeTruthy();
    expect(screen.getByTestId('state-chip')).toBeTruthy();
  });

  it('children подменяют Chat и в других вариантах', () => {
    render(
      <AvatarScene variant="portrait">
        <div data-testid="feed">лента</div>
      </AvatarScene>,
    );
    expect(screen.getByTestId('feed')).toBeTruthy();
  });
});

describe('аватар в пузырях помощника', () => {
  it('показывает знак консультанта из Astra 05', () => {
    const { container } = render(
      <ol>
        <AssistantRow>привет</AssistantRow>
      </ol>,
    );
    expect(screen.getByTestId('assistant-face').textContent).toBe('К');
    expect(container.querySelector('img[src="/assets/fsp-mark.svg"]')).toBeNull();

  });
});
