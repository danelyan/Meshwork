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
  rejected: z.array(z.object({ catalogId: z.string(), reason: z.enum(['no_quote', 'unknown_catalog_id', 'duplicate']) })),
  note: z.string(),
});

/**
 * Черновик карточек в UI (не в профиль). Уровень и ограничения ставит код
 * (verifyClaims); в профиль карточку переводит только кандидат кнопкой.
 */
export const proposeClaimsTool: AgentTool<z.infer<typeof Input>, z.infer<typeof Output>> = {
  name: 'propose_claims',
  description:
    'Предложить кандидату утверждения карточками. Каждое — id из каталога + дословная цитата из прочитанного источника + координата. Без цитаты в источнике утверждение отбрасывается кодом. Уровень доказанности задаёт код, не ты. В профиль попадает только после «да» кандидата.',
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
    ctx.emit({ type: 'claims', proposed, rejected: rejected.length });
    ctx.emit({
      type: 'step',
      text: `предложил ${proposed.length}, отбросил ${rejected.length}${rejected.length ? ` — ${describeRejects(rejected.map((r) => r.reason))}` : ''}`,
    });
    return {
      proposed,
      rejected: rejected.map((r) => ({ catalogId: r.claim.catalogId, reason: r.reason })),
      note: 'Карточки показаны кандидату; в профиль попадут только подтверждённые им.',
    };
  },
};

export function describeRejects(reasons: string[]): string {
  const n = (r: string) => reasons.filter((x) => x === r).length;
  const parts: string[] = [];
  if (n('no_quote')) parts.push(`${n('no_quote')} без цитаты в источнике`);
  if (n('unknown_catalog_id')) parts.push(`${n('unknown_catalog_id')} вне каталога`);
  if (n('duplicate')) parts.push(`${n('duplicate')} дублей`);
  return parts.join(', ');
}
