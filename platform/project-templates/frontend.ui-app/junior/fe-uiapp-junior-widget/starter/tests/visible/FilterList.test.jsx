// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import FilterList from '../../src/FilterList.jsx';

afterEach(cleanup);

describe('FilterList (visible)', () => {
  it('показывает все элементы при пустом запросе', () => {
    render(<FilterList items={['Москва', 'Казань']} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('фильтрует по подстроке', () => {
    render(<FilterList items={['Москва', 'Казань']} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Фильтр' }), { target: { value: 'каз' } });
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Казань']);
  });
});
