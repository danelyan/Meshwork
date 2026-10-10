// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SearchBox } from '../src/SearchBox';

import { controlledSearch, items } from './helpers/search-api';

afterEach(cleanup);

const DEBOUNCE = 15;
const pause = (ms = DEBOUNCE * 3) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const box = () => screen.getByRole('combobox') as HTMLInputElement;
const type = (v: string) => fireEvent.change(box(), { target: { value: v } });
const options = () => screen.queryAllByRole('option').map((o) => o.textContent);
const status = () => screen.queryByRole('status')?.textContent ?? null;

function setup(label?: string) {
  const s = controlledSearch();
  const onSelect = vi.fn();
  render(<SearchBox search={s.search} onSelect={onSelect} debounceMs={DEBOUNCE} label={label} />);
  return { s, onSelect };
}

async function typed(v: string) {
  type(v);
  await pause();
}

describe('запросы', () => {
  it('дребезг: быстрый ввод — один запрос с последним значением, без пробелов по краям', async () => {
    const { s } = setup();
    type('r');
    type('re');
    type(' rea ');
    expect(s.calls).toHaveLength(0);
    await pause();
    expect(s.queries()).toEqual(['rea']);
  });

  it('загрузка, затем список; aria-expanded и aria-controls', async () => {
    const { s } = setup();
    await typed('кот');
    expect(status()).toBe('Загрузка…');
    expect(box().getAttribute('aria-expanded')).toBe('false');
    await act(async () => s.last().resolve(items('Котлета', 'Котёл')));
    expect(options()).toEqual(['Котлета', 'Котёл']);
    expect(status()).toBeNull();
    expect(box().getAttribute('aria-expanded')).toBe('true');
    expect(box().getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id);
    expect(box().getAttribute('aria-autocomplete')).toBe('list');
  });

  it('пустой ответ — «Ничего не найдено», список закрыт', async () => {
    const { s } = setup();
    await typed('zzz');
    await act(async () => s.last().resolve([]));
    expect(status()).toBe('Ничего не найдено');
    expect(box().getAttribute('aria-expanded')).toBe('false');
  });

  it('пустой запрос отменяет запрос в полёте и не вызывает search', async () => {
    const { s } = setup();
    await typed('ab');
    type('   ');
    await pause();
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.signal.aborted).toBe(true);
    await act(async () => s.calls[0]!.resolve(items('A')));
    expect(options()).toEqual([]);
  });

  it('гонка: новый запрос отменяет старый; поздний ответ старого не показывается', async () => {
    const { s } = setup();
    await typed('a');
    await typed('ab');
    expect(s.queries()).toEqual(['a', 'ab']);
    expect(s.calls[0]!.signal.aborted).toBe(true);
    expect(s.calls[1]!.signal.aborted).toBe(false);
    await act(async () => s.calls[0]!.resolve(items('Старый')));
    expect(options()).toEqual([]);
    expect(status()).toBe('Загрузка…');
    await act(async () => s.calls[1]!.resolve(items('Новый')));
    expect(options()).toEqual(['Новый']);
    await act(async () => s.calls[0]!.resolve(items('Старый ещё раз')));
    expect(options()).toEqual(['Новый']);
  });

  it('ошибка отменённого запроса не показывается', async () => {
    const { s } = setup();
    await typed('a');
    await typed('ab');
    await act(async () => s.calls[0]!.reject(new DOMException('aborted', 'AbortError')));
    await act(async () => s.calls[1]!.resolve(items('Б')));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(options()).toEqual(['Б']);
  });

  it('ошибка — alert и «Повторить» сразу повторяет тот же запрос', async () => {
    const { s } = setup();
    await typed('ёж');
    await act(async () => s.last().reject(new Error('500')));
    expect(screen.getByRole('alert').textContent).toContain('Не удалось загрузить');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(s.queries()).toEqual(['ёж', 'ёж']);
    await act(async () => s.last().resolve(items('Ёжик')));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(options()).toEqual(['Ёжик']);
  });

  it('кэш: повтор запроса — без вызова search и без «Загрузка…»', async () => {
    const { s } = setup();
    await typed('go');
    await act(async () => s.last().resolve(items('Go')));
    await typed('gol');
    await act(async () => s.last().resolve(items('Golang')));
    await typed('go');
    expect(s.calls).toHaveLength(2);
    expect(status()).toBeNull();
    expect(options()).toEqual(['Go']);
  });

  it('кэш на 20 запросов: самый давний вытесняется (LRU)', async () => {
    const { s } = setup();
    for (let i = 0; i <= 20; i++) {
      await typed(`q${i}`);
      await act(async () => s.last().resolve(items(`r${i}`)));
    }
    expect(s.calls).toHaveLength(21);
    await typed('q19');
    expect(s.calls).toHaveLength(21);
    expect(options()).toEqual(['r19']);
    await typed('q0');
    expect(s.calls).toHaveLength(22);
  }, 20_000);
});

describe('combobox и клавиатура', () => {
  async function withList() {
    const ctx = setup();
    await typed('ко');
    await act(async () => ctx.s.last().resolve(items('Кофе', 'Какао', 'Компот')));
    return ctx;
  }
  const activeText = () => {
    const id = box().getAttribute('aria-activedescendant');
    return id ? document.getElementById(id)?.textContent : null;
  };

  it('доступное имя: по умолчанию «Поиск», можно задать своё', () => {
    setup();
    expect(screen.getByRole('combobox', { name: 'Поиск' })).toBeTruthy();
    cleanup();
    setup('Найти город');
    expect(screen.getByRole('combobox', { name: 'Найти город' })).toBeTruthy();
  });

  it('стрелки по кругу, aria-activedescendant и aria-selected', async () => {
    await withList();
    expect(box().getAttribute('aria-activedescendant')).toBeNull();
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(activeText()).toBe('Кофе');
    expect(screen.getByRole('option', { name: 'Кофе' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('option', { name: 'Какао' }).getAttribute('aria-selected')).toBe('false');
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    expect(activeText()).toBe('Компот');
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(activeText()).toBe('Кофе');
    const ids = screen.getAllByRole('option').map((o) => o.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('Enter выбирает активный пункт, клик — пункт под курсором', async () => {
    const { onSelect } = await withList();
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith({ id: 'Какао-1', title: 'Какао' });
    fireEvent.click(screen.getByRole('option', { name: 'Компот' }));
    expect(onSelect).toHaveBeenLastCalledWith({ id: 'Компот-2', title: 'Компот' });
  });

  it('Escape закрывает список, текст остаётся', async () => {
    await withList();
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(box().getAttribute('aria-expanded')).toBe('false');
    expect(options()).toEqual([]);
    expect(box().value).toBe('ко');
  });
});

describe('DESIGN.md', () => {
  it('разделы «Решения», «Компромиссы», «Границы применимости» не короче 200 символов', () => {
    // new URL(…) в jsdom — URL из jsdom; путь считаем от файла теста.
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../DESIGN.md');
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, 'utf8');
    for (const h of ['Решения', 'Компромиссы', 'Границы применимости']) {
      const m = new RegExp(`^## ${h}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(text);
      expect(m, h).not.toBeNull();
      expect(m![1]!.trim().length, h).toBeGreaterThanOrEqual(200);
    }
  });
});
