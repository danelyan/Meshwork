// Нормализация данных от агента: в событиях `claims`/`recommendations` приходит unknown[].
import type { ClaimStatus, EvidenceLevel } from '@/server/claims/types';

import { isLevel } from './labels';

export interface CardClaim {
  /** id сохранённого утверждения — нужен для POST /api/claims/[id]/[action] */
  id: string;
  statement: string;
  quote: string;
  sourceRef: string;
  level: EvidenceLevel;
  limits: string;
  status: ClaimStatus;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function normalizeClaim(raw: unknown): CardClaim | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const statement = str(r.statement);
  if (!id || !statement) return null;
  const status = r.status === 'confirmed' || r.status === 'edited' || r.status === 'rejected' ? r.status : 'proposed';
  return {
    id,
    statement,
    quote: str(r.quote),
    sourceRef: str(r.sourceRef),
    level: isLevel(r.level) ? r.level : 'self_reported',
    limits: str(r.limits),
    status,
  };
}

export interface CardRecommendation {
  key: string;
  kind: 'task' | 'target' | 'test' | 'gap' | 'other';
  title: string;
  meta?: string;
  reason?: string;
  missing?: string[];
  href?: string;
}

export function normalizeRecommendation(raw: unknown, index: number): CardRecommendation | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.taskId === 'string') {
    return {
      key: `task-${r.taskId}`,
      kind: 'task',
      title: str(r.title) || 'Задание',
      meta: [str(r.family), str(r.grade)].filter(Boolean).join(' · ') || undefined,
      reason: str(r.reason) || undefined,
    };
  }
  if (typeof r.vacancyId === 'string') {
    const missing = Array.isArray(r.missing)
      ? r.missing.map((m) => str((m as { statement?: unknown })?.statement)).filter(Boolean)
      : [];
    const covered = typeof r.covered === 'number' && typeof r.total === 'number' ? `закрываешь ${r.covered} из ${r.total}` : '';
    return {
      key: `target-${r.vacancyId}`,
      kind: 'target',
      title: [str(r.title), str(r.companyName)].filter(Boolean).join(' — ') || 'Вакансия',
      meta: covered || undefined,
      reason: str(r.reason) || undefined,
      missing,
    };
  }
  if (typeof r.specialization === 'string' && typeof r.grade === 'string' && 'allowed' in r) {
    return {
      key: `test-${index}`,
      kind: 'test',
      title: `Тест: ${r.specialization === 'backend' ? 'Backend' : r.specialization === 'frontend' ? 'Frontend' : str(r.specialization)}, ${str(r.grade)}`,
      reason: str(r.reason) || undefined,
      meta: r.allowed === false ? 'сейчас недоступен' : undefined,
    };
  }
  if (typeof r.catalogId === 'string' && typeof r.statement === 'string') {
    return {
      key: `gap-${r.catalogId}`,
      kind: 'gap',
      title: r.statement,
      meta: isLevel(r.currentLevel) ? `сейчас: ${r.currentLevel}` : 'пока нет утверждения',
    };
  }
  const title = str(r.title) || str(r.text);
  if (!title) return null;
  return { key: `other-${index}`, kind: 'other', title, reason: str(r.reason) || undefined };
}
