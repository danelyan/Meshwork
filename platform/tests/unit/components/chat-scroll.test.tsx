import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';

import { useStickToBottom } from '@/components/chat/scroll';

let resize: () => void;
const observe = vi.fn();
const disconnect = vi.fn();

beforeEach(() => {
  observe.mockClear();
  disconnect.mockClear();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe = observe;
    disconnect = disconnect;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function containerChat() {
  const content = document.createElement('div');
  const pane = document.createElement('div');
  const metrics = { height: 1000, top: 600 };
  Object.defineProperty(content, 'scrollHeight', { get: () => metrics.height });
  Object.defineProperties(pane, {
    scrollHeight: { get: () => metrics.height },
    scrollTop: { get: () => metrics.top },
    clientHeight: { value: 400 },
  });
  const scrollTo = vi.fn();
  pane.scrollTo = scrollTo;
  const ref = { current: content };
  const scrollRef = { current: pane };
  const hook = renderHook(() => useStickToBottom(ref, true, scrollRef));
  const grow = () => {
    metrics.height += 100;
    act(() => resize());
  };
  return { content, pane, metrics, scrollTo, grow, ...hook };
}

describe('useStickToBottom', () => {
  it('follows growing content in its pane without scrolling the document', () => {
    const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const { content, pane, grow, scrollTo, unmount } = containerChat();
    expect(observe).toHaveBeenCalledWith(content);
    grow();
    expect(scrollTo).toHaveBeenCalledWith({ top: 1100, behavior: 'smooth' });
    expect(windowScroll).not.toHaveBeenCalled();
    const removeListener = vi.spyOn(pane, 'removeEventListener');
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  it('preserves a reader position until they return near the pane bottom', () => {
    const { pane, metrics, grow, scrollTo } = containerChat();
    metrics.top = 100;
    fireEvent.scroll(pane);
    grow();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(metrics.top).toBe(100);
    metrics.top = 650;
    fireEvent.scroll(pane);
    grow();
    expect(scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: 'smooth' });
  });

  it('retains document scrolling when no pane is supplied', () => {
    const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const content = document.createElement('div');
    let height = 100;
    Object.defineProperty(content, 'scrollHeight', { get: () => height });
    renderHook(() => useStickToBottom({ current: content }));
    height = 200;
    act(() => resize());
    expect(windowScroll).toHaveBeenCalledWith({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  });
});
