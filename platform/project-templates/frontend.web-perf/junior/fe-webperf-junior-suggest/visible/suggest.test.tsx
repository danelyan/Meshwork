// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SuggestInput } from '../../src/SuggestInput';
import { debounce, throttle } from '../../src/timing';

import { installFakeFetch } from './fake-fetch';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const type = (v: string) => fireEvent.change(screen.getByRole('textbox', { name: 'Поиск' }), { target: { value: v } });

describe('подсказки (visible)', () => {
  it('debounce: один вызов с последними аргументами после паузы', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('a');
    d('b');
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn.mock.calls).toEqual([['b']]);
  });

  it('throttle: первый вызов сразу, в конце окна – последний из запомненных', () => {
    const fn = vi.fn();
    const t = throttle(fn, 100);
    t(1);
    t(2);
    t(3);
    expect(fn.mock.calls).toEqual([[1]]);
    vi.advanceTimersByTime(100);
    expect(fn.mock.calls).toEqual([[1], [3]]);
  });

  it('быстрый ввод – один запрос с последним значением', async () => {
    const f = installFakeFetch();
    render(<SuggestInput />);
    type('re');
    await advance(100);
    type('reac');
    await advance(299);
    expect(f.calls).toHaveLength(0);
    await advance(1);
    expect(f.queries()).toEqual(['reac']);
  });

  it('показывает подсказки', async () => {
    const f = installFakeFetch();
    render(<SuggestInput />);
    type('rea');
    await advance(300);
    await act(async () => f.last().respond(['react', 'reactive']));
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['react', 'reactive']);
  });
});
