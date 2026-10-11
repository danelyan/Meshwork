import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  prisma: {} as Record<string, Record<string, (a?: { where?: Record<string, unknown> }) => unknown>>,
}));
vi.mock('@/server/db', () => ({ prisma: db.prisma }));

import { journeyState, JOURNEY_STEPS, LAST_CALL_MAX_PAIRS, lastCallBlock, lastCallBrief, stepHint, STEP_HINT } from '@/server/agent/journey';
import { consentVersion } from '@/server/consent/texts';

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
  consents: { kind: string; version: string; acceptedAt: Date; revokedAt: Date | null }[];
  hiddenFlag: boolean;
  lastCall: Record<string, unknown> | null;
}
const fresh = (): World => ({ onboarded: true, sources: 0, claims: {}, category: false, qualifying: 0, checkedProjects: 0, aiDefense: 0, sentInv: 0, acceptedInv: 0, hired: false, lastCall: null, consents: (['ai_assessment', 'employer_visibility'] as const).map((kind) => ({ kind, version: consentVersion(kind), acceptedAt: new Date(0), revokedAt: null })), hiddenFlag: false });
let w: World;
const seen: { call: unknown[]; project: unknown[] } = { call: [], project: [] };

beforeEach(() => {
  w = fresh();
  seen.call = [];
  seen.project = [];
  Object.assign(db.prisma, {
    user: { findUnique: () => ({ onboardedAt: w.onboarded ? new Date() : null, consents: w.consents }) },
    candidate: { findUnique: () => ({ hiddenFromEmployers: w.hiddenFlag }) },
    source: { count: () => w.sources },
    upload: { count: () => 0 },
    claim: { groupBy: () => Object.entries(w.claims).map(([status, n]) => ({ status, _count: { _all: n } })) },
    candidateCategory: { findFirst: () => (w.category ? { id: 'c' } : null) },
    callSession: {
      count: (a?: { where?: Record<string, unknown> }) => {
        seen.call.push(a?.where);
        return a?.where?.kind !== 'defense' ? w.qualifying : w.aiDefense;
      },
      findFirst: () => w.lastCall,
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

  it('ИИ-защита: без таких сессий шаг не пройден, подсказка ведёт к кнопке; запрос – сессии с признаком aiDefense', async () => {
    Object.assign(w, { category: true, qualifying: 1, checkedProjects: 1, aiDefense: 0 });
    const s = await journeyState('c1');
    expect(s.nextStep).toBe('ai_defense');
    expect(s.steps.ai_defense).toBe(false);
    expect(stepHint(s)).toMatch(/Защитить проект с ИИ/);
    expect(stepHint(s)).not.toMatch(/скоро/i);
    expect(seen.call[1]).toMatchObject({ kind: 'defense', aiDefense: true, status: 'finished' });
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

  it('принятое приглашение без проверенного проекта → проект: без него компания не назначит защиту', async () => {
    Object.assign(w, { category: true, qualifying: 1, checkedProjects: 0, acceptedInv: 1 });
    const s = await journeyState('c1');
    expect(s.nextStep).toBe('project');
    expect(stepHint(s)).toMatch(/приглашение принято, но без сданного проекта компания не назначит защиту/i);
    w.acceptedInv = 0;
    expect(stepHint(await journeyState('c1'))).toBe(STEP_HINT.project);
  });

  it('нанят – важнее всего', async () => {
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

describe('journeyState: согласие на оценку ИИ и скрытость профиля', () => {
  const at = new Date('2026-10-10T10:00:00Z');
  const row = (kind: 'ai_assessment' | 'employer_visibility', over: Partial<{ version: string; revokedAt: Date | null }> = {}) => ({ kind, version: consentVersion(kind), acceptedAt: at, revokedAt: null, ...over });
  it('нет согласий: aiConsent false, профиль скрыт', async () => {
    w.consents = [];
    const s = await journeyState('c1');
    expect(s.aiConsent).toBe(false);
    expect(s.hidden).toBe(true);
  });
  it('действующие согласия: aiConsent true, профиль виден; флаг hiddenFromEmployers скрывает', async () => {
    w.consents = [row('ai_assessment'), row('employer_visibility')];
    let s = await journeyState('c1');
    expect([s.aiConsent, s.hidden]).toEqual([true, false]);
    w.hiddenFlag = true;
    s = await journeyState('c1');
    expect(s.hidden).toBe(true);
  });
  it('отозванное или устаревшее согласие не действует', async () => {
    w.consents = [row('ai_assessment', { revokedAt: new Date() }), row('employer_visibility', { version: 'old' })];
    const s = await journeyState('c1');
    expect([s.aiConsent, s.hidden]).toEqual([false, true]);
  });
});


describe('lastCallBrief / lastCallBlock: консультант знает о последнем созвоне', () => {
  const ai = (index: number, text: string) => ({ index, role: 'ai', text, at: 'x', tMs: 0 });
  const me = (index: number, text: string) => ({ index, role: 'candidate', text, at: 'x', tMs: 0 });
  const finishedAt = new Date('2026-10-12T00:40:00Z');
  const verdict = {
    kind: 'qualifying',
    summary: 'Подтверждено тем: 1 из 2.',
    depthMap: [
      { topic: 'Индексы', status: 'confirmed', probed: 2, maxLevel: 3 },
      { topic: 'Кэш', status: 'not_confirmed', probed: 1, maxLevel: 1 },
    ],
    testOwnership: { status: 'explained', reason: 'r', items: [] },
  };

  it('нет завершённых созвонов → null, journeyState.lastCall = null', async () => {
    expect(await lastCallBrief('c1')).toBeNull();
    expect((await journeyState('c1')).lastCall).toBeNull();
  });

  it('сводка: вид, минуты, итог, темы, разбор теста, диалог парами с обрезкой', async () => {
    const long = 'о'.repeat(400);
    w.lastCall = {
      kind: 'qualifying',
      finishedAt,
      transcriptJson: [ai(0, 'Привет! Что такое индекс?'), me(1, 'B-дерево'), ai(2, 'Почему?'), me(3, long), ai(4, 'Спасибо, на этом всё.')],
      verdictJson: verdict,
    };
    const b = (await lastCallBrief('c1', new Date('2026-10-12T00:52:00Z')))!;
    expect(b).toMatchObject({ kind: 'qualifying', minutesAgo: 12, summary: 'Подтверждено тем: 1 из 2.', testOwnership: 'объяснил сам', interview: null });
    expect(b.topics).toEqual(['Индексы — подтверждено (вопросов 2, до уровня 3)', 'Кэш — не подтверждено (вопросов 1, до уровня 1)']);
    expect(b.dialog).toHaveLength(2); // заключительная реплика без ответа - не пара
    expect(b.dialog[0]).toEqual({ q: 'Привет! Что такое индекс?', a: 'B-дерево' });
    expect(b.dialog[1]!.a.length).toBe(240);
    expect(b.dialog[1]!.a.endsWith('…')).toBe(true);
    expect((await journeyState('c1')).lastCall?.kind).toBe('qualifying');
  });

  it('не больше LAST_CALL_MAX_PAIRS пар; без вердикта - «вердикта нет»', async () => {
    const t: unknown[] = [];
    for (let i = 0; i < 24; i += 2) t.push(ai(i, `Вопрос ${i}`), me(i + 1, `Ответ ${i}`));
    w.lastCall = { kind: 'interview', finishedAt, transcriptJson: t, verdictJson: null };
    const b = (await lastCallBrief('c1'))!;
    expect(b.dialog).toHaveLength(LAST_CALL_MAX_PAIRS);
    expect(b.summary).toBeNull();
    expect(lastCallBlock(b)).toContain('вердикта нет');
  });

  it('блок: свежий созвон (≤ 30 мин) просит начать с итога, старый - нет; теги и диалог на месте', async () => {
    w.lastCall = { kind: 'qualifying', finishedAt, transcriptJson: [ai(0, 'Q'), me(1, 'A')], verdictJson: verdict };
    const fresh = lastCallBlock((await lastCallBrief('c1', new Date('2026-10-12T00:45:00Z')))!);
    expect(fresh).toContain('## Последний созвон с ИИ');
    expect(fresh).toContain('<last_call>');
    expect(fresh).toContain('Вид: квалифицирующий созвон');
    expect(fresh).toContain('5 мин назад');
    expect(fresh).toContain('завершился только что');
    expect(fresh).toContain('1. Кира: Q → Кандидат: A');
    expect(fresh).toContain('Разбор задания теста: объяснил сам');
    const old = lastCallBlock((await lastCallBrief('c1', new Date('2026-10-12T03:00:00Z')))!);
    expect(old).not.toContain('завершился только что');
    expect(old).toContain('140 мин назад');
  });
});
