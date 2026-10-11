// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Badge, Button, TextField } from '../src/ui';

afterEach(cleanup);

const describedBy = (el: HTMLElement) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? null);

describe('Button', () => {
  it('по умолчанию type="button" и variant="primary", прочие атрибуты проходят', () => {
    render(<Button aria-label="Закрыть окно" id="x">×</Button>);
    const b = screen.getByRole('button', { name: 'Закрыть окно' });
    expect(b.getAttribute('type')).toBe('button');
    expect(b.getAttribute('data-variant')).toBe('primary');
    expect(b.id).toBe('x');
  });

  it('type="submit" отправляет форму, по умолчанию форма не отправляется', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button>Просто</Button>
        <Button type="submit">Отправить</Button>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Просто' }));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('disabled: атрибут есть, клик не доходит, aria-busy нет', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Далее</Button>);
    const b = screen.getByRole('button', { name: 'Далее' }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
    expect(b.hasAttribute('aria-busy')).toBe(false);
    expect(b.hasAttribute('aria-disabled')).toBe(false);
  });

  it('loading: aria-busy и aria-disabled, фокус сохраняется, имя не меняется', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Сохранить</Button>);
    const b = screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement;
    expect(b.hasAttribute('aria-busy')).toBe(false);
    b.focus();
    rerender(<Button loading onClick={onClick}>Сохранить</Button>);
    const busy = screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement;
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    expect(busy.disabled).toBe(false);
    expect(document.activeElement).toBe(busy);
    fireEvent.click(busy);
    expect(onClick).not.toHaveBeenCalled();
    rerender(<Button onClick={onClick}>Сохранить</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disabled важнее loading', () => {
    render(<Button disabled loading>Ждать</Button>);
    const b = screen.getByRole('button', { name: 'Ждать' }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.hasAttribute('aria-busy')).toBe(false);
  });
});

describe('Badge', () => {
  it('tone по умолчанию neutral, children важнее count', () => {
    const { container } = render(<Badge count={5}>Новое</Badge>);
    const el = container.firstElementChild!;
    expect(el.tagName).toBe('SPAN');
    expect(el.getAttribute('data-tone')).toBe('neutral');
    expect(el.textContent).toBe('Новое');
  });

  it('count: обычное значение, граница max и значение выше', () => {
    const { container, rerender } = render(<Badge tone="success" count={99} />);
    expect(container.textContent).toBe('99');
    expect(container.firstElementChild!.getAttribute('data-tone')).toBe('success');
    rerender(<Badge count={100} />);
    expect(container.textContent).toBe('99+');
    rerender(<Badge count={12} max={9} />);
    expect(container.textContent).toBe('9+');
    rerender(<Badge count={9} max={9} />);
    expect(container.textContent).toBe('9');
  });

  it('ноль показывается, пока нет hideZero; с hideZero и отрицательным – пусто', () => {
    const { container, rerender } = render(<Badge count={0} />);
    expect(container.textContent).toBe('0');
    rerender(<Badge count={0} hideZero />);
    expect(container.firstElementChild).toBeNull();
    rerender(<Badge count={-3} hideZero />);
    expect(container.firstElementChild).toBeNull();
    rerender(<Badge count={-3} />);
    expect(container.textContent).toBe('0');
    rerender(<Badge count={2} hideZero />);
    expect(container.textContent).toBe('2');
  });

  it('без children и count ничего не рендерит', () => {
    const { container, rerender } = render(<Badge tone="danger">Ошибка</Badge>);
    expect(container.textContent).toBe('Ошибка');
    rerender(<Badge tone="danger" />);
    expect(container.firstElementChild).toBeNull();
  });
});

describe('TextField', () => {
  it('подпись связана с полем, onChange получает строку', () => {
    const onChange = vi.fn();
    render(<TextField label="Имя" value="Анна" onChange={onChange} />);
    const input = screen.getByLabelText('Имя') as HTMLInputElement;
    expect(screen.getByRole('textbox', { name: 'Имя' })).toBe(input);
    expect(input.value).toBe('Анна');
    fireEvent.change(input, { target: { value: 'Анастасия' } });
    expect(onChange).toHaveBeenCalledWith('Анастасия');
  });

  it('type, required и disabled попадают на input', () => {
    render(<TextField label="Пароль" type="password" required disabled value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Пароль') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.required).toBe(true);
    expect(input.disabled).toBe(true);
  });

  it('два поля без id не конфликтуют, переданный id используется', () => {
    render(
      <>
        <TextField label="Фамилия" value="" onChange={() => {}} />
        <TextField label="Отчество" value="" onChange={() => {}} />
        <TextField label="Город" id="city" value="" onChange={() => {}} />
      </>,
    );
    const a = screen.getByLabelText('Фамилия');
    const b = screen.getByLabelText('Отчество');
    expect(a.id).not.toBe('');
    expect(a.id).not.toBe(b.id);
    expect(screen.getByLabelText('Город').id).toBe('city');
  });

  it('без hint и error нет ни aria-describedby, ни aria-invalid, ни alert', () => {
    render(<TextField label="Поле" value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Поле');
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('hint описывает поле; пустая строка hint/error – как отсутствие', () => {
    const { rerender } = render(<TextField label="Логин" hint="Только латиница" error="" value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Логин');
    expect(describedBy(input)).toEqual(['Только латиница']);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(<TextField label="Логин" hint="" value="" onChange={() => {}} />);
    expect(screen.getByLabelText('Логин').hasAttribute('aria-describedby')).toBe(false);
  });

  it('error: role=alert, aria-invalid, описание = hint затем error', () => {
    render(<TextField label="Почта" hint="Рабочая почта" error="Неверный адрес" value="x" onChange={() => {}} />);
    const input = screen.getByRole('textbox', { name: 'Почта' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('Неверный адрес');
    expect(describedBy(input)).toEqual(['Рабочая почта', 'Неверный адрес']);
  });

  it('только error: описание – одна ошибка; после исправления атрибуты исчезают', () => {
    const { rerender } = render(<TextField label="Код" error="Слишком короткий" value="1" onChange={() => {}} />);
    expect(describedBy(screen.getByLabelText('Код'))).toEqual(['Слишком короткий']);
    rerender(<TextField label="Код" value="1234" onChange={() => {}} />);
    const input = screen.getByLabelText('Код');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
