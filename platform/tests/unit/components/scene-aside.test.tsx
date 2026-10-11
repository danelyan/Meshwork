import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { SceneAside } from '@/components/consultant/SceneAside';
import { type SceneAsideData, candidateSteps, employerSteps, guestAside, hintFor, knownFacts, markStates, marketRows, onboardingMode } from '@/server/consultant/aside';
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
    expect(s.map((x) => x.id)).toEqual(['intro', 'test', 'call', 'project', 'ai_defense', 'invites', 'live_defense']);
    expect(s.map((x) => x.state)).toEqual(['done', 'now', 'next', 'next', 'next', 'next', 'next']);
  });
  it('порядок: тест → созвон → проект → ИИ-защита; ИИ-защита без готовой функции остаётся «скоро»', () => {
    const cat = { specialization: 'backend', grade: 'middle' };
    const s = candidateSteps({ ...base, intro: true, confirmed: 1, category: cat, call: true, project: true });
    expect(s.map((x) => x.state)).toEqual(['done', 'done', 'done', 'done', 'now', 'next', 'next']);
    expect(s[1]!.note).toBe('Backend · Middle');
    expect(s[4]!.note).toBe('скоро');
    expect(hintFor('candidate', s, undefined).title).toBe('ИИ-защита проекта');
  });
  it('нет утверждений — шаг созвона просит приложить резюме или ссылки', () => {
    const s = candidateSteps({ ...base, intro: true, category: { specialization: 'backend', grade: 'middle' } });
    expect(s[2]!.state).toBe('now');
    expect(s[2]!.note).toMatch(/резюме или ссылки/);
  });
  it('принятое приглашение: «Приглашения» пройдено, «Живая защита» — сейчас', () => {
    const s = candidateSteps({ ...base, intro: true, confirmed: 1, category: { specialization: 'backend', grade: 'middle' }, call: true, project: true, aiDefense: true, invitations: 2, accepted: 1 });
    expect(s.map((x) => x.state)).toEqual(['done', 'done', 'done', 'done', 'done', 'done', 'now']);
    expect(hintFor('candidate', s, undefined).title).toBe('Живая защита');
  });
  it('lane hired: найм — финальный этап «Нанят в …», весь путь пройден, подсказка про найм', () => {
    const s = candidateSteps({ ...base, intro: true, confirmed: 1, category: { specialization: 'backend', grade: 'middle' }, call: true, project: true, aiDefense: true, invitations: 1, accepted: 1, hired: { company: 'Северный Поток' } });
    expect(s.map((x) => x.id)).toEqual(['intro', 'test', 'call', 'project', 'ai_defense', 'invites', 'live_defense', 'hired']);
    expect(s.every((x) => x.state === 'done')).toBe(true);
    expect(s[7]!.label).toBe('Нанят в Северный Поток');
    expect(hintFor('candidate', s, undefined).title).toBe('Нанят в Северный Поток');
  });
  it('links candidate steps to existing sections', () => {
    expect(candidateSteps(base).map((x) => x.href)).toEqual(['/consultant', '/test', '/consultant', '/projects', '/projects', '/invitations', '/invitations']);
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

describe('блок под текущий шаг', () => {
  const hint = { title: 'x', text: 'y' };
  const market = { total: 2, rows: [{ key: 'backend:middle', label: 'Backend · Middle', count: 2, mine: false }] };
  const STEP_CARDS = ['aside-docs', 'aside-market', 'aside-step-test', 'aside-step-call', 'aside-step-project', 'aside-step-ai-defense', 'aside-step-invitations', 'aside-step-live', 'aside-step-hired'];
  const project = { taskId: 't1', title: 'Сервис заметок', status: 'checked' as const };
  const cases: { name: string; data: Partial<SceneAsideData>; shown: string[] }[] = [
    { name: 'onboarding', data: { stepBlock: { step: 'onboarding' }, docs: [] }, shown: ['aside-docs'] },
    { name: 'test', data: { stepBlock: { step: 'test' }, market }, shown: ['aside-market', 'aside-step-test'] },
    { name: 'call', data: { stepBlock: { step: 'call' } }, shown: ['aside-step-call'] },
    { name: 'project', data: { stepBlock: { step: 'project', project: null } }, shown: ['aside-step-project'] },
    { name: 'ai_defense', data: { stepBlock: { step: 'ai_defense', project } }, shown: ['aside-step-ai-defense'] },
    { name: 'waiting', data: { stepBlock: { step: 'waiting', invitations: { pending: 0, accepted: 0, total: 0 } } }, shown: ['aside-step-invitations'] },
    { name: 'invitations', data: { stepBlock: { step: 'invitations', invitations: { pending: 2, accepted: 0, total: 3 } } }, shown: ['aside-step-invitations'] },
    { name: 'live_defense', data: { stepBlock: { step: 'live_defense' } }, shown: ['aside-step-live'] },
    { name: 'hired', data: { stepBlock: { step: 'hired', hired: { company: 'Северный Поток' } } }, shown: ['aside-step-hired'] },
  ];
  const base: SceneAsideData = { role: 'candidate', steps: candidateSteps({ intro: true, introNote: '', confirmed: 0, category: null, invitations: 0 }), docs: null, hint };

  it.each(cases)('шаг $name: показан только свой блок; путь и «Что я о тебе знаю» на месте', ({ data, shown }) => {
    render(<SceneAside data={{ ...base, ...data }} />);
    for (const id of STEP_CARDS) expect(screen.queryByTestId(id) !== null, id).toBe(shown.includes(id));
    expect(screen.getByRole('navigation', { name: 'Твой путь' })).toBeTruthy();
    expect(screen.getByTestId('aside-known')).toBeTruthy();
    expect(screen.queryByTestId('aside-instructions')).toBeNull();
    expect(screen.queryByText('Как мне работать')).toBeNull();
  });

  it('ссылки блоков: тест, созвон, лента и задание, приглашения', () => {
    const href = (data: Partial<SceneAsideData>, name: RegExp) => {
      render(<SceneAside data={{ ...base, ...data }} />);
      const h = screen.getByRole('link', { name }).getAttribute('href');
      cleanup();
      return h;
    };
    expect(href({ stepBlock: { step: 'test' } }, /Начать тест/)).toBe('/test');
    expect(href({ stepBlock: { step: 'call' } }, /Созвониться/)).toBe('/consultant?call=1');
    expect(href({ stepBlock: { step: 'project', project: null } }, /ленту заданий/)).toBe('/projects');
    expect(href({ stepBlock: { step: 'project', project: { ...project, status: 'running' } } }, /Открыть задание/)).toBe('/projects/t1');
    expect(href({ stepBlock: { step: 'ai_defense', project } }, /Защитить проект/)).toBe('/projects/t1');
    expect(href({ stepBlock: { step: 'invitations', invitations: { pending: 1, accepted: 0, total: 1 } } }, /Открыть приглашения/)).toBe('/invitations');
  });

  it('нет данных для блока — карточки нет', () => {
    render(<SceneAside data={{ ...base, stepBlock: { step: 'ai_defense', project: null } }} />);
    for (const id of STEP_CARDS) expect(screen.queryByTestId(id)).toBeNull();
    cleanup();
    render(<SceneAside data={{ ...base, stepBlock: { step: 'test' }, market: { total: 0, rows: [] } }} />);
    expect(screen.queryByTestId('aside-market')).toBeNull();
    expect(screen.getByTestId('aside-step-test')).toBeTruthy();
  });

  it('счётчик приглашений в блоке', () => {
    render(<SceneAside data={{ ...base, stepBlock: { step: 'invitations', invitations: { pending: 2, accepted: 0, total: 3 } } }} />);
    expect(screen.getByTestId('aside-step-invitations').textContent).toMatch(/Ждут ответа: 2 приглашения/);
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
