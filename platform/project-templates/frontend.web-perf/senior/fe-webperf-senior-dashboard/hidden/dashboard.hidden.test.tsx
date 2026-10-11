// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dashboard } from '../src/Dashboard';

import { counter, flush, makeHarness, settle, specs } from './helpers/harness';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const widget = (title: string) => screen.getByRole('region', { name: title });
const valueOf = (title: string) => within(widget(title)).queryByTestId('value')?.textContent ?? null;
const isLoading = (title: string) => within(widget(title)).queryByRole('status') !== null;

describe('кэш запросов', () => {
  it('дедуплицирует запросы в полёте и считает свежесть по ttl (граница включена в «устарело»)', async () => {
    const h = makeHarness(1000);
    const a = h.cache.fetch('k');
    const b = h.cache.fetch('k');
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    h.callsFor('k')[0]!.resolve({ value: 1 });
    expect(await a).toEqual({ value: 1 });
    expect(await b).toEqual({ value: 1 });
    h.tick(999);
    expect(await h.cache.fetch('k')).toEqual({ value: 1 });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    h.tick(1);
    void h.cache.fetch('k');
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    void h.cache.fetch('other');
    expect(h.fetcher).toHaveBeenCalledTimes(3);
  });

  it('force обходит свежий кэш, но не дублирует запрос в полёте', async () => {
    const h = makeHarness(1000);
    const first = h.cache.fetch('k');
    h.callsFor('k')[0]!.resolve({ value: 1 });
    await first;
    const forced = h.cache.fetch('k', { force: true });
    const again = h.cache.fetch('k', { force: true });
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    h.callsFor('k')[1]!.resolve({ value: 2 });
    expect(await forced).toEqual({ value: 2 });
    expect(await again).toEqual({ value: 2 });
  });

  it('peek: стабильная ссылка, idle для неизвестного ключа, loading → success', async () => {
    const h = makeHarness();
    expect(h.cache.peek('k')).toEqual({ status: 'idle', data: undefined, error: undefined });
    expect(h.cache.peek('k')).toBe(h.cache.peek('k'));
    const p = h.cache.fetch('k');
    const loading = h.cache.peek('k');
    expect(loading.status).toBe('loading');
    expect(h.cache.peek('k')).toBe(loading);
    h.callsFor('k')[0]!.resolve({ value: 5 });
    await p;
    const done = h.cache.peek('k');
    expect(done).toMatchObject({ status: 'success', data: { value: 5 } });
    expect(h.cache.peek('k')).toBe(done);
  });

  it('структурное разделение: равные данные — прежняя ссылка и тишина у подписчиков', async () => {
    const h = makeHarness(1000);
    const listener = vi.fn();
    const p = h.cache.fetch('k');
    h.callsFor('k')[0]!.resolve({ value: 1 });
    await p;
    const before = h.cache.peek('k');
    h.cache.subscribe('k', listener);
    h.cache.invalidate('k');
    const p2 = h.cache.fetch('k');
    h.callsFor('k')[1]!.resolve({ value: 1 });
    await p2;
    expect(h.cache.peek('k')).toBe(before);
    expect(h.cache.peek('k').data).toBe(before.data);
    expect(listener).not.toHaveBeenCalled();
    h.cache.invalidate('k');
    const p3 = h.cache.fetch('k');
    h.callsFor('k')[2]!.resolve({ value: 2 });
    await p3;
    expect(listener).toHaveBeenCalledTimes(1);
    expect(h.cache.peek('k').data).toEqual({ value: 2 });
  });

  it('ошибки: не кэшируются, прежние данные не затираются, синхронный throw даёт отклонение', async () => {
    const h = makeHarness(1000);
    const bad = h.cache.fetch('k');
    h.callsFor('k')[0]!.reject(new Error('boom'));
    await expect(bad).rejects.toThrow('boom');
    expect(h.cache.peek('k')).toMatchObject({ status: 'error' });
    expect((h.cache.peek('k').error as Error).message).toBe('boom');
    const retry = h.cache.fetch('k');
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(h.cache.peek('k').status).toBe('loading');
    h.callsFor('k')[1]!.resolve({ value: 3 });
    await retry;
    expect(h.cache.peek('k')).toMatchObject({ status: 'success', data: { value: 3 }, error: undefined });
    h.tick(1000);
    const again = h.cache.fetch('k');
    h.callsFor('k')[2]!.reject(new Error('later'));
    await expect(again).rejects.toThrow('later');
    expect(h.cache.peek('k')).toMatchObject({ status: 'error', data: { value: 3 } });

    const throwing = makeHarness();
    const c = (await import('../src/queryCache')).createQueryCache({
      fetcher: () => {
        throw new Error('sync');
      },
      ttlMs: 10,
      now: () => 0,
    });
    await expect(c.fetch('x')).rejects.toThrow('sync');
    expect(throwing.fetcher).not.toHaveBeenCalled();
  });

  it('invalidate: следующий fetch идёт в сеть, данные остаются; неизвестный ключ не создаёт запись', async () => {
    const h = makeHarness(1000);
    h.cache.invalidate('ghost');
    expect(h.cache.peek('ghost').status).toBe('idle');
    const p = h.cache.fetch('k');
    h.callsFor('k')[0]!.resolve({ value: 1 });
    await p;
    h.cache.invalidate('k');
    expect(h.cache.peek('k').data).toEqual({ value: 1 });
    void h.cache.fetch('k');
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(h.cache.peek('k')).toMatchObject({ status: 'success', data: { value: 1 } });
  });

  it('invalidate при запросе в полёте: поздний ответ старого не перезаписывает новый', async () => {
    const h = makeHarness(1000);
    const listener = vi.fn();
    h.cache.subscribe('k', listener);
    const oldP = h.cache.fetch('k');
    h.cache.invalidate('k');
    const newP = h.cache.fetch('k');
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    h.callsFor('k')[1]!.resolve({ value: 'new' });
    expect(await newP).toEqual({ value: 'new' });
    h.callsFor('k')[0]!.resolve({ value: 'old' });
    expect(await oldP).toEqual({ value: 'old' });
    expect(h.cache.peek('k').data).toEqual({ value: 'new' });
    // без нового запроса ответ устаревшего записывается, но запись остаётся устаревшей
    const h2 = makeHarness(1000);
    const p = h2.cache.fetch('z');
    h2.cache.invalidate('z');
    h2.callsFor('z')[0]!.resolve({ value: 1 });
    await p;
    expect(h2.cache.peek('z').data).toEqual({ value: 1 });
    void h2.cache.fetch('z');
    expect(h2.fetcher).toHaveBeenCalledTimes(2);
  });

  it('subscribe: уведомление на каждую замену снимка, отписка и счётчик подписчиков', async () => {
    const h = makeHarness();
    const l1 = vi.fn();
    const l2 = vi.fn();
    const off1 = h.cache.subscribe('k', l1);
    h.cache.subscribe('k', l2);
    expect(h.cache.subscriberCount('k')).toBe(2);
    const p = h.cache.fetch('k');
    expect(l1).toHaveBeenCalledTimes(1); // idle → loading
    off1();
    expect(h.cache.subscriberCount('k')).toBe(1);
    h.callsFor('k')[0]!.resolve({ value: 1 });
    await p;
    expect(l1).toHaveBeenCalledTimes(1);
    expect(l2).toHaveBeenCalledTimes(2); // loading → success
    expect(h.cache.subscriberCount('другой')).toBe(0);
  });
});

describe('дашборд', () => {
  it('на уникальный ключ один запрос; приход данных не трогает виджеты других ключей; бюджет коммитов', async () => {
    const h = makeHarness();
    const c = counter();
    render(<Dashboard cache={h.cache} widgets={specs()} onWidgetRender={c.onWidgetRender} />);
    await settle();
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(h.calls.map((x) => x.key).sort()).toEqual(['sales', 'users']);
    expect(screen.getAllByRole('status')).toHaveLength(3);
    const before = c.snapshot();
    await act(async () => {
      h.callsFor('sales')[0]!.resolve({ value: 120 });
      await flush();
    });
    expect(valueOf('Выручка')).toBe('120');
    expect(valueOf('Заказы')).toBe('120');
    expect(isLoading('Пользователи')).toBe(true);
    expect(c.counts.users).toBe(before.users);
    await act(async () => {
      h.callsFor('users')[0]!.resolve({ value: 7 });
      await flush();
    });
    expect(valueOf('Пользователи')).toBe('7');
    for (const id of ['revenue', 'orders', 'users']) expect(c.counts[id]).toBeLessThanOrEqual(3);
  });

  it('«Компактный вид» и перерисовка с новым массивом widgets не коммитят виджеты', async () => {
    const h = makeHarness();
    const c = counter();
    const { rerender } = render(<Dashboard cache={h.cache} widgets={specs()} onWidgetRender={c.onWidgetRender} />);
    await settle();
    await act(async () => {
      h.callsFor('sales')[0]!.resolve({ value: 1 });
      h.callsFor('users')[0]!.resolve({ value: 2 });
      await flush();
    });
    const before = c.snapshot();
    const root = document.querySelector('[data-compact]')!;
    expect(root.getAttribute('data-compact')).toBe('false');
    const toggle = screen.getByRole('button', { name: 'Компактный вид' });
    fireEvent.click(toggle);
    expect(root.getAttribute('data-compact')).toBe('true');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(root.getAttribute('data-compact')).toBe('false');
    rerender(<Dashboard cache={h.cache} widgets={specs()} onWidgetRender={c.onWidgetRender} />);
    await settle();
    expect(c.snapshot()).toEqual(before);
  });

  it('«Обновить всё»: один запрос на ключ; те же данные — без коммитов, изменённый ключ — по одному коммиту', async () => {
    const h = makeHarness();
    const c = counter();
    render(<Dashboard cache={h.cache} widgets={specs()} onWidgetRender={c.onWidgetRender} />);
    await settle();
    await act(async () => {
      h.callsFor('sales')[0]!.resolve({ value: 10 });
      h.callsFor('users')[0]!.resolve({ value: 20 });
      await flush();
    });
    const before = c.snapshot();
    fireEvent.click(screen.getByRole('button', { name: 'Обновить всё' }));
    expect(h.callsFor('sales')).toHaveLength(2);
    expect(h.callsFor('users')).toHaveLength(2);
    expect(h.fetcher).toHaveBeenCalledTimes(4);
    expect(isLoading('Выручка')).toBe(false);
    await act(async () => {
      h.callsFor('sales')[1]!.resolve({ value: 10 });
      h.callsFor('users')[1]!.resolve({ value: 21 });
      await flush();
    });
    expect(c.counts.revenue).toBe(before.revenue);
    expect(c.counts.orders).toBe(before.orders);
    expect(c.counts.users).toBe(before.users! + 1);
    expect(valueOf('Пользователи')).toBe('21');
  });

  it('повторное монтирование: свежие данные без запроса и без «Загрузки», устаревшие — с показом старого значения', async () => {
    const h = makeHarness(1000);
    const first = render(<Dashboard cache={h.cache} widgets={specs()} />);
    await settle();
    await act(async () => {
      h.callsFor('sales')[0]!.resolve({ value: 1 });
      h.callsFor('users')[0]!.resolve({ value: 2 });
      await flush();
    });
    first.unmount();
    h.tick(500);
    render(<Dashboard cache={h.cache} widgets={specs()} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(valueOf('Выручка')).toBe('1');
    await settle();
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    cleanup();
    h.tick(500);
    render(<Dashboard cache={h.cache} widgets={specs()} />);
    await settle();
    expect(h.fetcher).toHaveBeenCalledTimes(4);
    expect(screen.queryByRole('status')).toBeNull();
    expect(valueOf('Выручка')).toBe('1');
    await act(async () => {
      h.callsFor('sales')[1]!.resolve({ value: 9 });
      await flush();
    });
    expect(valueOf('Выручка')).toBe('9');
    expect(valueOf('Заказы')).toBe('9');
  });

  it('ошибка одного виджета локальна; «Повторить» запрашивает заново и не кэширует ошибку', async () => {
    const h = makeHarness();
    render(<Dashboard cache={h.cache} widgets={specs()} />);
    await settle();
    await act(async () => {
      h.callsFor('users')[0]!.reject(new Error('500'));
      h.callsFor('sales')[0]!.resolve({ value: 4 });
      await flush();
    });
    const alert = within(widget('Пользователи')).getByRole('alert');
    expect(alert.textContent).toContain('Не удалось загрузить: Пользователи');
    expect(within(widget('Выручка')).queryByRole('alert')).toBeNull();
    expect(valueOf('Выручка')).toBe('4');
    fireEvent.click(within(widget('Пользователи')).getByRole('button', { name: 'Повторить' }));
    expect(h.callsFor('users')).toHaveLength(2);
    expect(isLoading('Пользователи')).toBe(true);
    await act(async () => {
      h.callsFor('users')[1]!.resolve({ value: 8 });
      await flush();
    });
    expect(valueOf('Пользователи')).toBe('8');
    expect(within(widget('Пользователи')).queryByRole('alert')).toBeNull();
  });

  it('«Обновить всё» во время первой загрузки: показывается ответ нового запроса, даже если старый пришёл позже', async () => {
    const h = makeHarness();
    render(<Dashboard cache={h.cache} widgets={specs()} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Обновить всё' }));
    expect(h.callsFor('sales')).toHaveLength(2);
    await act(async () => {
      h.callsFor('sales')[1]!.resolve({ value: 'new' });
      await flush();
    });
    expect(valueOf('Выручка')).toBe('new');
    await act(async () => {
      h.callsFor('sales')[0]!.resolve({ value: 'old' });
      await flush();
    });
    expect(valueOf('Выручка')).toBe('new');
    expect(valueOf('Заказы')).toBe('new');
  });

  it('размонтирование снимает подписки; ответ после него ничего не пишет в консоль', async () => {
    const h = makeHarness();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = render(<Dashboard cache={h.cache} widgets={specs()} />);
    await settle();
    expect(h.cache.subscriberCount('sales')).toBe(2);
    expect(h.cache.subscriberCount('users')).toBe(1);
    view.unmount();
    expect(h.cache.subscriberCount('sales')).toBe(0);
    expect(h.cache.subscriberCount('users')).toBe(0);
    await act(async () => {
      h.callsFor('sales')[0]!.resolve({ value: 1 });
      h.callsFor('users')[0]!.reject(new Error('x'));
      await flush();
    });
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('DESIGN.md', () => {
  it('разделы «Решения», «Компромиссы», «Границы применимости» не короче 200 символов', () => {
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
