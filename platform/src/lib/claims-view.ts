// Нормализация данных от агента: в событиях `claims`/`recommendations` приходит unknown[].
import { specLabel } from '@/lib/directions';
import type { ClaimStatus, EvidenceLevel } from '@/server/claims/types';

import { isLevel } from './labels';

export interface CardClaim {
  /** id сохранённого утверждения — нужен для POST /api/claims/[id]/[action] */
  id: string;
  /** Каталожная формулировка — что проверим на созвоне. */
  statement: string;
  /** Формулировка под цитату для кандидата; пусто — старая запись, показывается statement. */
  wording?: string;
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
    wording: str(r.wording),
    quote: str(r.quote),
    sourceRef: str(r.sourceRef),
    level: isLevel(r.level) ? r.level : 'self_reported',
    limits: str(r.limits),
    status,
  };
}

/** Что показать кандидату крупно: формулировку под цитату, а у старых записей — каталожную. */
export function shownWording(c: { statement: string; wording?: string | null }): string {
  return c.wording?.trim() || c.statement;
}

export interface CardRecommendation {
  key: string;
  kind: 'task' | 'target' | 'test' | 'gap' | 'other';
  title: string;
  meta?: string;
  reason?: string;
  missing?: string[];
  /** Подпись над списком `missing` (видимая). */
  missingLabel?: string;
  href?: string;
  /** Текст действия по `href`. */
  cta?: string;
}

const GRADE_LABEL: Record<string, string> = { junior: 'Junior', middle: 'Middle', senior: 'Senior' };
const gradeLabel = (g: string) => GRADE_LABEL[g.toLowerCase()] ?? g;
/** Хвост причины рекомендации теста (server/recommend/test.ts) — отдельным списком, а не одной строкой. */
const LACK_RE = /\s*Для Middle не хватает заявленных:\s*(.+?)\.?\s*$/u;

export function normalizeRecommendation(raw: unknown, index: number): CardRecommendation | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.taskId === 'string') {
    return {
      key: `task-${r.taskId}`,
      kind: 'task',
      title: str(r.title) || 'Задание',
      meta: [str(r.family), r.grade ? gradeLabel(str(r.grade)) : ''].filter(Boolean).join(' · ') || undefined,
      reason: str(r.reason) || undefined,
      // Задание банка — тема для практики: своей страницы у него нет (/projects/:id — задания компаний), ссылки не даём.
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
      title: [str(r.title), str(r.companyName)].filter(Boolean).join(' - ') || 'Вакансия',
      meta: covered || undefined,
      reason: str(r.reason) || undefined,
      missing,
      missingLabel: missing.length ? 'Не хватает' : undefined,
      href: '/career',
      cta: 'К вакансиям',
    };
  }
  if (typeof r.specialization === 'string' && typeof r.grade === 'string' && 'allowed' in r) {
    const full = str(r.reason);
    const lack = full.match(LACK_RE);
    const allowed = r.allowed !== false;
    return {
      key: `test-${index}`,
      kind: 'test',
      title: `Тест: ${specLabel(str(r.specialization))} · ${gradeLabel(str(r.grade))}`,
      reason: (lack ? full.slice(0, lack.index) : full).trim() || undefined,
      meta: allowed ? undefined : 'сейчас недоступен',
      missing: lack ? lack[1]!.split(/;\s*/u).filter(Boolean) : undefined,
      missingLabel: lack ? 'Для Middle не хватает заявленных' : undefined,
      ...(allowed
        ? { href: `/test?${new URLSearchParams({ specialization: str(r.specialization), grade: str(r.grade).toLowerCase() })}`, cta: 'Начать тест' }
        : {}),
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
