// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Combobox, type Option } from '../../src/Combobox';
import { ThemeProvider, useToken } from '../../src/theme';

afterEach(cleanup);

const OPTIONS: Option[] = [
  { value: 'ru', label: 'Россия' },
  { value: 'by', label: 'Беларусь' },
  { value: 'kz', label: 'Казахстан' },
];

describe('Combobox (visible)', () => {
  it('клик открывает список, ввод фильтрует', () => {
    render(<Combobox label="Страна" options={OPTIONS} />);
    const input = screen.getByRole('combobox', { name: 'Страна' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(input);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    fireEvent.change(input, { target: { value: 'ка' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Казахстан']);
  });

  it('стрелки и Enter выбирают вариант', () => {
    const onChange = vi.fn();
    render(<Combobox label="Страна" options={OPTIONS} onChange={onChange} />);
    const input = screen.getByRole('combobox') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('by');
    expect(input.value).toBe('Беларусь');
  });

  it('контролируемый режим: значение приходит из пропса', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Combobox label="Страна" options={OPTIONS} value="ru" onChange={onChange} />);
    const input = screen.getByRole('combobox') as HTMLInputElement;
    expect(input.value).toBe('Россия');
    fireEvent.click(input);
    fireEvent.click(screen.getByRole('option', { name: 'Казахстан' }));
    expect(onChange).toHaveBeenCalledWith('kz');
    expect(input.value).toBe('Россия');
    rerender(<Combobox label="Страна" options={OPTIONS} value="kz" onChange={onChange} />);
    expect(input.value).toBe('Казахстан');
  });
});

describe('theme (visible)', () => {
  it('провайдер записывает переменные, useToken их читает', () => {
    function Probe() {
      return <output>{useToken('color.primary')}</output>;
    }
    const { container } = render(
      <ThemeProvider theme="dark">
        <Probe />
      </ThemeProvider>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.style.getPropertyValue('--ds-color-primary')).toBe('#60a5fa');
    expect(screen.getByText('#60a5fa')).toBeTruthy();
  });
});
