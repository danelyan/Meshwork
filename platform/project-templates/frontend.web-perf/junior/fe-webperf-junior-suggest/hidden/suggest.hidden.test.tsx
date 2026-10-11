// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SuggestInput } from '../src/SuggestInput';
import { debounce, throttle } from '../src/timing';

import { installFakeFetch } from './helpers/fake-fetch';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const box = () => screen.getByRole('textbox', { name: 'Поиск' });
const type = (v: string) => fireEvent.change(box(), { target: { value: v } });
const titles = () => screen.queryAllByRole('listitem').map((li) => li.textContent);
const status = () => screen.queryByRole('status')?.textContent ?? null;

describe('debounce', () => {
  it('вызывает fn один раз после последнего обращения, с его аргументами', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d(1, 'a');
    vi.advanceTimersByTime(60);
    d(2, 'b');
    vi.advanceTimersByTime(60);
    d(3, 'c');
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn.mock.calls).toEqual([[3, 'c']]);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('cancel отбрасывает ожидающий вызов; после него debounce работает снова', () => {
    const fn = vi.fn();
    const d = debounce(fn, 50);
    d('a');
    d.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
    d('b');
    vi.advanceTimersByTime(50);
    expect(fn.mock.calls).toEqual([['b']]);
  });
});

describe('throttle', () => {
  it('первый вызов выполняется сразу, остальные в окне схлопываются в один с последними аргументами', () => {
    const fn = vi.fn();
    const t = throttle(fn, 100);
    t('a');
    expect(fn.mock.calls).toEqual([['a']]);
    t('b');
    t('c');
    t('d');
    vi.advanceTimersByTime(99);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fn.mock.calls).toEqual([['a'], ['d']]);
  });

  it('после хвостового вызова начинается новое окно', () => {
    const fn = vi.fn();
    const t = throttle(fn, 100);
    t(1);
    t(2);
    vi.advanceTimersByTime(100); // хвост (2), окно открыто заново
    t(3);
    vi.advanceTimersByTime(99);
    expect(fn.mock.calls).toEqual([[1], [2]]);
    vi.advanceTimersByTime(1);
    expect(fn.mock.calls).toEqual([[1], [2], [3]]);
    vi.advanceTimersByTime(100); // окно закрылось без запомненных вызовов
    t(4);
    expect(fn.mock.calls).toEqual([[1], [2], [3], [4]]);
  });

  it('cancel сбрасывает окно и запомненный вызов', () => {
    const fn = vi.fn();
    const t = throttle(fn, 100);
    t('a');
    t('b');
    t.cancel();
    vi.advanceTimersByTime(500);
    expect(fn.mock.calls).toEqual([['a']]);
    t('c');
    expect(fn.mock.calls).toEqual([['a'], ['c']]);
  });
});

describe('запросы', () => {
  it('быстрый ввод – один запрос с последним значением; до паузы fetch не вызывается', async () => {
    const f = installFakeFetch();
    render(<SuggestInput />);
    type('re');
    await advance(100);
    type('rea');
    await advance(100);
    type('reac');
    await advance(299);
    expect(f.fetchMock).not.toHaveBeenCalled();
    await advance(1);
    expect(f.queries()).toEqual(['reac']);
    expect(f.calls[0]!.url).toBe('/api/suggest?q=reac');
  });

  it('debounceMs из пропсов; запрос кодируется и обрезается по краям', async () => {
    const f = installFakeFetch();
    render(<SuggestInput debounceMs={50} />);
    type('  а б&в  ');
    await advance(49);
    expect(f.calls).toHaveLength(0);
    await advance(1);
    expect(f.calls[0]!.url).toBe('/api/suggest?q=' + encodeURIComponent('а б&в'));
  });

  it('короче minLength не отправляется; пробелы по краям не считаются', async () => {
    const f = installFakeFetch();
    render(<SuggestInput />);
    type('a');
    await advance(1000);
    type('  b  ');
    await advance(1000);
    expect(f.calls).toHaveLength(0);
    expect(box()).toBeTruthy();
    type('ab');
    await advance(300);
    expect(f.queries()).toEqual(['ab']);
  });

  it('minLength из пропсов', async () => {
    const f = installFakeFetch();
    render(<SuggestInput minLength={4} />);
    type('abc');
    await advance(1000);
    expect(f.calls).toHaveLength(0);
    type('abcd');
    await advance(300);
    expect(f.queries()).toEqual(['abcd']);
  });

  it('загрузка, затем список; пустой ответ – «Ничего не найдено»', async () => {
    const f = installFakeFetch();
    render(<SuggestInput />);
    type('кот');
    await advance(300);
    expect(status()).toBe('Загрузка…');
    expect(titles()).toEqual([]);
    await act(async () => f.last().respond(['Котлета', 'Котёл']));
    expect(titles()).toEqual(['Котлета', 'Котёл']);
    expect(screen.getByRole('list', { name: 'Подсказки' })).toBeTruthy();
    expect(status()).toBeNull();
    type('zzz');
    await advance(300);
    await act(async () => f.last().respond([]));
    expect(status()).toBe('Ничего не найдено');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('новый запрос отменяет предыдущий в полёте', async () => {
    const f = installFakeFetch();
    render(<SuggestInput />);
    type('первый');
    await advance(300);
    expect(f.calls[0]!.signal.aborted).toBe(false);
    type('второй');
    await advance(300);
    expect(f.calls[0]!.signal.aborted).toBe(true);
    expect(f.calls[1]!.signal.aborted).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull(); // отмена – не ошибка
    expect(status()).toBe('Загрузка…');
    await act(async () => f.calls[1]!.respond(['Второй']));
    expect(titles()).toEqual(['Второй']);
  });

  it('устаревший ответ не показывается, даже если fetch проигнорировал отмену и ответил позже', async () => {
    const f = installFakeFetch({ ignoreAbort: true });
    render(<SuggestInput />);
    type('старый');
    await advance(300);
    type('новый');
    await advance(300);
    await act(async () => f.calls[1]!.respond(['Новый']));
    await act(async () => f.calls[0]!.respond(['Старый']));
    expect(titles()).toEqual(['Новый']);
  });

  it('устаревший ответ, пришедший раньше нового, тоже не показывается', async () => {
    const f = installFakeFetch({ ignoreAbort: true });
    render(<SuggestInput />);
    type('старый');
    await advance(300);
    type('новый');
    await advance(300);
    await act(async () => f.calls[0]!.respond(['Старый']));
    expect(titles()).toEqual([]);
    expect(status()).toBe('Загрузка…');
    await act(async () => f.calls[1]!.respond(['Новый']));
    expect(titles()).toEqual(['Новый']);
  });

  it('очистка поля или короткий запрос отменяет запрос в полёте и убирает список', async () => {
    const f = installFakeFetch();
    render(<SuggestInput />);
    type('react');
    await advance(300);
    await act(async () => f.last().respond(['react']));
    expect(titles()).toEqual(['react']);
    type('reactiv');
    await advance(300);
    const inflight = f.last();
    type('');
    await advance(0);
    expect(inflight.signal.aborted).toBe(true);
    expect(titles()).toEqual([]);
    expect(status()).toBeNull();
    await advance(1000);
    expect(f.calls).toHaveLength(2);
  });

  it('тот же запрос повторно не отправляется (добавили пробел, вернули прежнее значение)', async () => {
    const f = installFakeFetch();
    render(<SuggestInput />);
    type('react');
    await advance(300);
    await act(async () => f.last().respond(['react']));
    type('react ');
    await advance(1000);
    type(' react');
    await advance(1000);
    expect(f.calls).toHaveLength(1);
    expect(titles()).toEqual(['react']);
  });
});

describe('ошибки и размонтирование', () => {
  it('res.ok === false и сетевая ошибка – alert; следующий успешный запрос его убирает', async () => {
    const f = installFakeFetch();
    render(<SuggestInput />);
    type('aa');
    await advance(300);
    await act(async () => f.last().fail(503));
    expect(screen.getByRole('alert').textContent).toBe('Не удалось загрузить');
    expect(status()).toBeNull();
    type('bb');
    await advance(300);
    await act(async () => f.last().networkError());
    expect(screen.getByRole('alert').textContent).toBe('Не удалось загрузить');
    type('cc');
    await advance(300);
    await act(async () => f.last().respond(['cc']));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(titles()).toEqual(['cc']);
  });

  it('размонтирование в паузе: fetch после него не вызывается', async () => {
    const f = installFakeFetch();
    const { unmount } = render(<SuggestInput />);
    type('aa');
    await advance(300);
    expect(f.fetchMock).toHaveBeenCalledTimes(1);
    type('react');
    await advance(100);
    unmount();
    await advance(1000);
    expect(f.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('размонтирование с запросом в полёте: отмена и тишина в консоли', async () => {
    const f = installFakeFetch({ ignoreAbort: true });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(<SuggestInput />);
    type('react');
    await advance(300);
    const call = f.last();
    expect(call.signal.aborted).toBe(false);
    unmount();
    expect(call.signal.aborted).toBe(true);
    await act(async () => call.respond(['react']));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
