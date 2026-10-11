// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog } from '../../src/Dialog';

afterEach(cleanup);

function Demo({ onOpenChange }: { onOpenChange?: (o: boolean) => void }) {
  return (
    <Dialog onOpenChange={onOpenChange}>
      <Dialog.Trigger>Открыть</Dialog.Trigger>
      <Dialog.Content>
        <Dialog.Title>Заголовок</Dialog.Title>
        <Dialog.Description>Описание</Dialog.Description>
        <input aria-label="Имя" />
        <Dialog.Close>Закрыть</Dialog.Close>
      </Dialog.Content>
    </Dialog>
  );
}

describe('Dialog (visible)', () => {
  it('закрыт по умолчанию, триггер размечен', () => {
    render(<Demo />);
    const t = screen.getByRole('button', { name: 'Открыть' });
    expect(t.getAttribute('aria-haspopup')).toBe('dialog');
    expect(t.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('клик открывает: роль, имя, описание, фокус внутри', () => {
    render(<Demo />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    const d = screen.getByRole('dialog', { name: 'Заголовок' });
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Имя'));
  });

  it('Escape закрывает, фокус возвращается на триггер', () => {
    const onOpenChange = vi.fn();
    render(<Demo onOpenChange={onOpenChange} />);
    const t = screen.getByRole('button', { name: 'Открыть' });
    t.focus();
    fireEvent.click(t);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(document.activeElement).toBe(t);
  });

  it('Tab на последнем элементе переходит на первый', () => {
    render(<Demo />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    const close = screen.getByRole('button', { name: 'Закрыть' });
    close.focus();
    const notPrevented = fireEvent.keyDown(close, { key: 'Tab' });
    expect(notPrevented).toBe(false);
    expect(document.activeElement).toBe(screen.getByLabelText('Имя'));
  });
});
