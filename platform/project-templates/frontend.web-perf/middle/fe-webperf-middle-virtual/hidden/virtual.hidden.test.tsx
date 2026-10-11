// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VirtualList } from '../src/VirtualList';
import { computeWindow } from '../src/windowing';

afterEach(cleanup);

const base = { count: 100, rowHeight: 20, viewportHeight: 100, scrollTop: 0, overscan: 0 };
const list = () => screen.getByRole('list', { name: 'Список' });
const rows = () => screen.queryAllByRole('listitem');
const indices = () => rows().map((r) => Number(r.getAttribute('aria-posinset')) - 1);
const scrollTo = (y: number) => fireEvent.scroll(list(), { target: { scrollTop: y } });
const row = (i: number) => rows().find((r) => r.getAttribute('aria-posinset') === String(i + 1))!;
const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);

function setup(extra: Partial<Parameters<typeof VirtualList>[0]> = {}) {
  const renderRow = vi.fn((i: number) => <span>Строка {i}</span>);
  const onRangeChange = vi.fn();
  const props = { count: 10000, rowHeight: 20, height: 100, overscan: 2, renderRow, onRangeChange, ...extra };
  const view = render(<VirtualList {...props} />);
  return { renderRow, onRangeChange, props, view };
}

describe('computeWindow', () => {
  it('границы окна без overscan и с ним', () => {
    expect(computeWindow(base)).toEqual({ start: 0, end: 5, totalHeight: 2000 });
    expect(computeWindow({ ...base, scrollTop: 400 })).toEqual({ start: 20, end: 25, totalHeight: 2000 });
    expect(computeWindow({ ...base, scrollTop: 400, overscan: 3 })).toEqual({ start: 17, end: 28, totalHeight: 2000 });
    expect(computeWindow({ ...base, overscan: 3 })).toEqual({ start: 0, end: 8, totalHeight: 2000 });
  });

  it('частично видимые строки входят в окно', () => {
    expect(computeWindow({ ...base, scrollTop: 15 })).toMatchObject({ start: 0, end: 6 });
    expect(computeWindow({ ...base, scrollTop: 25 })).toMatchObject({ start: 1, end: 7 });
    expect(computeWindow({ ...base, scrollTop: 20, viewportHeight: 90 })).toMatchObject({ start: 1, end: 6 });
  });

  it('scrollTop приводится к допустимому диапазону, end не выходит за count', () => {
    expect(computeWindow({ ...base, scrollTop: 99999, overscan: 2 })).toEqual({ start: 93, end: 100, totalHeight: 2000 });
    expect(computeWindow({ ...base, scrollTop: -50 })).toEqual({ start: 0, end: 5, totalHeight: 2000 });
    expect(computeWindow({ ...base, count: 3, viewportHeight: 100, scrollTop: 40, overscan: 2 })).toEqual({
      start: 0,
      end: 3,
      totalHeight: 60,
    });
  });

  it('пустой список и неверные аргументы', () => {
    expect(computeWindow({ ...base, count: 0 })).toEqual({ start: 0, end: 0, totalHeight: 0 });
    expect(computeWindow(base).end).toBe(5);
    expect(() => computeWindow({ ...base, rowHeight: 0 })).toThrow(RangeError);
    expect(() => computeWindow({ ...base, viewportHeight: -1 })).toThrow(RangeError);
    expect(() => computeWindow({ ...base, overscan: -1 })).toThrow(RangeError);
    expect(() => computeWindow({ ...base, count: 2.5 })).toThrow(RangeError);
    expect(() => computeWindow({ ...base, count: -1 })).toThrow(RangeError);
  });
});

describe('VirtualList', () => {
  it('10 000 строк: в DOM только окно, renderRow вызван только для него, разметка по контракту', () => {
    const { renderRow } = setup();
    expect(indices()).toEqual(range(0, 7));
    expect(renderRow.mock.calls.map((c) => c[0]).sort((a, b) => a - b)).toEqual(range(0, 7));
    expect(list().style.height).toBe('100px');
    expect(list().style.overflow).toBe('auto');
    const spacer = list().firstElementChild as HTMLElement;
    expect(spacer.style.height).toBe('200000px');
    expect(spacer.children).toHaveLength(7);
    const r3 = row(3);
    expect(r3.getAttribute('aria-setsize')).toBe('10000');
    expect(r3.style.position).toBe('absolute');
    expect(r3.style.top).toBe('60px');
    expect(r3.style.height).toBe('20px');
    expect(r3.textContent).toBe('Строка 3');
  });

  it('окно следует за прокруткой, число узлов ограничено на любой позиции', () => {
    setup();
    expect(rows().length).toBeGreaterThan(0);
    scrollTo(4000);
    expect(indices()).toEqual(range(198, 207));
    expect(row(200).style.top).toBe('4000px');
    scrollTo(123456789);
    expect(indices()).toEqual(range(9993, 10000));
    scrollTo(0);
    expect(indices()).toEqual(range(0, 7));
    for (const y of [10, 777, 50000, 150000]) {
      scrollTo(y);
      expect(rows().length).toBeGreaterThan(0);
      expect(rows().length).toBeLessThanOrEqual(10);
    }
  });

  it('прокрутка внутри того же окна ничего не перерисовывает и не вызывает onRangeChange', () => {
    const { renderRow, onRangeChange } = setup();
    expect(rows()).toHaveLength(7);
    scrollTo(10); // видимые строки 0..5, окно [0, 8)
    expect(indices()).toEqual(range(0, 8));
    renderRow.mockClear();
    onRangeChange.mockClear();
    scrollTo(11);
    scrollTo(15);
    scrollTo(20);
    expect(renderRow).not.toHaveBeenCalled();
    expect(onRangeChange).not.toHaveBeenCalled();
    expect(indices()).toEqual(range(0, 8));
  });

  it('при сдвиге окна renderRow вызывается только для вошедших индексов', () => {
    const { renderRow } = setup();
    expect(rows()).toHaveLength(7);
    renderRow.mockClear();
    scrollTo(60); // первая видимая строка 3: окно [1, 10)
    expect(indices()).toEqual(range(1, 10));
    expect(renderRow.mock.calls.map((c) => c[0]).sort((a, b) => a - b)).toEqual([7, 8, 9]);
  });

  it('строка, оставшаяся в окне, сохраняет DOM-узел и локальное состояние; вернувшаяся – создаётся заново', () => {
    setup({ renderRow: (i: number) => <input type="checkbox" aria-label={`отметка ${i}`} /> });
    const before = row(4);
    fireEvent.click(screen.getByLabelText('отметка 4'));
    expect((screen.getByLabelText('отметка 4') as HTMLInputElement).checked).toBe(true);
    scrollTo(40);
    expect(row(4)).toBe(before);
    expect((screen.getByLabelText('отметка 4') as HTMLInputElement).checked).toBe(true);
    scrollTo(2000);
    expect(screen.queryByLabelText('отметка 4')).toBeNull();
    scrollTo(0);
    expect((screen.getByLabelText('отметка 4') as HTMLInputElement).checked).toBe(false);
  });

  it('новая функция renderRow обновляет содержимое строк окна', () => {
    const { view, props } = setup();
    expect(row(2).textContent).toBe('Строка 2');
    view.rerender(<VirtualList {...props} renderRow={(i) => <b>Новая {i}</b>} />);
    expect(row(2).textContent).toBe('Новая 2');
    expect(rows()).toHaveLength(7);
  });

  it('изменение count: рост, сокращение за пределы прокрутки, пустой список', () => {
    const { view, props } = setup({ count: 100 });
    scrollTo(1900); // максимум: 100 * 20 - 100
    expect(indices()).toEqual(range(93, 100));
    view.rerender(<VirtualList {...props} count={10} />);
    expect((list().firstElementChild as HTMLElement).style.height).toBe('200px');
    expect(indices()).toEqual(range(3, 10));
    view.rerender(<VirtualList {...props} count={0} />);
    expect(rows()).toHaveLength(0);
    expect((list().firstElementChild as HTMLElement).style.height).toBe('0px');
    view.rerender(<VirtualList {...props} count={500} />);
    expect(rows().length).toBeGreaterThan(0);
    expect((list().firstElementChild as HTMLElement).style.height).toBe('10000px');
  });

  it('height и overscan пересчитывают окно', () => {
    const { view, props } = setup({ overscan: 0 });
    expect(indices()).toEqual(range(0, 5));
    view.rerender(<VirtualList {...props} overscan={0} height={200} />);
    expect(list().style.height).toBe('200px');
    expect(indices()).toEqual(range(0, 10));
    view.rerender(<VirtualList {...props} overscan={4} height={200} />);
    expect(indices()).toEqual(range(0, 14));
  });

  it('overscan по умолчанию 3, кастомный label', () => {
    const renderRow = (i: number) => <i>{i}</i>;
    render(<VirtualList count={1000} rowHeight={20} height={100} renderRow={renderRow} label="Лента" />);
    expect(screen.getByRole('list', { name: 'Лента' })).toBeTruthy();
    expect(indices()).toEqual(range(0, 8));
  });

  it('scrollToIndex: при монтировании, при смене, без возврата при повторе, с приведением к границам', () => {
    const { view, props } = setup({ scrollToIndex: 50, overscan: 0 });
    expect(list().scrollTop).toBe(1000);
    expect(indices()).toEqual(range(50, 55));
    scrollTo(0);
    expect(indices()).toEqual(range(0, 5));
    view.rerender(<VirtualList {...props} overscan={0} scrollToIndex={50} />);
    expect(indices()).toEqual(range(0, 5));
    view.rerender(<VirtualList {...props} overscan={0} scrollToIndex={70} />);
    expect(list().scrollTop).toBe(1400);
    expect(indices()).toEqual(range(70, 75));
    view.rerender(<VirtualList {...props} overscan={0} scrollToIndex={99999} />);
    expect(list().scrollTop).toBe(199900);
    expect(indices()).toEqual(range(9995, 10000));
    view.rerender(<VirtualList {...props} overscan={0} scrollToIndex={-5} />);
    expect(list().scrollTop).toBe(0);
    expect(indices()).toEqual(range(0, 5));
  });

  it('onRangeChange: после монтирования и только при смене границ отрисованного окна', async () => {
    const { onRangeChange } = setup();
    await act(async () => {});
    expect(onRangeChange.mock.calls).toEqual([[0, 7]]);
    scrollTo(10);
    expect(onRangeChange.mock.calls).toEqual([
      [0, 7],
      [0, 8],
    ]);
    scrollTo(20);
    scrollTo(30);
    scrollTo(35);
    scrollTo(1000);
    expect(onRangeChange.mock.calls).toEqual([
      [0, 7],
      [0, 8],
      [0, 9],
      [48, 57],
    ]);
  });
});
