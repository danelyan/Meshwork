import { act, cleanup, render, screen } from '@testing-library/react';

import { ASIDE_DEBOUNCE_MS, AsideProvider, useAsideRefresh } from '@/components/consultant/aside-refresh';
import { SceneAside } from '@/components/consultant/SceneAside';
import { candidateSteps, type SceneAsideData } from '@/server/consultant/aside';

// MemoryCard переходит к шагу знакомства мягким обновлением (useRouter) — в тестах роутера нет.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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
  it('takes the new server data after a soft page refresh (e.g. «Скрыть» leaves onboarding)', () => {
    const first = mk('2 из 10');
    const { rerender } = render(
      <AsideProvider initial={first}>
        <SceneAside data={first} />
      </AsideProvider>,
    );
    const next = mk('готово');
    rerender(
      <AsideProvider initial={next}>
        <SceneAside data={next} />
      </AsideProvider>,
    );
    expect(screen.getByTestId('journey-intro').textContent).toContain('готово');
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

describe('promoteNow: путь и блок шага показывают одно', () => {
  it('принятое приглашение: «сейчас» у живой защиты, созвон остаётся «дальше»', async () => {
    const { candidateSteps, promoteNow } = await import('@/server/consultant/aside');
    const base = candidateSteps({ intro: true, introNote: '', confirmed: 3, category: { specialization: 'backend', grade: 'junior' } as never, invitations: 1, hired: null, call: false, project: false, aiDefense: false, accepted: 1 });
    expect(base.find((s) => s.id === 'call')?.state).toBe('now');
    const steps = promoteNow(base, 'live_defense');
    expect(steps.find((s) => s.id === 'live_defense')?.state).toBe('now');
    expect(steps.find((s) => s.id === 'call')?.state).toBe('next');
    expect(steps.filter((s) => s.state === 'now')).toHaveLength(1);
  });
  it('обычный шаг - без изменений', async () => {
    const { candidateSteps, promoteNow } = await import('@/server/consultant/aside');
    const base = candidateSteps({ intro: true, introNote: '', confirmed: 0, category: null, invitations: 0, hired: null, call: false, project: false, aiDefense: false, accepted: 0 });
    expect(promoteNow(base, 'test')).toEqual(base);
  });
});
