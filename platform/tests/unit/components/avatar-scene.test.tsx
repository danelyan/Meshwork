import { cleanup, render, screen } from '@testing-library/react';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
  it('вместо звезды ФСП - статичное лицо 6, файл на месте', () => {
    const { container } = render(
      <ol>
        <AssistantRow>привет</AssistantRow>
      </ol>,
    );
    expect(container.querySelector('img[src="/avatar/face-6.png"]')).not.toBeNull();
    expect(container.querySelector('img[src="/assets/fsp-mark.svg"]')).toBeNull();
    expect(existsSync(join(process.cwd(), 'public/avatar/face-6.png'))).toBe(true);
  });
});
