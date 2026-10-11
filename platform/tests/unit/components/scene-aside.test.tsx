import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { SceneAside } from '@/components/consultant/SceneAside';
import { candidateSteps, employerSteps, guestAside, knownFacts, markStates, marketRows, onboardingMode } from '@/server/consultant/aside';
import type { OnboardingView } from '@/server/onboarding/types';

// MemoryCard переходит к шагу знакомства мягким обновлением (useRouter) — в тестах роутера нет.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
// MemoryCard uses the App Router for soft updates after editing onboarding facts.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

const base = { intro: false, introNote: '2 из 10', confirmed: 0, category: null, invitations: 0 };

describe('journey steps', () => {
  it('marks the first unfinished step as now, earlier ones done, later ones next', () => {
    const s = candidateSteps({ ...base, intro: true, confirmed: 3 });
    expect(s.map((x) => x.state)).toEqual(['done', 'done', 'now', 'next']);
  });
  it('keeps the last step as now when everything before it is done', () => {
    const s = candidateSteps({ ...base, intro: true, confirmed: 1, category: { specialization: 'backend', grade: 'middle' }, invitations: 2 });
    expect(s.map((x) => x.state)).toEqual(['done', 'done', 'done', 'now']);
    expect(s[2]!.note).toBe('Backend · Middle');
    expect(s[3]!.note).toBe('2 приглашения');
  });
  it('links candidate steps to existing sections', () => {
    expect(candidateSteps(base).map((x) => x.href)).toEqual(['/consultant', '/profile', '/test', '/invitations']);
  });
  it('employer path: company, need, search, invitations', () => {
    const s = employerSteps({ intro: true, introNote: 'пройдено', needs: 1, invitations: 0 });
    expect(s.map((x) => x.state)).toEqual(['done', 'done', 'now', 'next']);
    expect(s.map((x) => x.href)).toEqual(['/consultant', '/employer', '/employer/search', '/employer/invitations']);
  });
  it('markStates works on a single step', () => {
    expect(markStates([{ id: 'a', label: 'A', short: 'A', note: '', href: '/', done: true }])[0]!.state).toBe('now');
  });
});

describe('SceneAside', () => {
  const data = { role: 'candidate' as const, steps: candidateSteps(base), docs: [], hint: { title: 'Документы', text: 'Прикрепи файл' } };
  it('renders roadmap, empty files card with the drop zone and the hint', () => {
    render(<SceneAside data={data} />);
    expect(screen.getByTestId('journey-intro').getAttribute('data-state')).toBe('now');
    expect(screen.getByTestId('files-drop')).toBeTruthy();
    expect(screen.getByText('Прикрепи файл')).toBeTruthy();
  });
  it('lists documents with their parse status and toggles the accordion', () => {
    render(<SceneAside data={{ ...data, docs: [{ id: '1', name: 'cv.pdf', kind: 'file', status: 'разобран, 2 утверждения' }] }} />);
    expect(screen.getByText('cv.pdf')).toBeTruthy();
    const toggle = screen.getByRole('button', { name: /Файлы и ссылки · 1/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
  it('employer has no documents block', () => {
    render(<SceneAside data={{ ...data, role: 'employer', docs: null }} />);
    expect(screen.queryByTestId('aside-docs')).toBeNull();
  });
});

describe('known facts and market', () => {
  const view = (over: Partial<OnboardingView>) => ({ history: [], summary: null, ...over }) as unknown as OnboardingView;
  it('takes answered steps from history, hides consent, role and skipped ones', () => {
    const v = view({
      history: [
        { stepId: 'consent', label: 'Согласие', lead: '', question: '', answer: 'Да', editable: false },
        { stepId: 'goal', label: 'Цель', lead: '', question: '', answer: 'Ищу работу', editable: true },
        { stepId: 'fsp', label: 'ФСП', lead: '', question: '', answer: null, editable: true },
      ],
    });
    expect(knownFacts(v)).toEqual([{ id: 'step:goal', source: 'onboarding', stepId: 'goal', label: 'Цель', value: 'Ищу работу', editable: true }]);
    expect(knownFacts(undefined)).toEqual([]);
  });
  it('prefers the summary when it is shown', () => {
    const v = view({ summary: { items: [{ stepId: 'role', label: 'Роль', value: 'x' }, { stepId: 'spec', label: 'Специализация', value: 'Backend' }], skipped: [], warnings: [] } });
    expect(knownFacts(v)).toEqual([{ id: 'step:spec', source: 'onboarding', stepId: 'spec', label: 'Специализация', value: 'Backend', editable: false }]);
  });
  it('groups by category, puts the user category first', () => {
    const m = marketRows(
      [
        { specialization: 'backend', grade: 'junior' },
        { specialization: 'frontend', grade: 'middle' },
        { specialization: 'frontend', grade: 'middle' },
      ],
      (s, g) => s === 'frontend' && g === 'middle',
    );
    expect(m.total).toBe(3);
    expect(m.rows).toEqual([
      { key: 'frontend:middle', label: 'Frontend · Middle', count: 2, mine: true },
      { key: 'backend:junior', label: 'Backend · Junior', count: 1, mine: false },
    ]);
  });
  it('renders the known and market cards', () => {
    render(
      <SceneAside
        data={{
          role: 'employer',
          steps: employerSteps({ intro: false, introNote: '1 из 5', needs: 0, invitations: 0 }),
          known: [{ id: 'step:inn', source: 'onboarding', stepId: 'inn', label: 'ИНН', value: '7707083893', editable: false }],
          market: { total: 4, rows: [{ key: 'backend:middle', label: 'Backend · Middle', count: 4, mine: true }] },
          docs: null,
          hint: { title: 'Компания', text: '...' },
        }}
      />,
    );
    expect(screen.getByRole('button', { name: /Что я знаю о компании · 1/ })).toBeTruthy();
    expect(screen.getByText('7707083893')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Кандидаты в базе · 4/ })).toBeTruthy();
  });
});

// Минимализм на всё знакомство (владелец 11.10): справа только прогресс анкеты и «Что я о тебе знаю».
describe('колонка на время знакомства', () => {
  const view = (over: Partial<OnboardingView>) =>
    ({ role: 'candidate', later: false, onboarded: false, progress: { done: 2, total: 11 }, current: { id: 'grade', kind: 'one', label: 'Грейд' }, summary: null,
      history: [{ stepId: 'goal', label: 'Цель', answer: 'Подтвердить грейд' }, { stepId: 'specialization', label: 'Направление', answer: 'Engineering' }], ...over }) as unknown as OnboardingView;

  it('режим знакомства — до итога, в том числе на паузе (необязательные вопросы ждут в чате)', () => {
    expect(onboardingMode(view({}))).toBe(true);
    expect(onboardingMode(view({ later: true }))).toBe(true);
    expect(onboardingMode(view({ onboarded: true }))).toBe(false);
    expect(onboardingMode(undefined)).toBe(false);
  });

  it('две карточки: заполнение профиля с цифрами и ответы; без пути, рынка, файлов и настроек', () => {
    render(<SceneAside data={guestAside(view({}))} />);
    expect(screen.getByTestId('aside-progress').textContent).toContain('Заполнение профиля · 2 из 11');
    expect(screen.getByRole('progressbar', { name: 'Заполнено 2 из 11' })).toBeDefined();
    expect(screen.getByTestId('aside-progress').textContent).toContain('сейчас: грейд'.replace('сейчас', 'Сейчас'));
    expect(screen.getByTestId('aside-known').textContent).toContain('Подтвердить грейд');
    expect(screen.queryByRole('button', { name: '+ добавить' })).toBeNull();
    for (const id of ['market', 'docs', 'instructions']) expect(screen.queryByTestId(`aside-${id}`)).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Твой путь' })).toBeNull();
  });

  it('на паузе — «+ дополнить» следующим вопросом вместо строки «сейчас»', () => {
    render(<SceneAside data={guestAside(view({ later: true }))} />);
    expect(screen.getByRole('button', { name: '+ дополнить: грейд' })).toBeDefined();
    expect(screen.getByTestId('aside-progress').textContent).not.toContain('Сейчас');
  });
});
