// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VirtualList } from '../../src/VirtualList';
import { computeWindow } from '../../src/windowing';

afterEach(cleanup);

const list = () => screen.getByRole('list', { name: 'Список' });
const indices = () => screen.queryAllByRole('listitem').map((r) => Number(r.getAttribute('aria-posinset')) - 1);
const scrollTo = (y: number) => fireEvent.scroll(list(), { target: { scrollTop: y } });
const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);

describe('виртуализация (visible)', () => {
  it('computeWindow: окно с overscan и приведением scrollTop', () => {
    const base = { count: 100, rowHeight: 20, viewportHeight: 100, scrollTop: 0, overscan: 0 };
    expect(computeWindow(base)).toEqual({ start: 0, end: 5, totalHeight: 2000 });
    expect(computeWindow({ ...base, scrollTop: 400, overscan: 3 })).toEqual({ start: 17, end: 28, totalHeight: 2000 });
    expect(computeWindow({ ...base, scrollTop: 99999, overscan: 2 })).toEqual({ start: 93, end: 100, totalHeight: 2000 });
  });

  it('из 10 000 строк в DOM только окно', () => {
    const renderRow = vi.fn((i: number) => <span>Строка {i}</span>);
    render(<VirtualList count={10000} rowHeight={20} height={100} overscan={2} renderRow={renderRow} />);
    expect(indices()).toEqual(range(0, 7));
    expect(renderRow).toHaveBeenCalledTimes(7);
    expect((list().firstElementChild as HTMLElement).style.height).toBe('200000px');
  });

  it('окно следует за прокруткой', () => {
    render(<VirtualList count={10000} rowHeight={20} height={100} overscan={2} renderRow={(i) => <span>{i}</span>} />);
    scrollTo(4000);
    expect(indices()).toEqual(range(198, 207));
    expect(screen.queryAllByRole('listitem').length).toBeLessThanOrEqual(10);
  });

  it('scrollToIndex ставит строку первой видимой', () => {
    render(<VirtualList count={10000} rowHeight={20} height={100} overscan={0} scrollToIndex={50} renderRow={(i) => <span>{i}</span>} />);
    expect(list().scrollTop).toBe(1000);
    expect(indices()).toEqual(range(50, 55));
  });
});
