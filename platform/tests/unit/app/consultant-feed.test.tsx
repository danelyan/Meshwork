import type { ReactElement } from 'react';

// /consultant: онбординг кандидата и консультация — одна лента (решение владельца 10.10).
const svc = vi.hoisted(() => ({ inFeed: vi.fn(async () => true), getView: vi.fn(async () => ({ current: { kind: 'one' } })) }));
vi.mock('@/server/auth/page', () => ({ requirePageCandidate: vi.fn(async () => ({ userId: 'u1', candidateId: 'c1', role: 'candidate' })) }));
vi.mock('@/server/agent/restore', () => ({ loadLastChat: vi.fn(async () => ({ conversationId: 'conv-1', items: [] })) }));
vi.mock('@/server/demo/context', () => ({ resolveChatDemoContext: vi.fn(async () => ({ noLlm: true, resume: null })) }));
vi.mock('@/server/onboarding/service', () => ({ onboardingInFeed: svc.inFeed, getView: svc.getView }));
vi.mock('@/components/Chat', () => ({ Chat: () => null }));
vi.mock('@/components/onboarding/OnboardingChat', () => ({ OnboardingChat: () => null }));
vi.mock('@/components/head/ConsultantScene', () => ({ ConsultantScene: ({ children }: { children: unknown }) => children }));

async function inner(): Promise<ReactElement<Record<string, unknown>>> {
  const { default: Page } = await import('@/app/(candidate)/consultant/page');
  const scene = (await Page()) as ReactElement<{ children: ReactElement<Record<string, unknown>> }>;
  return scene.props.children;
}

afterEach(() => vi.clearAllMocks());

it('знакомство не завершено или пройдено в чате — лента онбординга с разговором консультанта', async () => {
  const { OnboardingChat } = await import('@/components/onboarding/OnboardingChat');
  const el = await inner();
  expect(el.type).toBe(OnboardingChat);
  expect(el.props.variant).toBe('consultant');
  expect(el.props.consultant).toEqual({ demo: { noLlm: true, resume: null }, restored: { conversationId: 'conv-1', items: [] } });
  expect(svc.getView).toHaveBeenCalledWith('u1');
});

it('аккаунт без чата-знакомства (сид демо) — обычный чат, состояние онбординга не создаётся', async () => {
  svc.inFeed.mockResolvedValueOnce(false);
  const { Chat } = await import('@/components/Chat');
  expect((await inner()).type).toBe(Chat);
  expect(svc.getView).not.toHaveBeenCalled();
});

it('сбой онбординга не закрывает консультанта — обычный чат', async () => {
  svc.getView.mockRejectedValueOnce(new Error('db down'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const { Chat } = await import('@/components/Chat');
  expect((await inner()).type).toBe(Chat);
  warn.mockRestore();
});
