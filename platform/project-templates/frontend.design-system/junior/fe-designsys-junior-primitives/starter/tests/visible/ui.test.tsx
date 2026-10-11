// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Badge, Button, TextField } from '../../src/ui';

afterEach(cleanup);

describe('компоненты (visible)', () => {
  it('Button: роль, имя, вариант и клик', () => {
    const onClick = vi.fn();
    render(<Button variant="danger" onClick={onClick}>Удалить</Button>);
    const b = screen.getByRole('button', { name: 'Удалить' });
    expect(b.getAttribute('data-variant')).toBe('danger');
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('Button: loading не вызывает onClick и не отключает кнопку', () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Сохранить</Button>);
    const b = screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement;
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
    expect(b.disabled).toBe(false);
    expect(b.getAttribute('aria-busy')).toBe('true');
  });

  it('Badge: предел счётчика', () => {
    render(<Badge count={150} />);
    expect(screen.getByText('99+')).toBeTruthy();
  });

  it('TextField: подпись связана с полем, ошибка в описании', () => {
    render(<TextField label="Почта" value="" onChange={() => {}} error="Неверный адрес" />);
    const input = screen.getByRole('textbox', { name: 'Почта' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('Неверный адрес');
  });
});
