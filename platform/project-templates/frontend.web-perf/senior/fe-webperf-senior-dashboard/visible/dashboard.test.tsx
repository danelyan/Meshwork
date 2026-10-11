// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Dashboard } from '../../src/Dashboard';

import { counter, flush, makeHarness, settle, specs } from './harness';

afterEach(cleanup);

const widget = (title: string) => screen.getByRole('region', { name: title });

describe('кэш (visible)', () => {
  it('запрос в полёте переиспользуется, свежие данные берутся из кэша', async () => {
    const h = makeHarness(1000);
    const a = h.cache.fetch('k');
    const b = h.cache.fetch('k');
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    h.callsFor('k')[0]!.resolve({ value: 1 });
    expect(await a).toEqual({ value: 1 });
    expect(await b).toEqual({ value: 1 });
    h.tick(999);
    await h.cache.fetch('k');
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    h.tick(1);
    void h.cache.fetch('k');
    expect(h.fetcher).toHaveBeenCalledTimes(2);
  });

  it('peek возвращает один и тот же снимок, пока запись не менялась', async () => {
    const h = makeHarness();
    expect(h.cache.peek('k').status).toBe('idle');
    const p = h.cache.fetch('k');
    expect(h.cache.peek('k')).toBe(h.cache.peek('k'));
    h.callsFor('k')[0]!.resolve({ value: 5 });
    await p;
    expect(h.cache.peek('k')).toMatchObject({ status: 'success', data: { value: 5 } });
  });
});

describe('дашборд (visible)', () => {
  it('один запрос на ключ; значения появляются по мере ответов', async () => {
    const h = makeHarness();
    render(<Dashboard cache={h.cache} widgets={specs()} />);
    await settle();
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('status')).toHaveLength(3);
    await act(async () => {
      h.callsFor('sales')[0]!.resolve({ value: 120 });
      await flush();
    });
    expect(within(widget('Выручка')).getByTestId('value').textContent).toBe('120');
    expect(within(widget('Пользователи')).getByRole('status').textContent).toBe('Загрузка…');
  });

  it('«Компактный вид» не перерисовывает виджеты', async () => {
    const h = makeHarness();
    const c = counter();
    render(<Dashboard cache={h.cache} widgets={specs()} onWidgetRender={c.onWidgetRender} />);
    await settle();
    await act(async () => {
      h.callsFor('sales')[0]!.resolve({ value: 1 });
      h.callsFor('users')[0]!.resolve({ value: 2 });
      await flush();
    });
    const before = c.snapshot();
    fireEvent.click(screen.getByRole('button', { name: 'Компактный вид' }));
    expect(document.querySelector('[data-compact]')!.getAttribute('data-compact')).toBe('true');
    expect(c.snapshot()).toEqual(before);
  });

  it('ошибка виджета и «Повторить»', async () => {
    const h = makeHarness();
    render(<Dashboard cache={h.cache} widgets={specs()} />);
    await settle();
    await act(async () => {
      h.callsFor('users')[0]!.reject(new Error('500'));
      await flush();
    });
    expect(within(widget('Пользователи')).getByRole('alert').textContent).toContain('Не удалось загрузить');
    fireEvent.click(within(widget('Пользователи')).getByRole('button', { name: 'Повторить' }));
    expect(h.callsFor('users')).toHaveLength(2);
  });
});
