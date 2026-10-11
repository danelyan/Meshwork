import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MotionProvider } from '@/components/ui/MotionProvider';
import { Popover } from '@/components/ui/Reveal';

const view = (open: boolean) => (
  <MotionProvider>
    <Popover open={open} id="p" className="x" role="region" aria-label="Панель">
      тело
    </Popover>
  </MotionProvider>
);

describe('Popover (Motion)', () => {
  it('пробрасывает props, показывается при open и убирается из DOM после выхода', async () => {
    const { rerender } = render(view(true));
    const el = screen.getByRole('region', { name: 'Панель' });
    expect(el.id).toBe('p');
    expect(el.className).toBe('x');
    rerender(view(false));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Панель' })).toBeNull(), { timeout: 2000 });
  });
});
