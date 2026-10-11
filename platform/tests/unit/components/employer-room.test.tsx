import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { EmployerRoom } from '@/components/call/EmployerRoom';
import type { CallSnapshot } from '@/server/defense-room/types';

// ADR 0008 п. 3: работодатель видит, что защита записывается (и его голос), и без подтверждения не подключается.
const rtc = { states: {}, anyConnected: false, micError: null, micOn: false, micStream: null, enableMic: vi.fn(), onSignal: vi.fn(), connect: vi.fn(), close: vi.fn(), closeAll: vi.fn() };
vi.mock('@/components/call/useRtcAudio', () => ({ useRtcAudio: () => rtc, rtcLabel: () => 'аудио' }));
vi.mock('@/components/call/useCallEvents', () => ({ useCallEvents: (_id: string, initial: CallSnapshot) => ({ snapshot: initial, connected: true }) }));
vi.mock('@/components/chat/VoiceButton', () => ({ VoiceButton: () => null }));

const snap = (over: Partial<CallSnapshot> = {}): CallSnapshot => ({
  sessionId: 's1',
  kind: 'defense',
  status: 'active',
  mode: 'project',
  transcript: [],
  participants: [],
  aiMuted: false,
  progress: { asked: 0, total: 3 },
  verdict: null,
  ...over,
});

const bodies: unknown[] = [];
beforeEach(() => {
  bodies.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      bodies.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes('/join')) return Response.json({ participantId: 'p', webrtc: { iceServers: [] }, snapshot: snap() });
      if (url.includes('/employer-audio')) return Response.json({ segments: [{ name: '000-0.webm', startMs: 0 }] });
      return Response.json({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EmployerRoom: подтверждение записи', () => {
  it('предупреждает о записи; «Подключиться» недоступна без галочки и шлёт recordingConsent', async () => {
    render(<EmployerRoom sessionId="s1" initial={snap()} candidateId="c1" selfUserId="u1" />);
    expect(screen.getByText(/записывается целиком: голос кандидата и ваш голос/)).toBeTruthy();
    const join = screen.getByTestId('room-join') as HTMLButtonElement;
    expect(join.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('room-recording-consent'));
    expect(join.disabled).toBe(false);
    fireEvent.click(join);
    await waitFor(() => expect(bodies).toContainEqual({ url: '/api/employer/call/s1/join', body: { recordingConsent: true } }));
    expect(rtc.connect).toHaveBeenCalledWith('candidate');
  });

  it('после защиты показывает дорожку работодателя', async () => {
    render(<EmployerRoom sessionId="s1" initial={snap({ status: 'finished' })} candidateId="c1" selfUserId="u1" />);
    await waitFor(() => expect(screen.getByTestId('employer-audio')).toBeTruthy());
    expect(screen.getByTestId('employer-audio').querySelector('audio')?.getAttribute('src')).toBe('/api/call/s1/employer-audio/file?segment=000-0.webm');
  });
});
