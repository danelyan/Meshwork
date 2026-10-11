// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Combobox, type Option } from '../src/Combobox';
import { ThemeProvider, cssVarName, useToken, type TokenName } from '../src/theme';

afterEach(cleanup);

const OPTIONS: Option[] = [
  { value: 'ru', label: 'Россия' },
  { value: 'by', label: 'Беларусь', disabled: true },
  { value: 'kz', label: 'Казахстан' },
  { value: 'am', label: 'Армения' },
];

const combo = () => screen.getByRole('combobox') as HTMLInputElement;
const labels = () => screen.getAllByRole('option').map((o) => o.textContent);
const key = (k: string) => fireEvent.keyDown(combo(), { key: k });
const activeText = () => {
  const id = combo().getAttribute('aria-activedescendant');
  return id ? document.getElementById(id)?.textContent : null;
};

describe('Combobox: разметка и фильтр', () => {
  it('закрыт при монтировании: имя, aria-autocomplete, нет listbox', () => {
    render(<Combobox label="Страна" options={OPTIONS} />);
    const input = screen.getByRole('combobox', { name: 'Страна' });
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.hasAttribute('aria-controls')).toBe(false);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('клик открывает: все варианты, aria-controls = id listbox, id уникальны, disabled помечен', () => {
    render(<Combobox label="Страна" options={OPTIONS} />);
    fireEvent.click(combo());
    const list = screen.getByRole('listbox');
    expect(combo().getAttribute('aria-expanded')).toBe('true');
    expect(combo().getAttribute('aria-controls')).toBe(list.id);
    expect(labels()).toEqual(['Россия', 'Беларусь', 'Казахстан', 'Армения']);
    const ids = screen.getAllByRole('option').map((o) => o.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids.every(Boolean)).toBe(true);
    expect(screen.getByRole('option', { name: 'Беларусь' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('option', { name: 'Россия' }).hasAttribute('aria-disabled')).toBe(false);
  });

  it('фильтр по подстроке без учёта регистра, порядок исходный; пусто – «Ничего не найдено»', () => {
    render(<Combobox label="Страна" options={OPTIONS} />);
    fireEvent.change(combo(), { target: { value: 'СТАН' } });
    expect(labels()).toEqual(['Казахстан']);
    expect(combo().getAttribute('aria-expanded')).toBe('true');
    fireEvent.change(combo(), { target: { value: 'сия' } });
    expect(labels()).toEqual(['Россия']);
    fireEvent.change(combo(), { target: { value: 'ямайка' } });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Ничего не найдено');
    expect(combo().getAttribute('aria-expanded')).toBe('false');
    expect(combo().hasAttribute('aria-controls')).toBe(false);
    fireEvent.change(combo(), { target: { value: '' } });
    expect(labels()).toHaveLength(4);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('disabled: поле отключено, клик не открывает', () => {
    render(<Combobox label="Страна" options={OPTIONS} disabled />);
    fireEvent.click(combo());
    expect(combo().disabled).toBe(true);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('скрытое поле name хранит значение; неизвестное значение – пустая строка', () => {
    const { container, rerender } = render(<Combobox label="Страна" name="country" options={OPTIONS} defaultValue="kz" />);
    const hidden = () => container.querySelector('input[type="hidden"][name="country"]') as HTMLInputElement;
    expect(hidden().value).toBe('kz');
    fireEvent.click(combo());
    fireEvent.click(screen.getByRole('option', { name: 'Армения' }));
    expect(hidden().value).toBe('am');
    rerender(<Combobox label="Страна" name="country" options={OPTIONS} value="zz" />);
    expect(hidden().value).toBe('');
    expect(combo().value).toBe('');
  });
});

describe('Combobox: клавиатура', () => {
  it('ArrowDown открывает и активирует первый доступный, дальше идёт по кругу, недоступные пропускаются', () => {
    render(<Combobox label="Страна" options={OPTIONS} />);
    key('ArrowDown');
    expect(combo().getAttribute('aria-expanded')).toBe('true');
    expect(activeText()).toBe('Россия');
    key('ArrowDown');
    expect(activeText()).toBe('Казахстан');
    key('ArrowDown');
    expect(activeText()).toBe('Армения');
    key('ArrowDown');
    expect(activeText()).toBe('Россия');
    key('ArrowUp');
    expect(activeText()).toBe('Армения');
    key('ArrowUp');
    expect(activeText()).toBe('Казахстан');
  });

  it('ArrowUp при закрытом списке открывает и активирует последний доступный; Home и End', () => {
    render(<Combobox label="Страна" options={OPTIONS} />);
    key('ArrowUp');
    expect(activeText()).toBe('Армения');
    key('Home');
    expect(activeText()).toBe('Россия');
    key('End');
    expect(activeText()).toBe('Армения');
  });

  it('ввод сбрасывает активный пункт, активный пункт – только из показанных', () => {
    render(<Combobox label="Страна" options={OPTIONS} />);
    key('ArrowDown');
    expect(activeText()).toBe('Россия');
    fireEvent.change(combo(), { target: { value: 'и' } });
    expect(combo().hasAttribute('aria-activedescendant')).toBe(false);
    key('ArrowDown');
    expect(activeText()).toBe('Россия');
    fireEvent.change(combo(), { target: { value: 'арм' } });
    key('ArrowDown');
    expect(activeText()).toBe('Армения');
    key('ArrowDown');
    expect(activeText()).toBe('Армения');
  });

  it('Enter выбирает активный: onChange, текст, закрытие; без активного – ничего, но событие погашено', () => {
    const onChange = vi.fn();
    render(<Combobox label="Страна" options={OPTIONS} onChange={onChange} />);
    fireEvent.click(combo());
    const notPrevented = fireEvent.keyDown(combo(), { key: 'Enter' });
    expect(notPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeTruthy();
    key('ArrowDown');
    key('ArrowDown');
    key('Enter');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('kz');
    expect(combo().value).toBe('Казахстан');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(combo().getAttribute('aria-expanded')).toBe('false');
  });

  it('Escape закрывает и возвращает текст выбранного; при закрытом ничего не меняет', () => {
    render(<Combobox label="Страна" options={OPTIONS} defaultValue="ru" />);
    fireEvent.change(combo(), { target: { value: 'каз' } });
    expect(labels()).toEqual(['Казахстан']);
    key('Escape');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(combo().value).toBe('Россия');
    key('Escape');
    expect(combo().value).toBe('Россия');
  });

  it('уход фокуса закрывает список, отбрасывает ввод, onChange не вызывается', () => {
    const onChange = vi.fn();
    render(<Combobox label="Страна" options={OPTIONS} defaultValue="am" onChange={onChange} />);
    fireEvent.change(combo(), { target: { value: 'рос' } });
    expect(labels()).toEqual(['Россия']);
    fireEvent.blur(combo());
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(combo().value).toBe('Армения');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Combobox: значение', () => {
  it('неконтролируемый: defaultValue, aria-selected, ArrowDown стартует с выбранного, смена и повтор', () => {
    const onChange = vi.fn();
    render(<Combobox label="Страна" options={OPTIONS} defaultValue="kz" onChange={onChange} />);
    expect(combo().value).toBe('Казахстан');
    key('ArrowDown');
    expect(activeText()).toBe('Казахстан');
    expect(screen.getByRole('option', { name: 'Казахстан' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('option', { name: 'Россия' }).getAttribute('aria-selected')).toBe('false');
    key('Enter');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(combo());
    fireEvent.click(screen.getByRole('option', { name: 'Армения' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('am');
    expect(combo().value).toBe('Армения');
  });

  it('недоступный вариант не выбирается кликом и список остаётся открытым', () => {
    const onChange = vi.fn();
    render(<Combobox label="Страна" options={OPTIONS} onChange={onChange} />);
    fireEvent.click(combo());
    fireEvent.click(screen.getByRole('option', { name: 'Беларусь' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(combo().value).toBe('');
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('контролируемый: показывает проп, onChange не меняет текст сам, null очищает, внешняя смена обновляет', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Combobox label="Страна" options={OPTIONS} value="ru" onChange={onChange} />);
    expect(combo().value).toBe('Россия');
    fireEvent.click(combo());
    fireEvent.click(screen.getByRole('option', { name: 'Армения' }));
    expect(onChange).toHaveBeenCalledWith('am');
    expect(combo().value).toBe('Россия');
    expect(screen.queryByRole('listbox')).toBeNull();
    rerender(<Combobox label="Страна" options={OPTIONS} value={null} onChange={onChange} />);
    expect(combo().value).toBe('');
    rerender(<Combobox label="Страна" options={OPTIONS} value="am" onChange={onChange} />);
    expect(combo().value).toBe('Армения');
  });
});

describe('theme', () => {
  const NAMES: TokenName[] = ['color.bg', 'color.text', 'color.primary', 'space.2', 'radius.md'];

  function Probe({ token }: { token: TokenName }) {
    return <output data-testid={`probe-${token}`}>{useToken(token)}</output>;
  }
  const probe = (token: TokenName) => screen.getByTestId(`probe-${token}`).textContent;

  it('cssVarName', () => {
    expect(cssVarName('color.bg')).toBe('--ds-color-bg');
    expect(cssVarName('space.2')).toBe('--ds-space-2');
    expect(cssVarName('radius.md')).toBe('--ds-radius-md');
  });

  it('светлая тема по умолчанию: data-theme и все переменные', () => {
    const { container } = render(<ThemeProvider>x</ThemeProvider>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('data-theme')).toBe('light');
    const got = Object.fromEntries(NAMES.map((n) => [n, root.style.getPropertyValue(cssVarName(n))]));
    expect(got).toEqual({
      'color.bg': '#ffffff',
      'color.text': '#111827',
      'color.primary': '#2563eb',
      'space.2': '8px',
      'radius.md': '6px',
    });
    expect(root.textContent).toBe('x');
  });

  it('смена темы и overrides обновляет переменные и useToken', () => {
    const { container, rerender } = render(
      <ThemeProvider theme="light">
        <Probe token="color.bg" />
      </ThemeProvider>,
    );
    expect(probe('color.bg')).toBe('#ffffff');
    rerender(
      <ThemeProvider theme="dark" overrides={{ 'color.primary': '#ff0000' }}>
        <Probe token="color.bg" />
        <Probe token="color.primary" />
      </ThemeProvider>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.style.getPropertyValue('--ds-color-bg')).toBe('#0b1220');
    expect(root.style.getPropertyValue('--ds-color-primary')).toBe('#ff0000');
    expect(probe('color.bg')).toBe('#0b1220');
    expect(probe('color.primary')).toBe('#ff0000');
  });

  it('вложенные провайдеры: тема наследуется, overrides складываются, ближайший сильнее', () => {
    const { container } = render(
      <ThemeProvider theme="dark" overrides={{ 'color.primary': '#111111', 'space.2': '10px' }}>
        <ThemeProvider overrides={{ 'color.primary': '#222222' }}>
          <Probe token="color.primary" />
          <Probe token="space.2" />
          <Probe token="color.bg" />
        </ThemeProvider>
      </ThemeProvider>,
    );
    expect(probe('color.primary')).toBe('#222222');
    expect(probe('space.2')).toBe('10px');
    expect(probe('color.bg')).toBe('#0b1220');
    const inner = container.querySelectorAll('[data-theme]')[1] as HTMLElement;
    expect(inner.getAttribute('data-theme')).toBe('dark');
    expect(inner.style.getPropertyValue('--ds-color-primary')).toBe('#222222');
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.style.getPropertyValue('--ds-color-primary')).toBe('#111111');
  });

  it('вне провайдера – светлая тема; неизвестный токен – Error', () => {
    render(<Probe token="color.text" />);
    expect(probe('color.text')).toBe('#111827');
    cleanup();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe token={'color.nope' as TokenName} />)).toThrow('Unknown token: color.nope');
    spy.mockRestore();
  });
});
