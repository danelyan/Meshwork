import { render, screen, within } from '@testing-library/react';

import { DepthMap } from '@/components/call/DepthMap';
import { VerdictView } from '@/components/call/Transcript';
import type { CallVerdict, DepthMapItem } from '@/server/call/types';
import type { DefenseRoomVerdict } from '@/server/defense-room/types';

const item = (topic: string, extra: Partial<DepthMapItem>): DepthMapItem => ({
  topic,
  catalogId: null,
  claimed: true,
  claimStatement: null,
  probed: 2,
  maxLevel: 2,
  confirmed: false,
  status: 'not_confirmed',
  scores: { depth: 1, why: 1, boundary: 1, completion: 1 },
  total: 4,
  quote: '',
  runs: [],
  ...extra,
});

describe('карта глубины: статусы тем', () => {
  it('подтверждено / не определено / не проверено; старый вердикт без status — по confirmed', () => {
    const verdict: CallVerdict = {
      kind: 'qualifying',
      depthMap: [
        item('Индексы', { status: 'confirmed', confirmed: true, total: 6 }),
        item('Идемпотентность', { status: 'inconclusive', extraProbe: true }),
        item('Кэш', { status: 'not_probed', probed: 0, total: 0 }),
        { ...item('Транзакции', { confirmed: true }), status: undefined } as unknown as DepthMapItem,
      ],
      runs: 3,
      validRuns: 3,
      upgradedCatalogIds: [],
      summary: 'Подтверждено тем: 2 из 3 проверенных.',
      evaluatedAt: '2026-10-10T12:00:00Z',
      thresholdVersion: 'v',
      disclaimer: 'd',
    };
    render(<DepthMap verdict={verdict} />);
    const rows = screen.getAllByRole('listitem').filter((li) => li.hasAttribute('data-status'));
    expect(rows.map((r) => r.getAttribute('data-status'))).toEqual(['confirmed', 'inconclusive', 'not_probed', 'confirmed']);
    expect(within(rows[1]!).getByText('не определено')).toBeTruthy();
    expect(within(rows[1]!).getByText(/с дополнительным/)).toBeTruthy();
    expect(within(rows[2]!).getByText('не проверено')).toBeTruthy();
    expect(within(rows[2]!).queryByLabelText('Баллы по рубрике')).toBeNull();
  });
});

describe('итог защиты: баллы по вопросам', () => {
  it('карта «вопрос/файл → балл» и общий балл с десятыми', () => {
    const v: DefenseRoomVerdict = {
      scores: { depth: 1, why: 1, boundary: 1, completion: 1 },
      total: 4,
      totalMean: 4.3,
      items: [
        { itemId: 'q1', source: 'qlc', type: 'why', ref: 'src/signature.js:L1-L9', label: 'почему так · src/signature.js:L1-L9', question: 'Почему HMAC?', scores: { depth: 2, why: 2, boundary: 1, completion: 2 }, total: 7, passed: true, runs: [7, 7, 6], agreement: { same: 3, of: 3 }, answers: 1, quote: '' },
        { itemId: 'q2', source: 'qlc', type: 'what_breaks', ref: 'src/retry-queue.js:L3-L20', label: 'что сломается · src/retry-queue.js:L3-L20', question: 'Что сломается?', scores: { depth: 1, why: 0, boundary: 0, completion: 0 }, total: 1, passed: false, runs: [1, 1, 2], agreement: { same: 3, of: 3 }, answers: 2, quote: '' },
      ],
      passed: false,
      runs: [4.3, 4, 4.5],
      flags: ['strong_project_weak_defense', 'uneven_understanding'],
      summary: 'Защита по рубрике A-02',
      quotes: [],
      projectScore: 0.95,
      answered: 3,
      employerQuestions: { asked: 0, answered: 0 },
      thresholdVersion: 'v',
      evaluatedAt: '2026-10-10T12:00:00Z',
    };
    render(<VerdictView verdict={v} />);
    expect(screen.getByText('4,3 из 8')).toBeTruthy();
    const list = screen.getByTestId('defense-items');
    expect(within(list).getByText('почему так · src/signature.js:L1-L9')).toBeTruthy();
    expect(within(list).getByText('1 из 8')).toBeTruthy();
  });
});
