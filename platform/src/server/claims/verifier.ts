import type { ExtractedDoc } from '../collector/types';
import { levelRank, maxLevelFor } from './levels';
import { normalizeQuote, wordCount } from './normalize';
import { docHasRef, findQuote, indexDoc, type IndexedDoc, type QuoteMatch } from './source-text';
import { wordingFor } from './wording';
import type { CatalogEntry, Confidence, ProposedClaim, RejectReason, VerifiedClaim, VerifyResult } from './types';

/** Цитата короче — не доказательство умения («Kafka», «SQL»), а слово-технология (каталог § 1 п. 1). */
export const MIN_QUOTE_WORDS = 2;

const CONF_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export interface VerifyOptions {
  /** Владение аккаунтом подтверждено (codeforces/fsp → third_party). По умолчанию — нет. */
  ownershipVerified?: (doc: ExtractedDoc) => boolean;
}

/**
 * Программная проверка черновика утверждений (research/10 § 4.5):
 *  1. ID есть в каталоге — иначе `unknown_catalog_id`;
 *  2. нормализованная цитата — подстрока нормализованного источника, иначе `no_quote`;
 *     короче MIN_QUOTE_WORDS слов — `quote_too_short`;
 *     найдена только в строках, помеченных скрытыми, — `hidden_text`;
 *  3. один catalogId — одно утверждение (лучшее по уверенности, затем по уровню), остальные `duplicate`.
 * Формулировку для кандидата (`wording`) берёт от модели, только если она в границах цитаты (`wordingFor`),
 * иначе строит из самой цитаты. Каталожную формулировку, ограничения и пути доказательства берёт из каталога, уровень — из типа источника
 * (`maxLevelFor`), цитату и ссылку — из найденного фрагмента источника. От LLM остаются только
 * выбор ID, место цитаты и уверенность.
 */
export function verifyClaims(
  p: ProposedClaim[],
  docs: ExtractedDoc[],
  catalog: CatalogEntry[],
  opts?: VerifyOptions,
): VerifyResult {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const indexed: IndexedDoc[] = docs.map(indexDoc);
  const rejected: VerifyResult['rejected'] = [];
  const candidates: VerifiedClaim[] = [];
  const reject = (claim: ProposedClaim, reason: RejectReason) => rejected.push({ claim, reason });

  for (const claim of p) {
    const entry = typeof claim?.catalogId === 'string' ? byId.get(claim.catalogId) : undefined;
    if (!entry) {
      reject(claim, 'unknown_catalog_id');
      continue;
    }
    const q = normalizeQuote(typeof claim.quote === 'string' ? claim.quote : '');
    if (!q) {
      reject(claim, 'no_quote');
      continue;
    }
    if (wordCount(q) < MIN_QUOTE_WORDS) {
      reject(claim, 'quote_too_short');
      continue;
    }
    // сначала документ, на который сослалась модель, затем остальные
    const ref = typeof claim.sourceRef === 'string' ? claim.sourceRef : '';
    const order = [...indexed].sort((a, b) => Number(docHasRef(b, ref)) - Number(docHasRef(a, ref)));
    let visible: { idx: IndexedDoc; m: QuoteMatch } | undefined;
    let hiddenOnly = false;
    for (const idx of order) {
      const matches = findQuote(idx, q);
      const v = matches.find((m) => !m.hidden);
      if (v) {
        visible = { idx, m: v };
        break;
      }
      if (matches.length > 0) hiddenOnly = true;
    }
    if (!visible) {
      reject(claim, hiddenOnly ? 'hidden_text' : 'no_quote');
      continue;
    }
    const { idx, m } = visible;
    const confidence: Confidence = claim.confidence in CONF_RANK ? claim.confidence : 'low';
    candidates.push({
      catalogId: entry.id,
      statement: entry.statement,
      wording: wordingFor(typeof claim.wording === 'string' ? claim.wording : undefined, m.quote),
      quote: m.quote,
      sourceRef: m.sourceRef,
      confidence,
      level: maxLevelFor(idx.doc.sourceKind, { ownershipVerified: opts?.ownershipVerified?.(idx.doc) ?? false }),
      limits: entry.limits,
      suggestedProof: [...entry.proof],
      sourceKind: idx.doc.sourceKind,
    });
  }

  const best = new Map<string, VerifiedClaim>();
  const better = (a: VerifiedClaim, b: VerifiedClaim) =>
    CONF_RANK[a.confidence] - CONF_RANK[b.confidence] ||
    levelRank(a.level) - levelRank(b.level) ||
    a.quote.length - b.quote.length;
  for (const c of candidates) {
    const cur = best.get(c.catalogId);
    if (!cur) best.set(c.catalogId, c);
    else if (better(c, cur) > 0) {
      reject(cur, 'duplicate');
      best.set(c.catalogId, c);
    } else reject(c, 'duplicate');
  }
  return { accepted: [...best.values()], rejected };
}
