import { act, renderHook } from '@testing-library/react';

import type { CandidateSubmissionView } from '@/server/project/service';

const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/project-api', () => ({ getSubmissionApi: m.get }));

import { POLL_MAX_MS, POLL_MS, useSubmissionPolling } from '@/components/project/useSubmissionPolling';

const sub = (status: CandidateSubmissionView['status']): CandidateSubmissionView => ({
  id: 's1',
  taskId: 't1',
  status,
  kind: 'code',
  approachText: null,
  repoUrl: 'https://github.com/a/b',
  commitSha: null,
  submittedAt: '2026-10-10T00:00:00.000Z',
  checkedAt: null,
  error: null,
  result: null,
});

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useSubmissionPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    m.get.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('после ошибок сети продолжает опрос с бэкоффом и доходит до результата', async () => {
    m.get.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(sub('checked'));
    const { result } = renderHook(() => useSubmissionPolling([sub('running')]));
    await tick(POLL_MS);
    expect(m.get).toHaveBeenCalledTimes(1);
    // Вторая попытка — через 2×POLL_MS, не раньше.
    await tick(POLL_MS * 2 - 1);
    expect(m.get).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(m.get).toHaveBeenCalledTimes(2);
    await tick(POLL_MS * 4);
    expect(m.get).toHaveBeenCalledTimes(3);
    expect(result.current[0][0]!.status).toBe('checked');
    // Проверено — опрос остановлен.
    await tick(POLL_MAX_MS * 2);
    expect(m.get).toHaveBeenCalledTimes(3);
  });

  it('задержка не растёт выше POLL_MAX_MS', async () => {
    m.get.mockRejectedValue(new Error('offline'));
    renderHook(() => useSubmissionPolling([sub('submitted')]));
    for (const ms of [POLL_MS, POLL_MS * 2, POLL_MS * 4, POLL_MS * 8]) await tick(ms); // 3+6+12+24 с
    expect(m.get).toHaveBeenCalledTimes(4);
    await tick(POLL_MAX_MS - 1);
    expect(m.get).toHaveBeenCalledTimes(4);
    await tick(1);
    expect(m.get).toHaveBeenCalledTimes(5);
  });
});
