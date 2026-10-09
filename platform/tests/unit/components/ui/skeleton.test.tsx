import { cleanup, render, screen } from '@testing-library/react';

import { CardSkeleton, QuickReplies, ReplySkeleton, ThreadSkeleton } from '@/components/chat/Thread';
import { Skeleton } from '@/components/ui';

afterEach(cleanup);

it('Skeleton: декоративный, размер из пропсов', () => {
  const { container } = render(<Skeleton shape="line" width="60%" height={8} />);
  const el = container.firstElementChild as HTMLElement;
  expect(el.getAttribute('aria-hidden')).toBe('true');
  expect(el.style.width).toBe('60%');
  expect(el.style.height).toBe('8px');
});

it('скелеты ленты: статус для скринридера, строки и карточка', () => {
  render(
    <>
      <ReplySkeleton />
      <CardSkeleton rows={2} />
    </>,
  );
  expect(screen.getByRole('status').textContent).toMatch(/готовит ответ/);
  expect(screen.getByTestId('card-skeleton').children).toHaveLength(3);
  cleanup();
  render(<ThreadSkeleton />);
  expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
});

it('чипы получают индекс для стаггера', () => {
  render(<QuickReplies items={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} onPick={() => {}} />);
  expect(screen.getByRole('button', { name: 'B' }).style.getPropertyValue('--i')).toBe('1');
});
