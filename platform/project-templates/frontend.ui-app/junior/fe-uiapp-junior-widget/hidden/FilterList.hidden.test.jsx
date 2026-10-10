// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются, запускаются только из каталога платформы
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import FilterList from '../src/FilterList.jsx';

afterEach(cleanup);

const ITEMS = ['Москва', 'Казань', 'Нижний Новгород', 'Новосибирск'];
const box = () => screen.getByRole('searchbox', { name: 'Фильтр' });
const type = (value) => fireEvent.change(box(), { target: { value } });
const texts = () => screen.queryAllByRole('listitem').map((li) => li.textContent);

describe('render', () => {
  it('поле поиска с именем «Фильтр» и плейсхолдером по умолчанию', () => {
    render(<FilterList items={ITEMS} />);
    expect(box().getAttribute('placeholder')).toBe('Поиск');
  });

  it('свой placeholder', () => {
    render(<FilterList items={ITEMS} placeholder="Город" />);
    expect(box().getAttribute('placeholder')).toBe('Город');
  });

  it('пустой запрос — все элементы в исходном порядке', () => {
    render(<FilterList items={ITEMS} />);
    expect(texts()).toEqual(ITEMS);
  });
});

describe('filter', () => {
  it('без учёта регистра', () => {
    render(<FilterList items={ITEMS} />);
    type('НОВ');
    expect(texts()).toEqual(['Нижний Новгород', 'Новосибирск']);
  });

  it('пробелы по краям запроса не учитываются', () => {
    render(<FilterList items={ITEMS} />);
    type('  казань ');
    expect(texts()).toEqual(['Казань']);
  });

  it('счётчик Найдено: N', () => {
    render(<FilterList items={ITEMS} />);
    expect(screen.getByRole('status').textContent).toBe('Найдено: 4');
    type('нов');
    expect(screen.getByRole('status').textContent).toBe('Найдено: 2');
  });

  it('нет совпадений — текст и нет списка', () => {
    render(<FilterList items={ITEMS} />);
    type('Тверь');
    expect(screen.getByText('Ничего не найдено')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Найдено: 0');
  });
});

describe('clear', () => {
  it('кнопка неактивна при пустом запросе', () => {
    render(<FilterList items={ITEMS} />);
    expect(screen.getByRole('button', { name: 'Очистить' }).hasAttribute('disabled')).toBe(true);
  });

  it('сбрасывает запрос и возвращает фокус в поле', () => {
    render(<FilterList items={ITEMS} />);
    type('мос');
    const btn = screen.getByRole('button', { name: 'Очистить' });
    expect(btn.hasAttribute('disabled')).toBe(false);
    fireEvent.click(btn);
    expect(box().value).toBe('');
    expect(texts()).toEqual(ITEMS);
    expect(document.activeElement).toBe(box());
  });
});
