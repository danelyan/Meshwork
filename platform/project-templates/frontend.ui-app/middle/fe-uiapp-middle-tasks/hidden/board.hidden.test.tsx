// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TaskBoard } from '../src/TaskBoard';

import { TASKS, controlledApi } from './helpers/fake-api';

afterEach(cleanup);

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
const remaining = () => norm(screen.getByText(/Осталось:/).textContent);

async function loaded() {
  const c = controlledApi();
  render(<TaskBoard api={c.api} />);
  await act(async () => c.last('list').d.resolve(TASKS.map((t) => ({ ...t }))));
  return c;
}

async function typeAndSubmit(text: string) {
  fireEvent.change(screen.getByLabelText('Новая задача'), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
  });
}

describe('загрузка', () => {
  it('статус загрузки, затем список в порядке сервера', async () => {
    const c = controlledApi();
    render(<TaskBoard api={c.api} />);
    expect(norm(screen.getByRole('status').textContent)).toContain('Загрузка');
    await act(async () => c.last('list').d.resolve(TASKS));
    expect(screen.queryByRole('status')?.textContent ?? '').not.toContain('Загрузка');
    expect(screen.getAllByRole('checkbox').map((b) => b.getAttribute('aria-label') ?? b.closest('label')?.textContent ?? '').map(norm)).toHaveLength(3);
    expect(box('Позвонить маме').checked).toBe(true);
    expect(remaining()).toBe('Осталось: 2');
  });

  it('ошибка загрузки — alert и «Повторить» вызывает list снова', async () => {
    const c = controlledApi();
    render(<TaskBoard api={c.api} />);
    await act(async () => c.last('list').d.reject(new Error('500')));
    expect(norm(screen.getByRole('alert').textContent)).toContain('Не удалось загрузить задачи');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    });
    expect(c.calls.filter((x) => x.method === 'list')).toHaveLength(2);
    await act(async () => c.last('list').d.resolve(TASKS));
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.queryByText('Не удалось загрузить задачи')).toBeNull();
  });
});

describe('оптимистичное обновление', () => {
  it('чекбокс и счётчик меняются до ответа, чекбокс выключен на время запроса', async () => {
    const c = await loaded();
    await act(async () => {
      fireEvent.click(box('Купить молоко'));
    });
    expect(box('Купить молоко').checked).toBe(true);
    expect(box('Купить молоко').disabled).toBe(true);
    expect(remaining()).toBe('Осталось: 1');
    expect(c.last('setDone').args).toEqual(['t1', true]);
    await act(async () => c.last('setDone').d.resolve({ id: 't1', title: 'Купить молоко', done: true }));
    expect(box('Купить молоко').disabled).toBe(false);
    expect(box('Купить молоко').checked).toBe(true);
  });

  it('ошибка — откат и alert', async () => {
    const c = await loaded();
    await act(async () => {
      fireEvent.click(box('Позвонить маме'));
    });
    expect(box('Позвонить маме').checked).toBe(false);
    await act(async () => c.last('setDone').d.reject(new Error('409')));
    expect(box('Позвонить маме').checked).toBe(true);
    expect(remaining()).toBe('Осталось: 2');
    expect(norm(screen.getByRole('alert').textContent)).toContain('Не удалось сохранить изменение');
  });
});

describe('создание', () => {
  it('пустое и длинное название не отправляются', async () => {
    const c = await loaded();
    await typeAndSubmit('   ');
    expect(screen.getByText('Введите название')).toBeTruthy();
    await typeAndSubmit('я'.repeat(121));
    expect(screen.getByText('Не длиннее 120 символов')).toBeTruthy();
    expect(c.calls.filter((x) => x.method === 'create')).toHaveLength(0);
  });

  it('обрезка, блокировка повторной отправки, задача в конце, поле очищено', async () => {
    const c = await loaded();
    await typeAndSubmit('  Новая  ');
    expect(c.last('create').args).toEqual(['Новая']);
    expect((screen.getByRole('button', { name: 'Добавить' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('Новая задача').closest('form')!);
    });
    expect(c.calls.filter((x) => x.method === 'create')).toHaveLength(1);
    await act(async () => c.last('create').d.resolve({ id: 't9', title: 'Новая', done: false }));
    const names = screen.getAllByRole('checkbox');
    expect(names).toHaveLength(4);
    expect(box('Новая').checked).toBe(false);
    expect(names[3]).toBe(box('Новая'));
    expect((screen.getByLabelText('Новая задача') as HTMLInputElement).value).toBe('');
    expect(remaining()).toBe('Осталось: 3');
  });

  it('ошибка создания — alert, текст остаётся', async () => {
    const c = await loaded();
    await typeAndSubmit('Отчёт');
    await act(async () => c.last('create').d.reject(new Error('500')));
    expect(norm(screen.getByRole('alert').textContent)).toContain('Не удалось добавить задачу');
    expect((screen.getByLabelText('Новая задача') as HTMLInputElement).value).toBe('Отчёт');
    expect((screen.getByRole('button', { name: 'Добавить' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('фильтры', () => {
  it('Все / Активные / Готовые с aria-pressed', async () => {
    await loaded();
    expect(screen.getByRole('button', { name: 'Все' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Активные' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Активные' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Все' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Готовые' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(box('Позвонить маме')).toBeTruthy();
  });
});
