// История созвонов в кабинетах: кандидат видит только последний завершённый созвон каждого вида (не историю),
// запись - плеером только у карты глубины; работодателю в UI запись и транскрипт не показываются вовсе.
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import { DepthMapSection } from '@/components/call/DepthMapSection';
import { DepthMapBlock } from '@/components/employer/StageBlocks';
import type { CallVerdict, CallView, DepthMapItem } from '@/server/call/types';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const item = (topic: string): DepthMapItem => ({
  topic,
  catalogId: null,
  claimed: true,
  claimStatement: null,
  probed: 2,
  maxLevel: 2,
  confirmed: true,
  status: 'confirmed',
  scores: { depth: 2, why: 2, boundary: 2, completion: 2 },
  total: 8,
  quote: '',
  runs: [],
});

const verdict = (topic: string): CallVerdict => ({
  kind: 'qualifying',
  depthMap: [item(topic)],
  runs: 3,
  validRuns: 3,
  upgradedCatalogIds: [],
  summary: 's',
  evaluatedAt: '2026-10-10T12:00:00Z',
  thresholdVersion: 'v',
  disclaimer: 'd',
});

const call = (id: string, kind: 'qualifying' | 'interview', topic: string, finishedAt: string, hasRecording: boolean): CallView =>
  ({
    id,
    kind,
    status: 'finished',
    projectSubmissionId: null,
    startedAt: '2026-10-01T10:00:00Z',
    finishedAt,
    access: 'full',
    transcript: [
      { index: 0, role: 'ai', text: `Вопрос ${id}`, at: finishedAt, tMs: 0 },
      { index: 1, role: 'candidate', text: `Ответ ${id}`, at: finishedAt, tMs: 1000 },
    ],
    verdict: verdict(topic),
    hasRecording,
    videoSegments: [],
    progress: { answered: 1, minQuestions: 4, maxQuestions: 6, canFinish: true, awaitingAnswer: false },
    participants: [],
    policyVersion: 'v',
    disclaimer: 'd',
  }) as CallView;

function stubCalls(calls: CallView[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ consent: { given: true, version: 'v', text: [] }, calls }), { status: 200, headers: { 'content-type': 'application/json' } })),
  );
}

describe('кандидат: история созвонов', () => {
  it('профиль (карта глубины): из двух завершённых созвонов виден только свежий, с плеером записи', async () => {
    stubCalls([call('new', 'qualifying', 'Свежая тема', '2026-10-10T12:00:00Z', true), call('old', 'qualifying', 'Старая тема', '2026-10-05T12:00:00Z', true)]);
    const { container } = render(<DepthMapSection />);
    await screen.findByTestId('depth-map-section');
    expect(screen.getByText('Свежая тема')).toBeTruthy();
    expect(screen.queryByText('Старая тема')).toBeNull();
    expect(container.querySelectorAll('audio')).toHaveLength(1);
    expect(container.querySelector('audio')?.getAttribute('src')).toBe('/api/call/new/recording');
    // транскрипта в профиле нет
    expect(screen.queryByText(/Ответ new/)).toBeNull();
  });

  it('профиль: без записи плеера нет', async () => {
    stubCalls([call('new', 'qualifying', 'Тема', '2026-10-10T12:00:00Z', false)]);
    const { container } = render(<DepthMapSection />);
    await screen.findByText('Тема');
    expect(container.querySelector('audio')).toBeNull();
  });

  it('/interview: из двух завершённых интервью показан транскрипт только последнего, плеера записи нет', async () => {
    stubCalls([call('i-new', 'interview', 'T', '2026-10-10T12:00:00Z', true), call('i-old', 'interview', 'T', '2026-10-05T12:00:00Z', true)]);
    HTMLElement.prototype.scrollTo = () => {};
    const { InterviewPage } = await import('@/components/interview/InterviewPage');
    const { container } = render(<InterviewPage />);
    await waitFor(() => expect(screen.getByText('Ответ i-new')).toBeTruthy());
    expect(screen.queryByText('Ответ i-old')).toBeNull();
    expect(container.querySelector('audio')).toBeNull();
    expect(container.querySelector('a[href*="/recording"]')).toBeNull();
  });
});

describe('работодатель: карточка кандидата', () => {
  it('блок созвона: темы и статус, без записи, транскрипта и цитат', () => {
    const { container } = render(
      <DepthMapBlock
        depth={{
          confirmed: 1,
          matchedNeed: 1,
          topics: [{ topic: 'Идемпотентность', catalogId: 'be.idempotency', claimed: true, probed: 3, confirmed: true, total: 7, forNeed: true }],
        }}
      />,
    );
    expect(screen.getByText(/Подтверждено 1 из 1 тем/)).toBeTruthy();
    expect(screen.getByText('Идемпотентность')).toBeTruthy();
    expect(container.querySelector('audio, video, a[href*="/api/call"]')).toBeNull();
    expect(screen.queryByText(/транскрипт|запись/i)).toBeNull();
  });
});
