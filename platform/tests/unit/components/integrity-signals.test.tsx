import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';

import { useIntegritySignals } from '@/components/useIntegritySignals';

const beacon = vi.fn((_url: string, _body: string) => true);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-11T10:00:00Z'));
  beacon.mockClear();
  Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true, writable: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

const sent = () => beacon.mock.calls.map((c) => JSON.parse(c[1]) as Record<string, number | boolean>);
const setVisibility = (v: 'hidden' | 'visible') => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('useIntegritySignals', () => {
  it('считает уходы со вкладки и время скрытия, шлёт при hidden', () => {
    renderHook(() => useIntegritySignals('att1', 0));
    act(() => setVisibility('hidden'));
    expect(beacon.mock.calls[0]![0]).toBe('/api/test/attempt/att1/signal');
    expect(sent()[0]).toMatchObject({ tabHidden: 1, hiddenMs: 0 });
    act(() => {
      vi.advanceTimersByTime(3000);
      setVisibility('visible');
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(sent().at(-1)).toMatchObject({ tabHidden: 0, hiddenMs: 3000 });
  });

  it('копит вставки и копирования и шлёт дельты раз в 10 с; пустые дельты не шлёт', () => {
    const { result } = renderHook(() => useIntegritySignals('att1', 0));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    // Первая отправка может нести только extendedScreen (jsdom свойства isExtended не даёт) — тогда её нет вовсе.
    expect(beacon).not.toHaveBeenCalled();
    const prevent = vi.fn();
    act(() => {
      result.current.onPaste({ clipboardData: { getData: () => 'abcde' }, preventDefault: prevent } as never);
      result.current.onPaste({ clipboardData: { getData: () => 'xy' }, preventDefault: prevent } as never);
      result.current.onCopy();
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(sent()).toEqual([{ tabHidden: 0, hiddenMs: 0, pastes: 2, pasteChars: 7, copies: 1 }]);
    expect(prevent).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it('смена задания и размонтирование отправляют накопленное; слушатели снимаются', () => {
    const { result, rerender, unmount } = renderHook(({ i }) => useIntegritySignals('att1', i), { initialProps: { i: 0 } });
    act(() => result.current.onCopy());
    rerender({ i: 1 });
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ copies: 1 });
    act(() => result.current.onCopy());
    unmount();
    expect(sent()).toHaveLength(2);
    act(() => setVisibility('hidden'));
    expect(beacon).toHaveBeenCalledTimes(2);
  });

  it('extendedScreen уходит один раз, только если свойство есть', () => {
    vi.stubGlobal('screen', { isExtended: true });
    const { result } = renderHook(() => useIntegritySignals('att1', 0));
    act(() => result.current.onCopy());
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(sent()[0]).toMatchObject({ extendedScreen: true, copies: 1 });
    act(() => result.current.onCopy());
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(sent()[1]).not.toHaveProperty('extendedScreen');
  });

  it('без sendBeacon падает на fetch keepalive, ошибки глотаются', () => {
    Object.defineProperty(navigator, 'sendBeacon', { value: undefined, configurable: true, writable: true });
    const f = vi.fn(async () => {
      throw new Error('409');
    });
    vi.stubGlobal('fetch', f);
    const { result } = renderHook(() => useIntegritySignals('att1', 0));
    act(() => result.current.onCopy());
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(f).toHaveBeenCalledTimes(1);
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.keepalive).toBe(true);
  });

  it('onPaste/onCopy вешаются на элементы без preventDefault', () => {
    function C() {
      const s = useIntegritySignals('att1', 0);
      return (
        <div onCopy={s.onCopy}>
          <input data-testid="f" onPaste={s.onPaste} />
        </div>
      );
    }
    const { getByTestId } = render(<C />);
    fireEvent.paste(getByTestId('f'), { clipboardData: { getData: () => '12345' } });
    fireEvent.copy(getByTestId('f'));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(sent()[0]).toMatchObject({ pastes: 1, pasteChars: 5, copies: 1 });
  });
});
