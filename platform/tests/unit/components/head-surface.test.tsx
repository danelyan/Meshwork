import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { HeadSurface } from '@/components/avatar/HeadSurface';
import type { CompanionVoice } from '@/components/avatar/voice';
import { hasWebGL, resetWebGLCache } from '@/components/avatar/webgl';

const probe = vi.hoisted(() => ({ ok: false }));
vi.mock('@/components/avatar/Head3D', () => ({ default: () => <div data-testid="head3d" /> }));

const voice = { status: 'idle', getLevel: () => 0, getMouth: () => ({}) } as unknown as CompanionVoice;

beforeEach(() => {
  resetWebGLCache();
  probe.ok = false;
  vi.stubGlobal('WebGLRenderingContext', function WebGLRenderingContext() {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => (probe.ok ? { getExtension: () => null } : null)) as never);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('webgl probe', () => {
  it('does not cache a negative result: the next probe can succeed', () => {
    expect(hasWebGL()).toBe(false);
    probe.ok = true;
    expect(hasWebGL()).toBe(true);
    probe.ok = false;
    expect(hasWebGL()).toBe(true); // положительный — кэшируется
  });
});

describe('HeadSurface', () => {
  it('shows the mark with a refresh button when the probe fails, then the head after the retry', async () => {
    render(<HeadSurface voice={voice} reduced={false} style="metal" />);
    expect(await screen.findByTestId('avatar-fallback')).toBeTruthy();
    probe.ok = true;
    fireEvent.click(screen.getByRole('button', { name: 'обновить' }));
    await waitFor(() => expect(screen.getByTestId('head3d')).toBeTruthy());
    expect(screen.queryByTestId('avatar-fallback')).toBeNull();
  });
});
