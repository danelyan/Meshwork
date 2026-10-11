import { beforeEach, describe, expect, it, vi } from 'vitest';

// Два параллельных ответа на одно задание: записывается первый, второй получает 409 и следующее задание не создаёт
// (раньше оба доходили до создания TestItem с одним index — нарушение уникальности [attemptId, index], 500).
const db = vi.hoisted(() => ({
  testAttempt: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  testItem: { update: vi.fn(), updateMany: vi.fn(), create: vi.fn(), findMany: vi.fn() },
  taskTemplate: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/consent/service', async (orig) => ({ ...(await orig<typeof import('@/server/consent/service')>()), assertAiAssessmentConsent: vi.fn() }));

import { GENERATORS, poolFor } from '@/server/test/generators';
import { POLICY_VERSION } from '@/server/test/policy';
import { answerAttempt } from '@/server/test/service';

const NOW = new Date('2026-10-11T12:00:00Z');
const generator = poolFor('backend', 'backend.web-api', { common: true })!.generators[0]!;

const attempt = () => ({
  id: 'att1',
  candidateId: 'c1',
  specialization: 'backend',
  subcategoryId: 'backend.web-api',
  grade: 'middle',
  status: 'active',
  mode: 'full',
  seed: 7,
  theta: null,
  se: null,
  pPass: null,
  pJunior: null,
  juniorOffered: false,
  juniorConfirmedAt: null,
  policyVersion: POLICY_VERSION,
  startedAt: new Date(NOW.getTime() - 60_000),
  expiresAt: new Date(NOW.getTime() + 3_600_000),
  finishedAt: null,
  signals: null,
  integrity: null,
  kind: 'grade',
  confirmsAttemptId: null,
  items: [
    {
      id: 'item0',
      attemptId: 'att1',
      index: 0,
      templateId: generator.id,
      instanceSeed: 1,
      params: {},
      prompt: 'Сколько строк вернёт запрос?',
      code: null,
      answerHint: 'число',
      answerKey: '42',
      explanation: '',
      answer: null,
      correct: null,
      thetaAfter: null,
      seAfter: null,
      askedAt: new Date(NOW.getTime() - 30_000),
      answeredAt: null,
      canaryShift: null,
      timeLimitSec: 120,
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  db.testAttempt.findFirst.mockImplementation(async () => attempt());
  db.testItem.findMany.mockResolvedValue([]);
  // Параметры шаблонов — как в БД после ensureTemplates: по одному ряду на генератор кода.
  db.taskTemplate.findMany.mockImplementation(async (args?: { where?: { id?: { in?: string[] } } }) =>
    GENERATORS.filter((g) => !args?.where?.id?.in || args.where.id.in.includes(g.id)).map((g) => ({ id: g.id, specialization: g.specialization, grade: g.grade, catalogIds: g.catalogIds, irtA: g.a, irtB: g.b, exposure: 0 })),
  );
});

describe('answerAttempt: параллельный ответ на одно задание', () => {
  it('задание уже отвечено другим запросом (обновлено 0 строк) — 409, следующее задание не создаётся', async () => {
    db.testItem.updateMany.mockResolvedValue({ count: 0 });
    await expect(answerAttempt('c1', 'att1', '42', NOW)).rejects.toMatchObject({ status: 409, code: 'conflict' });
    // Запись ответа условная: только пока задание открыто.
    expect(db.testItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'item0', correct: null } }));
    expect(db.testItem.update).not.toHaveBeenCalled();
    expect(db.testItem.create).not.toHaveBeenCalled();
  });
});
