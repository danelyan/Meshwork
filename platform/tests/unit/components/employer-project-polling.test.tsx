import { act, cleanup, render, screen } from '@testing-library/react';

import type { EmployerSubmissionView, EmployerTaskView, TemplateView } from '@/server/project/service';

const m = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/lib/project-api', () => ({ listProjectSubmissionsApi: m.list, inviteToDefenseApi: vi.fn(), saveNeedProjectApi: vi.fn() }));

import { EmployerProjectBlock } from '@/components/project/EmployerProjectBlock';
import { POLL_MAX_MS } from '@/components/project/useSubmissionPolling';

const POLL_MS = 4000;

const template = { id: 'tpl', specialization: 'backend', grade: 'middle', title: 'Сервис заказов', summary: 's', subcategoryTitle: 'API', timeBudgetMin: 120, tests: { visible: 2, hidden: 5 } } as unknown as TemplateView;
const task = {
  id: 't1',
  vacancyId: 'v1',
  template,
  visibility: 'open',
  spec: { title: 'Задание', source: 'template', domainStory: 'd', requirements: [], acceptance: [], contractMd: '' },
  rubric: { criteria: [] },
  requiredCatalogIds: [],
  wishesText: null,
  deadlineDays: null,
  createdAt: 'x',
  updatedAt: 'x',
  stats: { taken: 1, submissions: 1 },
} as unknown as EmployerTaskView;

const sub = (status: EmployerSubmissionView['status']): EmployerSubmissionView => ({
  id: 's1',
  status,
  kind: 'code',
  approachText: null,
  submittedAt: '2026-10-10T00:00:00.000Z',
  late: false,
  checkedAt: null,
  error: null,
  candidate: { id: 'c1', displayName: 'Кандидат #A1', category: null },
  repoUrl: null,
  commitSha: null,
  aiLogText: '',
  result: null,
  defense: null,
  aiDefense: null,
});
const page = (status: EmployerSubmissionView['status']) => ({ task, items: [sub(status)] });

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('EmployerProjectBlock: опрос сдач', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    m.list.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const mount = () =>
    render(<EmployerProjectBlock vacancyId="v1" specialization="backend" grade="middle" salaryFrom={100000} salaryTo={150000} archived={false} initialTask={task} templates={[template]} criteriaOptions={[]} />);

  it('после ошибок сети опрос продолжается с бэкоффом и доходит до результата', async () => {
    m.list
      .mockResolvedValueOnce(page('running'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page('checked'));
    mount();
    await tick(0);
    expect(m.list).toHaveBeenCalledTimes(1);
    expect(screen.getByText('проверяется')).toBeDefined();
    await tick(POLL_MS);
    expect(m.list).toHaveBeenCalledTimes(2);
    // Вторая попытка после ошибки – через 2×POLL_MS, не раньше.
    await tick(POLL_MS * 2 - 1);
    expect(m.list).toHaveBeenCalledTimes(2);
    await tick(1);
    expect(m.list).toHaveBeenCalledTimes(3);
    await tick(POLL_MS * 4);
    expect(m.list).toHaveBeenCalledTimes(4);
    expect(screen.getByText('проверено')).toBeDefined();
    // Проверено – опрос остановлен.
    await tick(POLL_MAX_MS * 2);
    expect(m.list).toHaveBeenCalledTimes(4);
  });

  it('пока сдача на проверке, успешный опрос повторяется с обычным интервалом', async () => {
    m.list.mockImplementation(async () => page('running'));
    mount();
    await tick(0);
    await tick(POLL_MS);
    await tick(POLL_MS);
    expect(m.list).toHaveBeenCalledTimes(3);
  });
});
