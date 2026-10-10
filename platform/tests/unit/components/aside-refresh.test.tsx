import { act, cleanup, render, screen } from '@testing-library/react';

import { ASIDE_DEBOUNCE_MS, AsideProvider, useAsideRefresh } from '@/components/consultant/aside-refresh';
import { SceneAside } from '@/components/consultant/SceneAside';
import { candidateSteps, type SceneAsideData } from '@/server/consultant/aside';

vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const mk = (note: string): SceneAsideData => ({
  role: 'candidate',
  steps: candidateSteps({ intro: false, introNote: note, confirmed: 0, category: null, invitations: 0 }),
  docs: [],
  hint: { title: 'h', text: 't' },
});

function Trigger() {
  const refresh = useAsideRefresh();
  return <button onClick={refresh}>go</button>;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const setup = () => {
  const initial = mk('2 из 10');
  return render(
    <AsideProvider initial={initial}>
      <Trigger />
      <SceneAside data={initial} />
    </AsideProvider>,
  );
};
const click = () => act(() => void screen.getByText('go').click());

describe('AsideProvider', () => {
  it('debounces several refreshes into one request and updates the column', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(mk('3 из 10'))));
    vi.stubGlobal('fetch', fetchMock);
    setup();
    expect(screen.getByText('2 из 10')).toBeTruthy();
    click();
    click();
    click();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ASIDE_DEBOUNCE_MS - 10);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('3 из 10')).toBeTruthy();
  });
  it('keeps the column as it was when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    setup();
    click();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ASIDE_DEBOUNCE_MS + 10);
    });
    expect(screen.getByText('2 из 10')).toBeTruthy();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('net'))));
    click();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ASIDE_DEBOUNCE_MS + 10);
    });
    expect(screen.getByText('2 из 10')).toBeTruthy();
  });
  it('does nothing without initial data (scene without a column)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AsideProvider>
        <Trigger />
      </AsideProvider>,
    );
    click();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ASIDE_DEBOUNCE_MS + 10);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
