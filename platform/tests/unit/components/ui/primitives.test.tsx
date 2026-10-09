import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';

import { Avatar, Button, Chip, Field, Kicker, Meter, Notice, Panel, Spinner, Tag, VisuallyHidden } from '@/components/ui';

vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe('Button', () => {
  it('по умолчанию type=button и вызывает onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Ок</Button>);
    const b = screen.getByRole('button', { name: 'Ок' });
    expect(b).toHaveProperty('type', 'button');
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it.each(['primary', 'cta', 'ghost', 'danger'] as const)('вариант %s рендерится', (variant) => {
    render(<Button variant={variant}>x</Button>);
    expect(screen.getByRole('button').className).toContain('btn');
  });
  it('варианты дают разные классы, размер sm добавляет small', () => {
    render(
      <>
        <Button variant="primary">a</Button>
        <Button variant="cta" size="sm">b</Button>
      </>,
    );
    const [a, b] = screen.getAllByRole('button') as [HTMLElement, HTMLElement];
    expect(a.className).not.toBe(b.className);
    expect(b.className).toContain('small');
  });
  it('loading блокирует кнопку, ставит aria-busy и показывает спиннер', () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Шлю</Button>);
    const b = screen.getByRole('button', { name: 'Шлю' });
    expect(b).toHaveProperty('disabled', true);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByTestId('spinner')).toBeTruthy();
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });
  it('disabled блокирует', () => {
    render(<Button disabled>x</Button>);
    expect(screen.getByRole('button')).toHaveProperty('disabled', true);
  });
  it('с href рендерится ссылкой', () => {
    render(<Button href="/profile">Профиль</Button>);
    const a = screen.getByRole('link', { name: 'Профиль' });
    expect(a.getAttribute('href')).toBe('/profile');
    expect(a.className).toContain('btn');
  });
  it('ref передаётся как обычный проп (React 19)', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>x</Button>);
    expect(ref.current).toBe(screen.getByRole('button'));
  });
});

describe('Chip', () => {
  it('aria-pressed отражает pressed', () => {
    const { rerender } = render(<Chip>Go</Chip>);
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false');
    rerender(<Chip pressed>Go</Chip>);
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Tag', () => {
  it('тоны отличаются классами', () => {
    render(
      <>
        <Tag>a</Tag>
        <Tag tone="outline">b</Tag>
        <Tag tone="solid">c</Tag>
        <Tag tone="dashed">d</Tag>
      </>,
    );
    const names = ['a', 'b', 'c', 'd'].map((t) => screen.getByText(t).className);
    expect(new Set(names).size).toBe(4);
  });
});

describe('Panel', () => {
  it('variant strong и as', () => {
    render(
      <Panel as="section" variant="strong" aria-label="блок">
        текст
      </Panel>,
    );
    const el = screen.getByRole('region', { name: 'блок' });
    expect(el.tagName).toBe('SECTION');
    expect(el.className).toContain('panelStrong');
  });
});

describe('Field', () => {
  it('связывает label, подсказку и ошибку с полем', () => {
    render(
      <Field label="Почта" hint="Рабочая" error="Неверный адрес">
        <input />
      </Field>,
    );
    const input = screen.getByLabelText('Почта');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = input.getAttribute('aria-describedby')!.split(' ') as [string, string];
    expect(describedBy).toHaveLength(2);
    expect(document.getElementById(describedBy[0])?.textContent).toBe('Рабочая');
    const err = screen.getByRole('alert');
    expect(err.id).toBe(describedBy[1]);
  });
  it('без ошибки нет aria-invalid и alert', () => {
    render(
      <Field label="Имя">
        <input />
      </Field>,
    );
    const input = screen.getByLabelText('Имя');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('сохраняет свой id', () => {
    render(
      <Field label="Имя">
        <input id="mine" />
      </Field>,
    );
    expect(screen.getByLabelText('Имя').id).toBe('mine');
  });
});

describe('Avatar, Meter, Notice, Kicker, Spinner, VisuallyHidden', () => {
  it('Avatar декоративный', () => {
    render(<Avatar size={40} />);
    const a = screen.getByTestId('avatar');
    expect(a.getAttribute('aria-hidden')).toBe('true');
    expect(a.getAttribute('style')).toContain('40px');
  });
  it('Meter: сегменты и подпись не только цветом', () => {
    render(<Meter value={2} max={5} />);
    const m = screen.getByRole('img', { name: '2 из 5' });
    expect(m.querySelectorAll('i')).toHaveLength(5);
    expect(m.querySelectorAll('[data-on="true"]')).toHaveLength(2);
  });
  it('Meter ограничивает value диапазоном', () => {
    render(<Meter value={9} max={3} label="покрыто" />);
    expect(screen.getByRole('img', { name: 'покрыто' }).querySelectorAll('[data-on="true"]')).toHaveLength(3);
  });
  it('Notice: info - status, error - alert', () => {
    render(
      <>
        <Notice>инфо</Notice>
        <Notice tone="error">беда</Notice>
      </>,
    );
    expect(screen.getByRole('status').textContent).toBe('инфо');
    expect(screen.getByRole('alert').textContent).toBe('беда');
  });
  it('Kicker, Spinner, VisuallyHidden рендерятся', () => {
    render(
      <>
        <Kicker>рубрика</Kicker>
        <Spinner />
        <VisuallyHidden>скрыто</VisuallyHidden>
      </>,
    );
    expect(screen.getByText('рубрика').className).toContain('kicker');
    expect(screen.getByTestId('spinner').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('скрыто').className).toContain('srOnly');
  });
});
