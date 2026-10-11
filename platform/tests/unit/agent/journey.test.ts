import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  prisma: {} as Record<string, Record<string, (a?: { where?: Record<string, unknown> }) => unknown>>,
}));
vi.mock('@/server/db', () => ({ prisma: db.prisma }));

import { journeyState, JOURNEY_STEPS, stepHint, STEP_HINT } from '@/server/agent/journey';

interface World {
  onboarded: boolean;
  sources: number;
  claims: Record<string, number>;
  category: boolean;
  qualifying: number;
  checkedProjects: number;
  aiDefense: number;
  sentInv: number;
  acceptedInv: number;
  hired: boolean;
}
const fresh = (): World => ({ onboarded: true, sources: 0, claims: {}, category: false, qualifying: 0, checkedProjects: 0, aiDefense: 0, sentInv: 0, acceptedInv: 0, hired: false });
let w: World;
const seen: { call: unknown[]; project: unknown[] } = { call: [], project: [] };

beforeEach(() => {
  w = fresh();
  seen.call = [];
  seen.project = [];
  Object.assign(db.prisma, {
    user: { findUnique: () => ({ onboardedAt: w.onboarded ? new Date() : null }) },
    source: { count: () => w.sources },
    upload: { count: () => 0 },
    claim: { groupBy: () => Object.entries(w.claims).map(([status, n]) => ({ status, _count: { _all: n } })) },
    candidateCategory: { findFirst: () => (w.category ? { id: 'c' } : null) },
    callSession: {
      count: (a?: { where?: Record<string, unknown> }) => {
        seen.call.push(a?.where);
        return a?.where?.kind !== 'defense' ? w.qualifying : w.aiDefense;
      },
    },
    projectSubmission: { count: (a?: { where?: Record<string, unknown> }) => { seen.project.push(a?.where); return w.checkedProjects; } },
    invitation: {
      count: (a?: { where?: { status?: unknown } }) => (a?.where?.status === 'accepted' ? w.acceptedInv : w.sentInv),
      findFirst: () => (w.hired ? { hiredAt: new Date('2026-10-11T10:00:00Z'), company: { name: 'Северный Поток' }, vacancy: null } : null),
    },
  });
});

const next = async () => (await journeyState('c1')).nextStep;

describe('journeyState: порядок шагов (ADR 0008)', () => {
  it('порядок шагов и набор подсказок', () => {
    expect([...JOURNEY_STEPS]).toEqual(['onboarding', 'test', 'call', 'project', 'ai_defense']);
    for (const k of [...JOURNEY_STEPS, 'waiting', 'invitations', 'live_defense', 'hired'] as const) expect(STEP_HINT[k]).toBeTruthy();
  });

  it('знакомство не закончено → onboarding; после него первым идёт тест', async () => {
    w.onboarded = false;
    expect(await next()).toBe('onboarding');
    w.onboarded = true;
    expect(await next()).toBe('test');
  });

  it('карточки резюме не блокируют тест: непринятые черновики, а тест первый', async () => {
    w.claims = { proposed: 6 };
    expect(await next()).toBe('test');
  });

  it('тест пройден, утверждений нет → созвон с подсказкой приложить источники', async () => {
    w.category = true;
    const s = await journeyState('c1');
    expect(s.nextStep).toBe('call');
    expect(s.callNeedsSources).toBe(true);
    expect(stepHint(s)).toMatch(/резюме файлом или ссылку на GitHub/);
  });

  it('отклонённые утверждения не считаются: перед созвоном источников нет', async () => {
    w.category = true;
    w.claims = { rejected: 3 };
    expect((await journeyState('c1')).callNeedsSources).toBe(true);
  });

  it('тест пройден, утверждения есть → созвон без просьбы о источниках', async () => {
    w.category = true;
    w.claims = { confirmed: 2 };
    const s = await journeyState('c1');
    expect(s).toMatchObject({ nextStep: 'call', callNeedsSources: false });
    expect(stepHint(s)).toBe(STEP_HINT.call);
  });

  it('завершённый квалифицирующий созвон → проект; запрос берёт qualifying или interview (ИИнтервью после теста) и finished', async () => {
    w.category = true;
    w.claims = { confirmed: 1 };
    w.qualifying = 1;
    expect(await next()).toBe('project');
    expect(seen.call[0]).toMatchObject({ kind: { in: ['qualifying', 'interview'] }, status: 'finished' });
  });

  it('проект считается только проверенным (checked с результатом)', async () => {
    w.category = true;
    w.qualifying = 1;
    await journeyState('c1');
    expect(seen.project[0]).toMatchObject({ status: 'checked', resultJson: { not: Prisma.DbNull } });
    w.checkedProjects = 1;
    expect(await next()).toBe('ai_defense');
  });

  it('ИИ-защита: без таких сессий шаг не пройден, подсказка «скоро»; запрос — защита сабмита без приглашения', async () => {
    Object.assign(w, { category: true, qualifying: 1, checkedProjects: 1, aiDefense: 0 });
    const s = await journeyState('c1');
    expect(s.nextStep).toBe('ai_defense');
    expect(s.steps.ai_defense).toBe(false);
    expect(stepHint(s)).toMatch(/скоро/i);
    expect(seen.call[1]).toMatchObject({ kind: 'defense', status: 'finished', projectSubmission: { defenseInvitationId: null } });
  });

  it('ИИ-защита пройдена → ждать приглашение', async () => {
    Object.assign(w, { category: true, qualifying: 1, checkedProjects: 1, aiDefense: 1 });
    expect(await next()).toBe('waiting');
  });

  it('приглашение без ответа важнее любого шага', async () => {
    w.sentInv = 1;
    expect(await next()).toBe('invitations'); // даже до теста
    Object.assign(w, { category: true, qualifying: 1, checkedProjects: 1, aiDefense: 1 });
    expect(await next()).toBe('invitations');
  });

  it('принятое приглашение → живая защита, а не ожидание', async () => {
    Object.assign(w, { category: true, qualifying: 1, checkedProjects: 1, aiDefense: 1, acceptedInv: 1 });
    expect(await next()).toBe('live_defense');
  });

  it('нанят — важнее всего', async () => {
    Object.assign(w, { sentInv: 1, acceptedInv: 1, hired: true });
    const s = await journeyState('c1');
    expect(s.nextStep).toBe('hired');
    expect(s.hired?.company).toBe('Северный Поток');
  });

  it('демо-кандидат без аккаунта: знакомство пройдено', async () => {
    db.prisma.user!.findUnique = () => null;
    const s = await journeyState('c1');
    expect(s.steps.onboarding).toBe(true);
    expect(s.nextStep).toBe('test');
  });
});
