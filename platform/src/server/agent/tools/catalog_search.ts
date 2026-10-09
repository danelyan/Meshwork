import { z } from 'zod';

import { getCatalog } from '@/server/claims';
import type { CatalogEntry } from '@/server/claims/types';
import type { AgentTool } from '../types';

const Input = z.object({
  query: z.string().min(2).max(300).describe('Что умеет кандидат, своими словами или фразой из источника'),
  specialization: z.enum(['backend', 'frontend']).optional().describe('Сузить до специализации (common ищется всегда)'),
  limit: z.number().int().min(1).max(20).default(8),
});
const Output = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      statement: z.string(),
      specialization: z.enum(['backend', 'frontend', 'common']),
      grades: z.array(z.enum(['junior', 'middle'])),
      weight: z.number(),
      proof: z.array(z.string()),
      limits: z.string(),
    }),
  ),
});

const tokenize = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^a-zа-я0-9+#.]+/i)
    .filter((w) => w.length >= 3);

/** Простая лексическая близость: маркеры каталога весят больше формулировки. Детерминированно. */
export function scoreEntry(entry: CatalogEntry, query: string): number {
  const q = new Set(tokenize(query));
  if (!q.size) return 0;
  let score = 0;
  for (const m of entry.markers) {
    const mt = tokenize(m);
    if (mt.length && mt.every((t) => q.has(t))) score += 3;
    else for (const t of mt) if (q.has(t)) score += 1;
  }
  for (const t of tokenize(entry.statement)) if (q.has(t)) score += 1;
  if (q.has(entry.id.toLowerCase())) score += 5;
  return score;
}

export const catalogSearch: AgentTool<z.infer<typeof Input>, z.infer<typeof Output>> = {
  name: 'catalog_search',
  description:
    'Найти в закрытом каталоге утверждения, подходящие под фразу кандидата. Вызывай перед propose_claims, если не уверен в id, и на вопрос «есть ли у вас утверждение про …». Не нужен, если конвейер хода уже предложил карточки. Утверждения предлагаются только с id из каталога.',
  input: Input,
  output: Output,
  async handler(_ctx, { query, specialization, limit }) {
    const catalog = await getCatalog();
    const items = catalog
      .filter((e) => !specialization || e.specialization === specialization || e.specialization === 'common')
      .map((e) => ({ e, s: scoreEntry(e, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.e.id.localeCompare(b.e.id))
      .slice(0, limit)
      .map(({ e }) => ({
        id: e.id,
        statement: e.statement,
        specialization: e.specialization,
        grades: e.grades,
        weight: e.weight,
        proof: e.proof,
        limits: e.limits,
      }));
    return { items };
  },
};
