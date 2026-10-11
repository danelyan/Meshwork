import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { CallEvidence } from '@/components/employer/CallEvidence';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

it('до принятого приглашения: сервер отдаёт access=summary - блок объясняет, когда откроется', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ id: 'c1', access: 'summary', transcript: null, hasRecording: false, videoSegments: [] })));
  render(<CallEvidence callId="c1" />);
  const d = screen.getByTestId('call-evidence') as HTMLDetailsElement;
  d.open = true;
  fireEvent(d, new Event('toggle'));
  expect(await screen.findByTestId('call-evidence-locked')).toBeTruthy();
  expect(screen.queryByLabelText('Запись созвона')).toBeNull();
});

it('после принятого приглашения: транскрипт, плеер записи и ссылки на видео', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      json({
        id: 'c1',
        access: 'full',
        hasRecording: true,
        videoSegments: [{ name: '000-0.webm', startMs: 0 }],
        transcript: [
          { index: 0, role: 'ai', text: 'Расскажи про React', at: '', tMs: 0 },
          { index: 1, role: 'candidate', text: 'Хуки и контекст', at: '', tMs: 1000 },
        ],
      }),
    ),
  );
  render(<CallEvidence callId="c1" />);
  const d = screen.getByTestId('call-evidence') as HTMLDetailsElement;
  d.open = true;
  fireEvent(d, new Event('toggle'));
  expect(await screen.findByTestId('call-evidence-full')).toBeTruthy();
  expect(screen.getByLabelText('Запись созвона').getAttribute('src')).toBe('/api/call/c1/recording');
  expect(screen.getByRole('link', { name: 'часть 1' }).getAttribute('href')).toContain('/api/call/c1/video?segment=000-0.webm');
  expect(screen.getByText('Хуки и контекст')).toBeTruthy();
  expect(screen.getByText('Кандидат:')).toBeTruthy();
});
