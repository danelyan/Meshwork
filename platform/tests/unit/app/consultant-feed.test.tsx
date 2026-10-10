import type { ReactElement } from 'react';

// /consultant — один адрес с чатом (решения владельца 10.10): знакомство любой роли, консультант кандидата,
// пауза «Настроить позже». Гварды и куки — tests/unit/app/candidate-guard.test.tsx.
const m = vi.hoisted(() => ({
  session: { userId: 'u1', candidateId: 'c1', employerProfileId: null, role: 'candidate' } as Record<string, unknown>,
  inFeed: vi.fn(async () => true),
  getView: vi.fn(async (): Promise<Record<string, unknown>> => ({ current: { kind: 'one' }, onboarded: false })),
  loadLastChat: vi.fn(async () => ({ conversationId: 'conv-1', items: [] })),
  loadLastEmployerChat: vi.fn(async () => ({ conversationId: 'e-conv', items: [] })),
}));
class Redirect extends Error {
  constructor(readonly to: string) {
    super(`NEXT_REDIRECT ${to}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock('@/server/auth/page', () => ({ requirePageAccount: vi.fn(async () => m.session) }));
vi.mock('@/server/agent/restore', () => ({ loadLastChat: m.loadLastChat }));
vi.mock('@/server/agent/employer/restore', () => ({ loadLastEmployerChat: m.loadLastEmployerChat }));
vi.mock('@/server/demo/context', () => ({
  resolveChatDemoContext: vi.fn(async () => ({ noLlm: true, resume: null })),
  chatDemoContextFromCookies: vi.fn(async () => ({ noLlm: true, resume: null })),
}));
vi.mock('@/server/demo/mode', () => ({ llmIsDemoStub: () => true }));
vi.mock('@/server/onboarding/service', () => ({ onboardingInFeed: m.inFeed, getView: m.getView }));
vi.mock('@/components/Chat', () => ({ Chat: () => null }));
vi.mock('@/components/employer/AssistantChat', () => ({ AssistantChat: () => null }));
vi.mock('@/components/onboarding/OnboardingChat', () => ({ OnboardingChat: () => null }));
vi.mock('@/components/onboarding/PausedFeed', () => ({ PausedFeed: () => null }));
vi.mock('@/components/head/ConsultantScene', () => ({ ConsultantScene: ({ children }: { children: unknown }) => children }));

type El = ReactElement<Record<string, unknown>>;
async function inner(): Promise<El> {
  const { default: Page } = await import('@/app/(candidate)/consultant/page');
  const scene = (await Page()) as ReactElement<{ children: El }>;
  return scene.props.children;
}
async function redirected(): Promise<string> {
  try {
    await inner();
    return 'ok';
  } catch (e) {
    if (e instanceof Redirect) return e.to;
    throw e;
  }
}

const CANDIDATE = { userId: 'u1', candidateId: 'c1', employerProfileId: null, role: 'candidate' };
beforeEach(() => {
  m.session = { ...CANDIDATE };
});
afterEach(() => vi.clearAllMocks());

describe('кандидат', () => {
  it('знакомство не завершено или пройдено в чате — лента онбординга с разговором консультанта', async () => {
    const { OnboardingChat } = await import('@/components/onboarding/OnboardingChat');
    const el = await inner();
    expect(el.type).toBe(OnboardingChat);
    expect(el.props.variant).toBe('consultant');
    expect(el.props.consultant).toEqual({ demo: { noLlm: true, resume: null }, restored: { conversationId: 'conv-1', items: [] } });
    expect(m.getView).toHaveBeenCalledWith('u1');
  });

  it('«Настроить позже» (view.later) — пауза: шаги + свободный разговор', async () => {
    m.getView.mockResolvedValueOnce({ current: { kind: 'one' }, onboarded: false, later: true });
    const { PausedFeed } = await import('@/components/onboarding/PausedFeed');
    const el = await inner();
    expect(el.type).toBe(PausedFeed);
    expect(el.props.restored).toEqual({ conversationId: 'conv-1', items: [] });
  });

  it('аккаунт без чата-знакомства (сид демо) — обычный чат, состояние онбординга не создаётся', async () => {
    m.inFeed.mockResolvedValueOnce(false);
    const { Chat } = await import('@/components/Chat');
    expect((await inner()).type).toBe(Chat);
    expect(m.getView).not.toHaveBeenCalled();
  });

  it('сбой онбординга не закрывает консультанта — обычный чат', async () => {
    m.getView.mockRejectedValueOnce(new Error('db down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { Chat } = await import('@/components/Chat');
    expect((await inner()).type).toBe(Chat);
    warn.mockRestore();
  });

  it('старая кука демо-кандидата без аккаунта — обычный чат', async () => {
    m.session = { userId: null, candidateId: 'c1', employerProfileId: null, role: 'candidate' };
    const { Chat } = await import('@/components/Chat');
    expect((await inner()).type).toBe(Chat);
    expect(m.inFeed).not.toHaveBeenCalled();
  });
});

describe('роль не выбрана', () => {
  it('лента знакомства (согласие, роль); разговор кандидата не грузится', async () => {
    m.session = { userId: 'u3', candidateId: null, employerProfileId: null, role: 'pending' };
    const { OnboardingChat } = await import('@/components/onboarding/OnboardingChat');
    const el = await inner();
    expect(el.type).toBe(OnboardingChat);
    expect(el.props.variant).toBe('consultant');
    expect(m.loadLastChat).not.toHaveBeenCalled();
  });
});

describe('работодатель', () => {
  beforeEach(() => {
    m.session = { userId: 'u2', candidateId: null, employerProfileId: 'e1', role: 'employer' };
  });

  it('знакомство в ленте; после итога — помощник по подбору; данные кандидата не грузятся', async () => {
    m.getView.mockResolvedValueOnce({ current: { kind: 'summary' }, onboarded: true });
    const { OnboardingChat } = await import('@/components/onboarding/OnboardingChat');
    const el = await inner();
    expect(el.type).toBe(OnboardingChat);
    expect(el.props.consultant).toBeUndefined();
    expect(el.props.employerAssistant).toEqual({ demoNoLlm: true, restored: { conversationId: 'e-conv', items: [] } });
    expect(m.loadLastChat).not.toHaveBeenCalled();
  });

  it('завершил без чата (сид демо) — сразу помощник по подбору с последним разговором, без редиректа', async () => {
    m.inFeed.mockResolvedValueOnce(false);
    expect(await redirected()).toBe('ok');
    const { AssistantChat } = await import('@/components/employer/AssistantChat');
    m.inFeed.mockResolvedValueOnce(false);
    const el = await inner();
    expect(el.type).toBe(AssistantChat);
    expect(el.props.initial).toEqual({ conversationId: 'e-conv', items: [] });
    expect(m.loadLastChat).not.toHaveBeenCalled();
  });

  it('знакомство не завершено — шаги; разговор помощника грузится (реплики прежних пауз стоят под своими шагами)', async () => {
    m.getView.mockResolvedValueOnce({ current: { kind: 'one' }, onboarded: false });
    const el = await inner();
    expect(el.props.employerAssistant).toEqual({ demoNoLlm: true, restored: { conversationId: 'e-conv', items: [] } });
    expect(m.loadLastEmployerChat).toHaveBeenCalledWith('e1');
  });

  it('«Настроить позже» (view.later) — пауза с помощником по подбору, как у кандидата', async () => {
    m.getView.mockResolvedValueOnce({ current: { kind: 'one' }, onboarded: false, later: true });
    const { PausedFeed } = await import('@/components/onboarding/PausedFeed');
    const el = await inner();
    expect(el.type).toBe(PausedFeed);
    expect(el.props.employer).toEqual({ demoNoLlm: true, restored: { conversationId: 'e-conv', items: [] } });
    expect(el.props.restored).toBeUndefined();
    expect(m.loadLastChat).not.toHaveBeenCalled();
  });
});
