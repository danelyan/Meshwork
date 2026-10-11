// Проверка честности теста для работодателя: только уровень и короткие группы причин, без деталей (время ответа
// по заданию, числа, тексты). Ранжирование не использует. Индекс считает src/server/test/integrity.ts.
import { prisma } from '../db';
import type { Grade, Specialization } from '../types';
import type { PublicIntegrityGroup, PublicTestIntegrity } from './test-integrity-label';

export { integrityLabel } from './test-integrity-label';
export type { PublicIntegrityGroup, PublicTestIntegrity } from './test-integrity-label';

const GROUPS: ReadonlySet<string> = new Set<PublicIntegrityGroup>(['time', 'fit', 'browser']);

interface StoredLike {
  level?: unknown;
  reasons?: unknown;
  confirmedBy?: unknown;
}

/**
 * Проекция сохранённого индекса. Превышение лимита времени (`overtime`) само по себе замечанием не считается: оно
 * не блокирует ответ (решение владельца 11.10) и у честных медленных встречается чаще половины попыток (eval/test/integrity.ts).
 * Нет индекса или мусор — null: «проверка не проводилась», а не «без замечаний».
 */
export function publicIntegrity(raw: unknown, confirmedAgain = false): PublicTestIntegrity | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = raw as StoredLike;
  if (s.level !== 'low' && s.level !== 'medium' && s.level !== 'high') return null;
  const reasons = Array.isArray(s.reasons) ? (s.reasons as { code?: unknown; group?: unknown }[]) : [];
  const noteworthy = reasons.filter((r) => r && r.code !== 'overtime');
  const groups = [...new Set(noteworthy.map((r) => r.group).filter((g): g is PublicIntegrityGroup => typeof g === 'string' && GROUPS.has(g)))];
  const level = noteworthy.length === 0 ? 'low' : s.level;
  return { level, groups, confirmedAgain: confirmedAgain || (level !== 'low' && typeof s.confirmedBy === 'string') };
}

interface CategoryKey {
  specialization: Specialization;
  grade: Grade;
  subcategoryId?: string | null;
}

/**
 * Для каждого кандидата — индекс попытки, давшей его текущую категорию: последняя пройденная попытка с той же
 * специализацией, грейдом и подкатегорией. Подтверждающая попытка (kind = confirm) отдаёт индекс исходной.
 * Категория без попытки (демо, старые данные) — нет записи в результате.
 */
export async function loadTestIntegrity(categories: ReadonlyMap<string, CategoryKey | null>): Promise<Map<string, PublicTestIntegrity>> {
  const ids = [...categories].filter(([, c]) => c !== null).map(([id]) => id);
  const out = new Map<string, PublicTestIntegrity>();
  if (ids.length === 0) return out;
  const attempts = await prisma.testAttempt.findMany({
    where: { candidateId: { in: ids }, status: 'passed' },
    select: { candidateId: true, specialization: true, grade: true, subcategoryId: true, kind: true, confirmsAttemptId: true, integrity: true },
    orderBy: [{ finishedAt: 'desc' }, { id: 'asc' }],
  });
  const picked = new Map<string, (typeof attempts)[number]>();
  for (const a of attempts) {
    const c = categories.get(a.candidateId);
    if (!c || picked.has(a.candidateId)) continue;
    if (a.specialization === c.specialization && a.grade === c.grade && (a.subcategoryId ?? null) === (c.subcategoryId ?? null)) picked.set(a.candidateId, a);
  }
  const sourceIds = [...new Set([...picked.values()].map((a) => a.confirmsAttemptId).filter((x): x is string => Boolean(x)))];
  const sources = sourceIds.length ? await prisma.testAttempt.findMany({ where: { id: { in: sourceIds } }, select: { id: true, integrity: true } }) : [];
  const sourceById = new Map(sources.map((s) => [s.id, s.integrity]));
  for (const [candidateId, a] of picked) {
    const view = a.kind === 'confirm' && a.confirmsAttemptId ? publicIntegrity(sourceById.get(a.confirmsAttemptId), true) : publicIntegrity(a.integrity);
    if (view) out.set(candidateId, view);
  }
  return out;
}
