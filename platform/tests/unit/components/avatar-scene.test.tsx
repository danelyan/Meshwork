import { cleanup, render, screen } from '@testing-library/react';

import { AvatarScene } from '@/components/avatar/AvatarScene';
import { AssistantRow } from '@/components/chat/Thread';

vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/components/avatar/HeadView', () => ({ HeadView: () => <div data-testid="head-view" /> }));

afterEach(cleanup);

describe('AvatarScene call-side (вариант D)', () => {
  it('кладёт переданную ленту в левую панель, рядом голова и кнопки звонка', () => {
    render(
      <AvatarScene variant="call-side">
        <div data-testid="feed">лента</div>
      </AvatarScene>,
    );
    expect(screen.getByTestId('side-panel').contains(screen.getByTestId('feed'))).toBe(true);
    expect(screen.getByTestId('head-view')).toBeTruthy();
    expect(screen.getByTestId('head-view').closest('[data-call]')).toBeTruthy();
    expect(screen.getByTestId('side-panel').closest('[data-call]')).toBeNull();
    expect(screen.getByTestId('state-chip')).toBeTruthy();
  });

  it('marks the scrollable feed without including the fixed chat toolbar', () => {
    render(<AvatarScene variant="call-side"><div data-testid="feed">лента</div></AvatarScene>);
    const panel = screen.getByTestId('side-panel');
    const scrollPane = screen.getByTestId('feed').closest('[data-feed-scroll]');
    expect(scrollPane).not.toBeNull();
    expect(scrollPane).not.toBe(panel);
    expect(panel.hasAttribute('data-feed-scroll')).toBe(false);
    expect(scrollPane?.querySelector('header')).toBeNull();
    expect(panel.contains(scrollPane)).toBe(true);
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
