// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SearchBox, type Item } from '../../src/SearchBox';

afterEach(cleanup);

describe('поиск (visible)', () => {
  it('поле поиска – combobox с именем «Поиск»', () => {
    render(<SearchBox search={async () => []} onSelect={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Поиск' })).toBeTruthy();
  });

  it('после паузы ввода показывает найденное', async () => {
    const queries: string[] = [];
    const search = async (q: string): Promise<Item[]> => {
      queries.push(q);
      return [{ id: '1', title: 'Москва' }];
    };
    render(<SearchBox search={search} onSelect={() => {}} debounceMs={10} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Мос' } });
    await act(() => new Promise<void>((r) => setTimeout(r, 50)));
    expect(queries).toEqual(['Мос']);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Москва']);
  });
});
