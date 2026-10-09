import { countOf, FORMS } from '@/lib/plural';
import { z } from 'zod';

import { getCatalog, proposeClaims, verifyClaims } from '@/server/claims';
import type { ProposedClaim } from '@/server/claims/types';
import { loadCandidateDocs } from '../docs';
import type { AgentTool } from '../types';

const Item = z.object({
  catalogId: z.string().min(1).max(64).describe('id из каталога (catalog_search)'),
  statement: z.string().min(1).max(300).optional().describe('Формулировка; по умолчанию — из каталога'),
  quote: z.string().min(3).max(600).describe('Дословная цитата из источника, подтверждающая утверждение'),
  sourceRef: z.string().min(1).max(200).describe('Координата строки с цитатой: `cv.pdf#p2:l14`, `github:user/repo#README:l3`'),
  confidence: z.enum(['low', 'medium', 'high']).default('medium'),
});
const Input = z.object({ items: z.array(Item).min(1).max(30) });
const Output = z.object({
  proposed: z.array(z.object({ id: z.string(), catalogId: z.string(), statement: z.string(), level: z.string(), quote: z.string(), sourceRef: z.string() })),
  rejected: z.array(z.object({ catalogId: z.string(), reason: z.enum(['no_quote', 'unknown_catalog_id', 'duplicate', 'hidden_text', 'quote_too_short']) })),
  note: z.string(),
});

/**
 * Черновик карточек в UI (не в профиль). Уровень и ограничения ставит код
 * (verifyClaims); в профиль карточку переводит только кандидат кнопкой.
 */
export const proposeClaimsTool: AgentTool<z.infer<typeof Input>, z.infer<typeof Output>> = {
  name: 'propose_claims',
  description:
    'Предложить кандидату утверждения карточками. Каждое — id из каталога + дословная цитата из прочитанного источника + координата строки. Вызывай после read_upload / fetch_url / fetch_profile, когда нашёл фразы о сделанной работе. Не вызывай для источников, которые уже разобрал конвейер хода, и для отклонённых кандидатом id. Без цитаты в источнике утверждение отбрасывается кодом. Уровень доказанности задаёт код, не ты. В профиль попадает только после «да» кандидата.',
  input: Input,
  output: Output,
  async handler(ctx, { items }) {
    const [catalog, docs] = await Promise.all([getCatalog(), loadCandidateDocs(ctx.candidateId)]);
    const byId = new Map(catalog.map((e) => [e.id, e]));
    const proposals: ProposedClaim[] = items.map((i) => ({
      catalogId: i.catalogId,
      statement: i.statement ?? byId.get(i.catalogId)?.statement ?? i.catalogId,
      quote: i.quote,
      sourceRef: i.sourceRef,
      confidence: i.confidence,
    }));
    ctx.emit({ type: 'step', text: `проверяю ${proposals.length} утверждений по источникам…` });
    const { accepted, rejected } = verifyClaims(proposals, docs, catalog);
    const created = accepted.length ? await proposeClaims(ctx.candidateId, accepted) : [];
    const proposed = created.map((c) => ({
      id: c.id,
      catalogId: c.catalogId,
      statement: c.statement,
      level: c.level,
      quote: c.quote,
      sourceRef: c.sourceRef,
    }));
    ctx.emit({ type: 'claims', proposed, rejected: rejected.length, rejectedByReason: countByReason(rejected.map((r) => r.reason)) });
    ctx.emit({
      type: 'step',
      text: claimsStepText(proposed.length, rejected.map((r) => r.reason)),
    });
    return {
      proposed,
      rejected: rejected.map((r) => ({ catalogId: r.claim.catalogId, reason: r.reason })),
      note: 'Карточки показаны кандидату; в профиль попадут только подтверждённые им.',
    };
  },
};

/** Подсчёт отказов по причинам (только ненулевые). */
export function countByReason(reasons: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of reasons) out[r] = (out[r] ?? 0) + 1;
  return out;
}

/** Причины отказа без дублей: дубль — не отказ, а слияние одинаковых утверждений. */
export function describeRejects(reasons: string[]): string {
  const c = countByReason(reasons);
  const parts: string[] = [];
  if (c.no_quote) parts.push(`${c.no_quote} без цитаты в источнике`);
  if (c.unknown_catalog_id) parts.push(`${c.unknown_catalog_id} вне каталога`);
  if (c.hidden_text) parts.push(`${c.hidden_text} из скрытого текста`);
  if (c.quote_too_short) parts.push(`${c.quote_too_short} со слишком короткой цитатой`);
  return parts.join(', ');
}

/** Шаг ленты и сводка: «нашёл 2, отбросил 1 — …, объединил 3 повтора». */
export function claimsStepText(found: number, reasons: string[]): string {
  const c = countByReason(reasons);
  const merged = c.duplicate ?? 0;
  const rejected = reasons.length - merged;
  const head = `нашёл ${found}`;
  const tail: string[] = [];
  if (rejected) tail.push(`отбросил ${rejected} - ${describeRejects(reasons)}`);
  if (merged) tail.push(`объединил ${countOf(merged, FORMS.repeat)} одинаковых утверждений`);
  return [head, ...tail].join(', ');
}
