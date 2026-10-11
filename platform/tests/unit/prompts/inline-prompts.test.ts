// Аудит промптов, лейн inline-prompts: инструкции модели, зашитые в TS (не в .md). Инварианты без сети:
// описание не обещает того, чего инструмент не делает; тексты не противоречат коду (call/readiness.ts);
// Кира говорит о себе в женском роде и в запасных ответах.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  kind: 'interview' as 'interview' | 'qualifying',
  ready: { ready: true } as { ready: boolean; reason?: string },
}));
vi.mock('@/server/interview/context', () => ({ resolveCallKind: async () => h.kind }));
vi.mock('@/server/call/consent', () => ({ hasCallConsent: async () => true }));
vi.mock('@/server/call/readiness', () => ({ callReadiness: async () => h.ready }));

import * as db from '@/server/db';
import { pipelineParts } from '@/server/agent/fallback';
import { CALL_NO_SOURCES_HINT, STEP_HINT } from '@/server/agent/journey';
import { buildSystem, KICKOFF_INSTRUCTION } from '@/server/agent/loop';
import { proposeClaimsTool } from '@/server/agent/tools/propose_claims';
import { recommendTasksTool } from '@/server/agent/tools/recommend';
import { startVerification } from '@/server/agent/tools/start_verification';
import { suggestCall } from '@/server/agent/tools/suggest_call';
import { waysUp, whyLevel } from '@/server/agent/tools/explain_evidence';
import type { PipelineResult } from '@/server/agent/pipeline';
import type { AgentEvent, ToolContext } from '@/server/agent/types';
import { rubricSystem } from '@/server/project/review';

const MASC = /(^|[^а-яё])(прочитал|нашёл|отбросил|объединил)([^а-яё]|$)/iu;

describe('kickoff: не выдумывает имя и не утверждает непроверенное', () => {
  it('имя — только если оно есть в <journey>', () => {
    expect(KICKOFF_INSTRUCTION).toMatch(/только если в <journey> есть строка «Кандидат:»/);
    expect(KICKOFF_INSTRUCTION).toMatch(/имя не придумывай/);
  });
  it('«база профиля сохранена» — только при пройденном знакомстве', () => {
    expect(KICKOFF_INSTRUCTION).toMatch(/Если знакомство в <journey> отмечено ✓/);
    expect(KICKOFF_INSTRUCTION).not.toMatch(/только что закончил/);
  });
});

describe('созвон после теста: подсказки совпадают с call/readiness.ts', () => {
  it('без утверждений созвон не объявляется закрытым', () => {
    expect(CALL_NO_SOURCES_HINT).not.toMatch(/открывается, только когда/);
    expect(CALL_NO_SOURCES_HINT).toMatch(/созвон с ИИ уже доступен/);
    expect(CALL_NO_SOURCES_HINT).toMatch(/suggest_call/);
  });
  it('шаг call после теста — ИИнтервью, а не «карта глубины по резюме»', () => {
    expect(STEP_HINT.call).toMatch(/ИИнтервью/);
  });
});

describe('suggest_call: не показывает кнопку, которая ответит 409', () => {
  const events: AgentEvent[] = [];
  const ctx = { candidateId: 'c1', conversationId: 'v1', emit: (e: AgentEvent) => events.push(e) } as unknown as ToolContext;
  beforeEach(() => {
    events.length = 0;
    Object.assign(db.prisma, { callSession: { findFirst: async () => null } });
  });
  it('готов → offered, событие call_offer', async () => {
    h.ready = { ready: true };
    const r = await suggestCall.handler(ctx, { reason: 'проверим глубину' });
    expect(r.offered).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['call_offer']);
  });
  it('пауза или нет темы → offered=false, без кнопки, причина в note', async () => {
    h.ready = { ready: false, reason: 'Повторный созвон - через 5 ч' };
    const r = await suggestCall.handler(ctx, { reason: 'проверим глубину' });
    expect(r.offered).toBe(false);
    expect(events).toEqual([]);
    expect(r.note).toContain('Повторный созвон - через 5 ч');
    expect(suggestCall.description).toMatch(/offered=false/);
  });
});

describe('задания банка: описания не обещают ссылку и проверку, которых нет', () => {
  it('recommend_tasks: в выходе нет ссылки — и описание её не обещает', () => {
    expect(recommendTasksTool.description).not.toMatch(/с темой и ссылкой/);
    expect(recommendTasksTool.description).toMatch(/Ссылки на задание в ответе нет/);
  });
  it('platform-уровень не объясняется «заданием из банка»', () => {
    expect(whyLevel('platform', 'resume')).not.toMatch(/задание из банка/);
    expect(whyLevel('platform', 'resume')).toMatch(/тест на грейд, созвон с ИИ или защита утверждения/);
  });
  it('путь task честно говорит, что решение не проверяется', () => {
    const task = waysUp('self_reported', ['task:x', 'interview:defend']).find((w) => w.kind === 'task');
    expect(task?.how).toMatch(/не принимает и не проверяет/);
    expect(startVerification.description).toMatch(/решение платформа пока не проверяет/);
  });
});

describe('рубрика проекта: сдача подходом не судится «по коду»', () => {
  it('режим подхода — без правила «без доказательства в коде»', () => {
    expect(rubricSystem(true)).not.toMatch(/Без доказательства в коде/);
    expect(rubricSystem(true)).toMatch(/ПОДХОД\.md/);
    expect(rubricSystem(true)).toMatch(/данные/);
  });
  it('режим кода прежний', () => {
    expect(rubricSystem(false)).toMatch(/Без доказательства в коде — passed: false/);
  });
});

describe('Кира — в женском роде в TS-текстах', () => {
  const p: PipelineResult = {
    docs: [{ label: 'резюме cv.pdf', origin: 'cv.pdf', sourceKind: 'resume', lines: 3 }],
    failed: [],
    proposed: [{ id: '1', catalogId: 'be.x', statement: 's', level: 'self_reported', sourceRef: 'r' }],
    rejected: 1,
    merged: 1,
    alreadyKnown: 0,
    rejectSummary: '1 без цитаты в источнике',
    hiddenText: 0,
    injectionSuspect: false,
    degraded: true,
  } as unknown as PipelineResult;
  it('запасной ответ после конвейера', () => {
    const text = pipelineParts(p).join(' ');
    expect(text).not.toMatch(MASC);
    expect(text).toMatch(/Прочитала/);
    expect(pipelineParts({ ...p, proposed: [], merged: 0, rejected: 0 }).join(' ')).toMatch(/не нашла/);
  });
  it('инструкция хода конвейера и описание propose_claims', () => {
    const sys = buildSystem({ now: new Date('2026-10-12T10:00:00Z'), toolsExhausted: false, pipeline: p });
    expect(sys).toMatch(/что прочитала и нашла/);
    expect(sys).toMatch(/тест через recommend_test - только если категории ещё нет/);
    expect(proposeClaimsTool.description).not.toMatch(MASC);
  });
});
