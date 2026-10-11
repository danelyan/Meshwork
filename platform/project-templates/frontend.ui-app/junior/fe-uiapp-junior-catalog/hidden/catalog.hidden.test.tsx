// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProductCatalog } from '../src/ProductCatalog';
import type { Product } from '../src/types';

afterEach(cleanup);

const P: Product[] = [
  { id: 'a', name: 'Кофе зерновой', category: 'Кофе', priceRub: 1990, inStock: true },
  { id: 'b', name: 'Чай улун', category: 'Чай', priceRub: 750, inStock: true },
  { id: 'c', name: 'Кофе молотый', category: 'Кофе', priceRub: 1290, inStock: false },
  { id: 'd', name: 'Какао', category: 'Аксессуары', priceRub: 12500, inStock: true },
  { id: 'e', name: 'Турка медная', category: 'Аксессуары', priceRub: 3400, inStock: true },
];

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const items = () => within(screen.getByRole('list', { name: 'Товары' })).getAllByRole('listitem');
const search = (v: string) => fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: v } });
const category = (v: string) => fireEvent.change(screen.getByLabelText('Категория'), { target: { value: v } });
const cart = () => norm(screen.getByRole('region', { name: 'Корзина' }).textContent);
const addButton = (name: string) => within(items().find((li) => li.textContent?.includes(name))!).getByRole('button');

describe('список и формат', () => {
  it('товары в исходном порядке, цена в формате ru-RU с ₽', () => {
    render(<ProductCatalog products={P} />);
    const li = items();
    expect(li).toHaveLength(5);
    expect(norm(li[0]!.textContent)).toContain('Кофе зерновой');
    expect(norm(li[0]!.textContent)).toContain('1 990 ₽');
    expect(norm(li[3]!.textContent)).toContain('12 500 ₽');
    expect(norm(screen.getByText(/Найдено:/).textContent)).toBe('Найдено: 5');
  });

  it('категории: «Все» первой, затем уникальные по алфавиту', () => {
    render(<ProductCatalog products={P} />);
    const opts = within(screen.getByLabelText('Категория')).getAllByRole('option').map((o) => norm(o.textContent));
    expect(opts).toEqual(['Все', 'Аксессуары', 'Кофе', 'Чай']);
  });
});

describe('фильтры', () => {
  it('поиск без учёта регистра и пробелов по краям', () => {
    render(<ProductCatalog products={P} />);
    search('  КОФЕ ');
    expect(items().map((li) => norm(li.textContent))).toHaveLength(2);
    expect(norm(screen.getByText(/Найдено:/).textContent)).toBe('Найдено: 2');
  });

  it('категория и поиск вместе', () => {
    render(<ProductCatalog products={P} />);
    category('Аксессуары');
    expect(items()).toHaveLength(2);
    search('турка');
    expect(items()).toHaveLength(1);
    expect(norm(items()[0]!.textContent)).toContain('Турка медная');
  });

  it('пусто – «Ничего не найдено» и сброс фильтров', () => {
    render(<ProductCatalog products={P} />);
    category('Чай');
    search('кофе');
    expect(screen.queryByRole('list', { name: 'Товары' })).toBeNull();
    expect(screen.getByText('Ничего не найдено')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    expect(items()).toHaveLength(5);
    expect((screen.getByLabelText('Поиск') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Категория') as HTMLSelectElement).value === 'Все' || (screen.getByLabelText('Категория') as HTMLSelectElement).selectedIndex === 0).toBe(true);
  });

  it('пустой каталог', () => {
    render(<ProductCatalog products={[]} />);
    expect(screen.getByText('Ничего не найдено')).toBeTruthy();
    expect(norm(screen.getByText(/Найдено:/).textContent)).toBe('Найдено: 0');
  });
});

describe('корзина', () => {
  it('изначально пустая', () => {
    render(<ProductCatalog products={P} />);
    expect(cart()).toContain('Товаров: 0');
    expect(cart()).toContain('Сумма: 0 ₽');
  });

  it('каждое нажатие – штука; сумма в формате ru-RU', () => {
    render(<ProductCatalog products={P} />);
    fireEvent.click(addButton('Какао'));
    fireEvent.click(addButton('Какао'));
    fireEvent.click(addButton('Чай улун'));
    expect(cart()).toContain('Товаров: 3');
    expect(cart()).toContain('Сумма: 25 750 ₽');
  });

  it('не в наличии – выключенная кнопка «Нет в наличии»', () => {
    render(<ProductCatalog products={P} />);
    const btn = addButton('Кофе молотый') as HTMLButtonElement;
    expect(norm(btn.textContent)).toBe('Нет в наличии');
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(cart()).toContain('Товаров: 0');
    expect(screen.getAllByRole('button', { name: 'В корзину' })).toHaveLength(4);
  });

  it('корзина переживает смену фильтров', () => {
    render(<ProductCatalog products={P} />);
    fireEvent.click(addButton('Кофе зерновой'));
    category('Чай');
    search('улун');
    expect(cart()).toContain('Товаров: 1');
    expect(cart()).toContain('Сумма: 1 990 ₽');
  });
});
