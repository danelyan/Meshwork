import { countOf, FORMS } from '@/lib/plural';
import { extractByMarkers, extractClaims, getCatalog, proposeClaims, verifyClaims } from '@/server/claims';
import type { CatalogEntry, ProposedClaim, RejectReason } from '@/server/claims/types';
import { prisma } from '@/server/db';
import { fetchProfile, fetchUrl, maskContacts } from '@/server/collector';
import type { ExtractedDoc } from '@/server/collector/types';
import { LlmError } from '@/server/llm/types';
import { assertBudget, BudgetExceededError } from './budget';
import { loadUpload, saveSource } from './docs';
import { escapeExternal } from './external';
import { claimsStepText, countByReason, describeRejects } from './tools/propose_claims';
import { shortUrl } from './tools/fetch_url';
import type { ToolContext, TurnInput } from './types';

/**
 * Первый ход с вложениями — детерминированный конвейер в коде (research/10
 * § 4.1: предсказуемое — конвейером): сборщик → извлекатель (LLM, JSON) →
 * проверяющий (код) → карточки. Модель получает только сводку результата и
 * пишет короткий ответ; повторно читать источники ей не нужно.
 */
export interface PipelineResult {
  docs: { label: string; origin: string; sourceKind: string; lines: number }[];
  failed: string[];
  proposed: { id: string; catalogId: string; statement: string; level: string; sourceRef: string }[];
  /** Настоящие отказы (без дублей). */
  rejected: number;
  /** Объединено повторов (дубли — не отказ). */
  merged: number;
  /** Найдено, но отсечено как уже лежащее в профиле (не отказ и не дубль внутри запуска). */
  alreadyKnown: number;
  rejectSummary: string;
  hiddenText: number;
  injectionSuspect: boolean;
  /** Извлечение шло без модели (план В). */
  degraded: boolean;
  degradedReason?: 'llm_unavailable' | 'budget_exceeded' | 'timeout';
}

export interface PipelineDeps {
  budget: number;
  now: () => Date;
}

const GITHUB_RE = /^https?:\/\/(www\.)?github\.com\/([A-Za-z0-9_.-]+)\/?$/i;
const CODEFORCES_RE = /^https?:\/\/(www\.)?codeforces\.com\/profile\/([A-Za-z0-9_.-]+)\/?$/i;

function classifyUrl(url: string): { kind: 'github' | 'codeforces'; handle: string } | null {
  const gh = GITHUB_RE.exec(url);
  if (gh?.[2]) return { kind: 'github', handle: gh[2] };
  const cf = CODEFORCES_RE.exec(url);
  if (cf?.[2]) return { kind: 'codeforces', handle: cf[2] };
  return null;
}

function maskDoc(doc: ExtractedDoc): ExtractedDoc {
  try {
    return {
      ...doc,
      text: maskContacts(doc.text).text,
      // `...l` — сохранить флаг hidden: скрытые строки извлекатель не должен видеть как обычные.
      lines: doc.lines.map((l) => ({ ...l, text: maskContacts(l.text).text })),
    };
  } catch (err) {
    console.warn('[agent/pipeline] maskContacts unavailable', err instanceof Error ? err.message : err);
    return doc;
  }
}

export function docLabel(doc: ExtractedDoc): string {
  const n = doc.lines.length;
  const kind = doc.sourceKind === 'resume' ? 'резюме' : doc.sourceKind === 'github' ? 'GitHub' : doc.sourceKind === 'codeforces' ? 'Codeforces' : doc.sourceKind === 'fsp' ? 'ФСП' : 'документ';
  const name = doc.sourceKind === 'url' ? shortUrl(doc.origin) : doc.title || doc.origin;
  const shown = escapeExternal(name).slice(0, 80);
  // Название источника уже может начинаться с вида («github demo-x») — не дублируем.
  const label = shown.toLowerCase().startsWith(kind.toLowerCase()) ? shown : `${kind} ${shown}`;
  return `${label}${n ? ` (${countOf(n, FORMS.line)})` : ''}`;
}

export async function runPipeline(ctx: ToolContext, input: TurnInput, deps: PipelineDeps): Promise<PipelineResult> {
  const docs: ExtractedDoc[] = [];
  const result: PipelineResult = {
    docs: [],
    failed: [],
    proposed: [],
    rejected: 0,
    merged: 0,
    alreadyKnown: 0,
    rejectSummary: '',
    hiddenText: 0,
    injectionSuspect: false,
    degraded: false,
  };

  for (const uploadId of input.uploadIds ?? []) {
    const u = await loadUpload(ctx.candidateId, uploadId);
    if (!u) {
      result.failed.push(`файл ${uploadId}`);
      ctx.emit({ type: 'step', text: `файл ${uploadId} не найден` });
      continue;
    }
    if (!u.doc) {
      result.failed.push(`файл ${u.filename} (не разобран)`);
      ctx.emit({ type: 'step', text: `файл ${escapeExternal(u.filename)} ещё не разобран — пропускаю` });
      continue;
    }
    docs.push(u.doc);
    ctx.emit({ type: 'step', text: `читаю ${docLabel(u.doc)}…` });
  }

  for (const url of input.urls ?? []) {
    if (ctx.signal?.aborted) break;
    const profile = classifyUrl(url);
    ctx.emit({ type: 'step', text: `читаю ${profile ? `${profile.kind}:${profile.handle}` : shortUrl(url)}…` });
    try {
      const doc = profile ? await fetchProfile(profile.kind, profile.handle, { candidateId: ctx.candidateId }) : await fetchUrl(url);
      await saveSource(ctx.candidateId, doc);
      docs.push(doc);
      ctx.emit({ type: 'step', text: `прочитал ${docLabel(doc)}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ошибка';
      result.failed.push(shortUrl(url));
      ctx.emit({ type: 'step', text: `не удалось прочитать ${shortUrl(url)}: ${msg.slice(0, 120)}` });
    }
  }

  for (const doc of docs) {
    result.docs.push({ label: docLabel(doc), origin: doc.origin, sourceKind: doc.sourceKind, lines: doc.lines.length });
    const hidden = doc.flags.hiddenText?.count ?? 0;
    if (hidden > 0) {
      result.hiddenText += hidden;
      ctx.emit({ type: 'step', text: `в «${escapeExternal(doc.title || doc.origin).slice(0, 60)}» скрытый текст (${hidden}) — проигнорирован` });
    }
    if (doc.flags.injectionSuspect) {
      result.injectionSuspect = true;
      ctx.emit({ type: 'step', text: `в «${escapeExternal(doc.title || doc.origin).slice(0, 60)}» похоже на инструкции для модели — проигнорированы` });
    }
  }

  if (!docs.length || ctx.signal?.aborted) return result;

  const catalog = await getCatalog();
  const proposals: ProposedClaim[] = [];
  for (const doc of docs) {
    if (ctx.signal?.aborted) break;
    ctx.emit({ type: 'step', text: `ищу утверждения в ${docLabel(doc)}…` });
    proposals.push(...(await extractOne(doc, catalog, ctx, deps, result)));
  }

  const { accepted, rejected } = verifyClaims(proposals, docs, catalog);
  const created = accepted.length ? await proposeClaims(ctx.candidateId, accepted) : [];
  result.proposed = created.map((c) => ({ id: c.id, catalogId: c.catalogId, statement: c.statement, level: c.level, sourceRef: c.sourceRef }));
  const createdIds = new Set(created.map((c) => c.catalogId));
  const skipped = [...new Set(accepted.map((a) => a.catalogId))].filter((id) => !createdIds.has(id));
  if (skipped.length) {
    // отсечённое proposeClaims: уже есть в профиле (отклонённое кандидатом не считаем)
    result.alreadyKnown = await prisma.claim.count({
      where: { candidateId: ctx.candidateId, catalogId: { in: skipped }, status: { not: 'rejected' } },
    });
  }
  const reasons = rejected.map((r: { reason: RejectReason }) => r.reason);
  const byReason = countByReason(reasons);
  result.merged = byReason.duplicate ?? 0;
  result.rejected = rejected.length - result.merged;
  result.rejectSummary = describeRejects(reasons);
  ctx.emit({
    type: 'claims',
    proposed: created.map((c) => ({ id: c.id, catalogId: c.catalogId, statement: c.statement, level: c.level, quote: c.quote, sourceRef: c.sourceRef, limits: c.limits, status: c.status })),
    rejected: rejected.length,
    rejectedByReason: byReason,
    ...(result.hiddenText ? { hiddenText: result.hiddenText } : {}),
    ...(result.alreadyKnown ? { alreadyKnown: result.alreadyKnown } : {}),
  });
  ctx.emit({
    type: 'step',
    text: claimsStepText(created.length, reasons),
  });
  return result;
}

async function extractOne(
  doc: ExtractedDoc,
  catalog: CatalogEntry[],
  ctx: ToolContext,
  deps: PipelineDeps,
  result: PipelineResult,
): Promise<ProposedClaim[]> {
  if (result.degraded) return extractByMarkers(doc, catalog);
  try {
    await assertBudget(ctx.candidateId, deps.budget, deps.now());
    return await extractClaims(maskDoc(doc), catalog, ctx.llm);
  } catch (err) {
    if (ctx.signal?.aborted) return [];
    if (err instanceof BudgetExceededError || err instanceof LlmError) {
      result.degraded = true;
      result.degradedReason = err instanceof BudgetExceededError ? 'budget_exceeded' : err.code === 'timeout' ? 'timeout' : 'llm_unavailable';
      ctx.emit({ type: 'step', text: 'извлекатель недоступен — ищу по словарю каталога' });
      return extractByMarkers(doc, catalog);
    }
    throw err;
  }
}
