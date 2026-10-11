import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { AsideProvider } from '@/components/consultant/aside-refresh';
import { SceneAside } from '@/components/consultant/SceneAside';
import { AI_CONSENT_BLOCKER, HIDDEN_BLOCKER, type SceneAsideData, blockerNotes, callCooldownCopy, candidateSteps, cooldownNote, liveNote, retakeCopy, promoteNow, stepBlocker, demandFor, employerSteps, guestAside, hintFor, knownFacts, markStates, marketRows, onboardingMode } from '@/server/consultant/aside';
import type { OnboardingView } from '@/server/onboarding/types';
import { liveStepCopy, pickLive } from '@/lib/live-step';

// MemoryCard переходит к шагу знакомства мягким обновлением (useRouter) – в тестах роутера нет.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
// MemoryCard uses the App Router for soft updates after editing onboarding facts.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const consentApi = vi.hoisted(() => ({ grant: vi.fn() }));
vi.mock('@/lib/consent-api', () => ({ grantConsentApi: consentApi.grant }));
afterEach(cleanup);

const base = { intro: false, introNote: '2 из 10', confirmed: 0, category: null, invitations: 0 };

describe('journey steps', () => {
  it('marks the first unfinished step as now, earlier ones done, later ones next', () => {
    const s = candidateSteps({ ...base, intro: true, confirmed: 3 });
    expect(s.map((x) => x.id)).toEqual(['intro', 'test', 'call', 'project', 'ai_defense', 'invites', 'live_defense']);
    expect(s.map((x) => x.state)).toEqual(['done', 'now', 'next', 'next', 'next', 'next', 'next']);
  });
  it('порядок: тест → созвон → проект → ИИ-защита; ИИ-защита ждёт проверки проекта', () => {
    const cat = { specialization: 'backend', grade: 'middle' };
    const s = candidateSteps({ ...base, intro: true, confirmed: 1, category: cat, call: true, project: true });
    expect(s.map((x) => x.state)).toEqual(['done', 'done', 'done', 'done', 'now', 'next', 'next']);
    expect(s[1]!.note).toBe('Backend · Middle');
    expect(s[4]!.note).toBe('после проверки проекта');
    expect(hintFor('candidate', s, undefined).title).toBe('ИИ-защита проекта');
  });
  it('нет утверждений – шаг созвона просит приложить резюме или ссылки', () => {
    const s = candidateSteps({ ...base, intro: true, category: { specialization: 'backend', grade: 'middle' } });
    expect(s[2]!.state).toBe('now');
    expect(s[2]!.note).toMatch(/резюме или ссылки/);
  });
  it('принятое приглашение: «Приглашения» пройдено, «Живая защита» – сейчас', () => {
    const s = candidateSteps({ ...base, intro: true, confirmed: 1, category: { specialization: 'backend', grade: 'middle' }, call: true, project: true, aiDefense: true, invitations: 2, accepted: 1 });
    expect(s.map((x) => x.state)).toEqual(['done', 'done', 'done', 'done', 'done', 'done', 'now']);
    expect(hintFor('candidate', s, undefined).title).toBe('Живая защита');
  });
  it('приглашение принято, проекта нет: «сейчас» – проект, защита ждёт сданного проекта', () => {
    const f = { ...base, intro: true, confirmed: 1, category: { specialization: 'backend', grade: 'middle' }, call: true, invitations: 1, accepted: 1 };
    const s = promoteNow(candidateSteps(f), 'project', true);
    expect(s.find((x) => x.id === 'project')!.state).toBe('now');
    expect(s.find((x) => x.id === 'live_defense')!.state).toBe('next');
    expect(s.find((x) => x.id === 'live_defense')!.note).toBe('после сданного проекта компания предложит слоты');
    // созвона нет, приглашение принято – «сейчас» всё равно у проекта (так считает journeyState)
    const t = promoteNow(candidateSteps({ ...f, call: false }), 'project', true);
    expect(t.filter((x) => x.state === 'now').map((x) => x.id)).toEqual(['project']);
    expect(promoteNow(candidateSteps({ ...f, call: false }), 'project').find((x) => x.id === 'call')!.state).toBe('now');
  });
  it('lane hired: найм – финальный этап «Нанят в …», весь путь пройден, подсказка про найм', () => {
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

  it('нет данных для блока – карточки нет', () => {
    render(<SceneAside data={{ ...base, stepBlock: { step: 'ai_defense', project: null } }} />);
    for (const id of STEP_CARDS) expect(screen.queryByTestId(id)).toBeNull();
    cleanup();
    render(<SceneAside data={{ ...base, stepBlock: { step: 'test' }, market: { total: 0, rows: [] } }} />);
    expect(screen.queryByTestId('aside-market')).toBeNull();
    expect(screen.getByTestId('aside-step-test')).toBeTruthy();
  });
  it('тест при выбранном направлении: спрос одной строкой в карточке шага, таблицы по всем направлениям нет', () => {
    const vacancies = [{ specialization: 'backend', grade: 'junior' }, { specialization: 'backend', grade: 'middle' }, { specialization: 'backend', grade: 'middle' }, { specialization: 'frontend', grade: 'senior' }];
    const demand = demandFor(vacancies, 'backend');
    expect(demand).toEqual({ direction: 'Backend', total: 3, detail: 'Junior 1 · Middle 2' });
    expect(demandFor(vacancies, 'ai')).toBeUndefined();
    expect(demandFor(vacancies, null)).toBeUndefined();
    render(<SceneAside data={{ ...base, stepBlock: { step: 'test', demand }, market }} />);
    expect(screen.queryByTestId('aside-market')).toBeNull();
    expect(screen.getByTestId('step-test-extra').textContent).toBe('Сейчас в направлении Backend: 3 вакансии · Junior 1 · Middle 2');
  });
  it('с блоком шага подсказка под путём не дублируется', () => {
    render(<SceneAside data={{ ...base, stepBlock: { step: 'call' } }} />);
    expect(screen.queryByTestId('aside-hint')).toBeNull();
  });

  it('проект при принятом приглашении: «Компания ждёт твой проект»', () => {
    render(<SceneAside data={{ ...base, stepBlock: { step: 'project', project: null, forLive: true } }} />);
    expect(screen.getByTestId('aside-step-project').textContent).toMatch(/Компания ждёт твой проект: без него защиту не назначить/);
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

  it('режим знакомства – до итога, в том числе на паузе (необязательные вопросы ждут в чате)', () => {
    expect(onboardingMode(view({}))).toBe(true);
    expect(onboardingMode(view({ later: true }))).toBe(true);
    expect(onboardingMode(view({ onboarded: true }))).toBe(false);
    expect(onboardingMode(undefined)).toBe(false);
  });

  it('две карточки: заполнение профиля с цифрами и ответы; без пути, рынка, файлов и настроек', () => {
    render(<SceneAside data={guestAside(view({}))} />);
    expect(screen.getByTestId('aside-progress').textContent).toContain('Заполнение профиля · 2 из 11 вопросов');
    expect(screen.getByRole('progressbar', { name: 'Пройдено 2 из 11 вопросов' })).toBeDefined();
    expect(screen.getByTestId('aside-progress').textContent).toContain('сейчас: грейд'.replace('сейчас', 'Сейчас'));
    expect(screen.getByTestId('aside-known').textContent).toContain('Подтвердить грейд');
    expect(screen.queryByRole('button', { name: '+ добавить' })).toBeNull();
    for (const id of ['market', 'docs', 'instructions']) expect(screen.queryByTestId(`aside-${id}`)).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Твой путь' })).toBeNull();
  });

  it('на паузе – «+ дополнить» следующим вопросом вместо строки «сейчас»', () => {
    render(<SceneAside data={guestAside(view({ later: true }))} />);
    expect(screen.getByRole('button', { name: '+ дополнить: грейд' })).toBeDefined();
    expect(screen.getByTestId('aside-progress').textContent).not.toContain('Сейчас');
  });
});

describe('блокер шага', () => {
  const hint = { title: 'x', text: 'y' };
  const base: SceneAsideData = { role: 'candidate', steps: candidateSteps({ intro: true, introNote: '', confirmed: 0, category: null, invitations: 0 }), docs: null, hint };

  it('stepBlocker: нет согласия на ИИ – у теста, созвона, проекта, защит; скрытый профиль – у приглашений', () => {
    for (const step of ['test', 'call', 'project', 'ai_defense', 'live_defense'] as const) expect(stepBlocker(step, { aiConsent: false, hidden: false })).toBe(AI_CONSENT_BLOCKER);
    expect(stepBlocker('onboarding', { aiConsent: false, hidden: true })).toBeUndefined();
    expect(stepBlocker('waiting', { aiConsent: false, hidden: true })).toBe(HIDDEN_BLOCKER);
    expect(stepBlocker('invitations', { aiConsent: true, hidden: true })).toBe(HIDDEN_BLOCKER);
    expect(stepBlocker('test', { aiConsent: true, hidden: true })).toBeUndefined();
    expect(HIDDEN_BLOCKER.href).toBe('/settings');
  });

  it('blockerNotes: нота текущего шага – про согласие, «Приглашения» – «профиль скрыт»', () => {
    const steps = candidateSteps({ intro: true, introNote: '', confirmed: 0, category: null, invitations: 0 });
    const out = blockerNotes(steps, 'test', { aiConsent: false, hidden: true });
    expect(out.find((s) => s.id === 'test')!.note).toMatch(/согласие на оценку ИИ/);
    expect(out.find((s) => s.id === 'call')!.note).not.toMatch(/согласие/);
    expect(out.find((s) => s.id === 'invites')!.note).toBe('профиль скрыт');
    expect(blockerNotes(steps, 'test', { aiConsent: true, hidden: false })).toEqual(steps);
  });

  it('согласие: блокер с кнопкой «Дать согласие», кнопка шага вторичная; клик выдаёт согласие и перечитывает колонку', async () => {
    consentApi.grant.mockResolvedValue({ kind: 'ai_assessment', version: 'v', acceptedAt: '' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => base });
    vi.stubGlobal('fetch', fetchMock);
    const data = { ...base, stepBlock: { step: 'test' as const, blocker: AI_CONSENT_BLOCKER } };
    render(
      <AsideProvider initial={data}>
        <SceneAside data={data} />
      </AsideProvider>,
    );
    expect(screen.getByTestId('step-test-blocker').textContent).toMatch(/Сначала – согласие на оценку ИИ/);
    expect(screen.getByTestId('step-test-cta').className).toMatch(/ctaSecondary/);
    fireEvent.click(screen.getByRole('button', { name: 'Дать согласие' }));
    await vi.waitFor(() => expect(consentApi.grant).toHaveBeenCalledWith('ai_assessment', expect.any(String)));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/consultant/aside', expect.anything()), { timeout: 2000 });
    vi.unstubAllGlobals();
  });

  it('скрытый профиль: блокер со ссылкой на /settings', () => {
    render(<SceneAside data={{ ...base, stepBlock: { step: 'waiting', invitations: { pending: 0, accepted: 0, total: 0 }, blocker: HIDDEN_BLOCKER } }} />);
    expect(screen.getByTestId('step-invitations-blocker').textContent).toMatch(/Профиль скрыт – компании тебя не видят/);
    expect(screen.getByRole('link', { name: 'Открыть настройки' }).getAttribute('href')).toBe('/settings');
  });
});

describe('живая защита: подстатусы', () => {
  const hint = { title: 'x', text: 'y' };
  const base: SceneAsideData = { role: 'candidate', steps: candidateSteps({ intro: true, introNote: '', confirmed: 0, category: null, invitations: 0 }), docs: null, hint };
  const at = '2026-10-12T11:30:00.000Z'; // 14:30 МСК
  const card = (live: Parameters<typeof liveStepCopy>[0]) => {
    render(<SceneAside data={{ ...base, stepBlock: { step: 'live_defense', live } }} />);
    const el = screen.getByTestId('aside-step-live');
    const links = Array.from(el.querySelectorAll('a')).map((a) => [a.textContent, a.getAttribute('href')]);
    const text = el.textContent;
    cleanup();
    return { text, links };
  };

  it('нет предложения – компания предложит время, кнопка «Открыть приглашения»', () => {
    const c = card({ status: 'none' });
    expect(c.text).toMatch(/Компания предложит время; ты выберешь слот/);
    expect(c.links).toEqual([['Открыть приглашения', '/invitations']]);
  });
  it('slots_proposed – выбрать слот', () => {
    const c = card({ status: 'slots_proposed', company: 'Северный Поток' });
    expect(c.text).toMatch(/Компания предложила слоты – выбери время/);
    expect(c.text).toMatch(/Северный Поток/);
    expect(c.links).toEqual([['Выбрать слот', '/invitations']]);
  });
  it('scheduled – дата и время по МСК; комната открыта – «Открыть комнату»', () => {
    let c = card({ status: 'scheduled', scheduledAt: at });
    expect(c.text).toMatch(/Защита назначена на .*12\.10 14:30 МСК/);
    expect(c.links).toEqual([['Открыть приглашения', '/invitations']]);
    c = card({ status: 'scheduled', scheduledAt: at, roomHref: '/defense-room/x' });
    expect(c.links).toEqual([['Открыть комнату', '/defense-room/x']]);
  });
  it('done – ждём решение, без главной кнопки; no_show – компания может назначить новую', () => {
    const d = card({ status: 'done' });
    expect(d.text).toMatch(/Защита прошла – ждём решение компании/);
    expect(d.links).toEqual([]);
    expect(card({ status: 'no_show' }).text).toMatch(/Защита не состоялась – компания может назначить новую/);
  });
  it('нота шага в пути – коротко по подстатусу; из нескольких приглашений – самое живое', () => {
    const steps = promoteNow(candidateSteps({ intro: true, introNote: '', confirmed: 1, category: { specialization: 'backend', grade: 'middle' }, call: true, project: true, aiDefense: true, invitations: 1, accepted: 1 }), 'live_defense');
    expect(liveNote(steps, { status: 'slots_proposed' }).find((s) => s.id === 'live_defense')!.note).toBe('выбери слот');
    expect(liveNote(steps, { status: 'scheduled', scheduledAt: at }).find((s) => s.id === 'live_defense')!.note).toMatch(/назначена: .*14:30 МСК/);
    expect(liveNote(steps, undefined)).toEqual(steps);
    expect(pickLive([{ status: 'done' }, { status: 'slots_proposed' }, { status: 'none' }])!.status).toBe('slots_proposed');
  });
});

describe('кулдауны теста и созвона', () => {
  const hint = { title: 'x', text: 'y' };
  const base: SceneAsideData = { role: 'candidate', steps: candidateSteps({ intro: true, introNote: '', confirmed: 0, category: null, invitations: 0 }), docs: null, hint };
  const now = new Date('2026-10-11T12:00:00Z');

  it('тест: пересдача того же грейда через N дн., другой грейд – сейчас; нота шага', () => {
    const c = retakeCopy({ grade: 'middle', nextAllowedAt: new Date('2026-10-20T10:00:00Z'), demo: false }, now);
    expect(c.note).toBe('пересдача Middle через 9 дн.');
    expect(c.blocker.text).toMatch(/^Пересдать Middle можно через 9 дн\. \(с .*МСК\)\. Другой грейд можно сдать уже сейчас\.$/);
    expect(c.blocker.href).toBeUndefined();
    expect(c.blocker.action).toBeUndefined();
    expect(retakeCopy({ grade: 'junior', nextAllowedAt: new Date(now.getTime() + 30_000), demo: true }, now).note).toBe('пересдача Junior через 1 мин');
    const steps = cooldownNote(base.steps, c);
    expect(steps.find((s) => s.id === 'test')!.note).toBe('пересдача Middle через 9 дн.');
    expect(cooldownNote(base.steps, undefined)).toEqual(base.steps);
  });

  it('созвон: «повторный созвон через N ч» – нота и блокер без кнопки', () => {
    const c = callCooldownCopy('Повторный созвон - через 5 ч');
    expect(c.note).toBe('повторный созвон через 5 ч');
    render(<SceneAside data={{ ...base, stepBlock: { step: 'call', blocker: c.blocker } }} />);
    expect(screen.getByTestId('step-call-blocker').textContent).toBe('Повторный созвон - через 5 ч');
    expect(screen.queryByRole('button', { name: 'Дать согласие' })).toBeNull();
    expect(screen.getByTestId('step-call-cta').className).toMatch(/ctaSecondary/);
  });
});
