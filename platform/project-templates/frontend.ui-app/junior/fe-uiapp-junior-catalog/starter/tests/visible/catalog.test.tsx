// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProductCatalog } from '../../src/ProductCatalog';

import { PRODUCTS } from './fixtures';

afterEach(cleanup);

describe('каталог (visible)', () => {
  it('показывает товары и счётчик', () => {
    render(<ProductCatalog products={PRODUCTS} />);
    expect(within(screen.getByRole('list', { name: 'Товары' })).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Найдено: 3')).toBeTruthy();
  });

  it('поиск фильтрует по названию', () => {
    render(<ProductCatalog products={PRODUCTS} />);
    fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'чай' } });
    expect(screen.getByText('Найдено: 1')).toBeTruthy();
  });
});
