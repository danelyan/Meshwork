import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ConsultantHead } from '@/components/head/ConsultantHead';
import { ConsultantScene } from '@/components/head/ConsultantScene';
import { createHeadRenderer, type HeadRenderer } from '@/components/head/renderer';

vi.mock('@/components/head/renderer', () => ({ createHeadRenderer: vi.fn() }));

function media(desktop = true, reduced = false) {
  const desktopQuery = { matches: desktop, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const motionQuery = { matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', (query: string) => query.includes('min-width') ? desktopQuery : motionQuery);
  return { desktopQuery, motionQuery };
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('decorative consultant portrait', () => {
  it('keeps loading fallback static without initializing a second model', () => {
    media();
    const { container } = render(<ConsultantScene pending><p>Loading chat</p></ConsultantScene>);
    expect(createHeadRenderer).not.toHaveBeenCalled();
    expect(container.querySelector('canvas')).toBeNull();
  });
  it('does not initialize or fetch the heavy model on narrow screens', () => {
    media(false);
    render(<ConsultantHead />);
    expect(createHeadRenderer).not.toHaveBeenCalled();
  });

  it('keeps the portrait unfocusable and passes the motion preference', async () => {
    media(true, true);
    const dispose = vi.fn();
    vi.mocked(createHeadRenderer).mockResolvedValue({ dispose });
    const { container, unmount } = render(<ConsultantHead />);
    await waitFor(() => expect(container.querySelector('[data-head-state]')?.getAttribute('data-head-state')).toBe('ready'));
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('canvas')?.tabIndex).toBe(-1);
    const args = vi.mocked(createHeadRenderer).mock.calls[0]!;
    expect(args[2]).toBe(true);
    expect(args[4]).toBe(container.querySelector('[data-head-state]'));
    expect(container.querySelector('button')).toBeNull();
    unmount();
    expect(args[1].aborted).toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('provides an accessible pause control without reloading the model', async () => {
    media();
    const setPaused = vi.fn();
    vi.mocked(createHeadRenderer).mockResolvedValue({ dispose: vi.fn(), setPaused });
    const { getByRole } = render(<ConsultantHead />);
    const pause = await waitFor(() => getByRole('button', { name: 'Остановить анимацию' }));
    expect(pause.closest('[aria-hidden="true"]')).toBeNull();
    fireEvent.click(pause);
    expect(setPaused).toHaveBeenLastCalledWith(true);
    fireEvent.click(getByRole('button', { name: 'Включить анимацию' }));
    expect(setPaused).toHaveBeenLastCalledWith(false);
    expect(createHeadRenderer).toHaveBeenCalledOnce();
  });

  it('disposes a late model initialization after unmount', async () => {
    media();
    let resolve!: (renderer: HeadRenderer) => void;
    vi.mocked(createHeadRenderer).mockReturnValue(new Promise(value => { resolve = value; }));
    const { unmount } = render(<ConsultantHead />);
    unmount();
    const dispose = vi.fn();
    await act(async () => { resolve({ dispose }); });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('keeps the static background without a separate portrait when WebGL cannot initialize', async () => {
    media();
    vi.mocked(createHeadRenderer).mockRejectedValue(new Error('WebGL unavailable'));
    const { container } = render(<ConsultantHead />);
    await waitFor(() => expect(container.querySelector('[data-head-state]')?.getAttribute('data-head-state')).toBe('fallback'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('releases the renderer and listeners when resized to mobile', async () => {
    const { desktopQuery, motionQuery } = media();
    const dispose = vi.fn();
    vi.mocked(createHeadRenderer).mockResolvedValue({ dispose });
    const { unmount } = render(<ConsultantHead />);
    await act(async () => {});
    desktopQuery.matches = false;
    act(() => { desktopQuery.addEventListener.mock.calls[0]![1](); });
    expect(dispose).toHaveBeenCalledOnce();
    unmount();
    expect(desktopQuery.removeEventListener).toHaveBeenCalledOnce();
    expect(motionQuery.removeEventListener).toHaveBeenCalledOnce();
  });
});
