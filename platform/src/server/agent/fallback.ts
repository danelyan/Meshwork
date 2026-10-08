import type { CatalogEntry, ProposedClaim } from '@/server/claims/types';
import type { ExtractedDoc } from '@/server/collector/types';
import { recommendTargets, recommendTest } from '@/server/recommend';
import type { PipelineResult } from './pipeline';

/**
 * План В: провайдер LLM упал / таймаут / бюджет исчерпан. Стенд отвечает
 * всегда (ТЗ фаза 3 «Деградация»): словарное извлечение по маркерам каталога
 * + шаблонные ответы по сценарию. Всё детерминированно, без модели.
 */

const normalize = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/**
 * Извлечение без модели: строка документа содержит маркер каталога (≥ 3 символов)
 * → утверждение с цитатой-строкой, confidence low. Одно утверждение на catalogId.
 * Скрытые строки (flags.hiddenText.sample) не рассматриваются. Цитата дальше
 * проходит тот же verifyClaims, что и модельная.
 */
export function extractByMarkers(doc: ExtractedDoc, catalog: CatalogEntry[]): ProposedClaim[] {
  const hidden = new Set(doc.flags.hiddenText?.sample ?? []);
  const lines = doc.lines.length ? doc.lines : doc.text.split('\n').map((text, i) => ({ ref: `${doc.origin}#l${i + 1}`, text }));
  const out: ProposedClaim[] = [];
  const taken = new Set<string>();
  for (const line of lines) {
    if (hidden.has(line.text) || line.text.trim().length < 3) continue;
    const norm = normalize(line.text);
    for (const entry of catalog) {
      if (taken.has(entry.id)) continue;
      const hit = entry.markers.some((m) => {
        const nm = normalize(m);
        return nm.length >= 3 && norm.includes(nm);
      });
      if (!hit) continue;
      taken.add(entry.id);
      out.push({
        catalogId: entry.id,
        statement: entry.statement,
        quote: line.text.trim().slice(0, 300),
        sourceRef: line.ref,
        confidence: 'low',
      });
    }
  }
  return out;
}

export type FallbackReason = 'llm_unavailable' | 'budget_exceeded' | 'timeout';

export const FALLBACK_STEP: Record<FallbackReason, string> = {
  llm_unavailable: 'модель недоступна, работаю в упрощённом режиме',
  timeout: 'модель не ответила вовремя, работаю в упрощённом режиме',
  budget_exceeded: 'дневной лимит обращений к модели исчерпан, работаю в упрощённом режиме',
};

export interface FallbackInput {
  candidateId: string;
  text: string;
  pipeline?: PipelineResult;
  reason: FallbackReason;
}

const GRADE_RU: Record<string, string> = { junior: 'Junior', middle: 'Middle' };
const SPEC_RU: Record<string, string> = { backend: 'Backend', frontend: 'Frontend' };

/** Шаблонный ответ по сценарию. Рекомендации — только из кода (recommend_*), если модуль отвечает. */
export async function fallbackReply(input: FallbackInput): Promise<string> {
  const parts: string[] = [];
  const p = input.pipeline;
  if (p) {
    if (p.docs.length) parts.push(`Прочитал: ${p.docs.map((d) => d.label).join(', ')}.`);
    if (p.failed.length) parts.push(`Не удалось прочитать: ${p.failed.join(', ')}.`);
    if (p.hiddenText > 0) parts.push('В документе найден скрытый текст — он проигнорирован.');
    if (p.injectionSuspect) parts.push('В присланных данных есть похожее на инструкции для модели — проигнорировано.');
    if (p.proposed.length) {
      parts.push(
        `Нашёл ${p.proposed.length} утверждений${p.rejected ? `, ${p.rejected} отбросил (${p.rejectSummary || 'нет цитаты в источнике'})` : ''}. Посмотри карточки: «да» переводит утверждение в профиль, «поправить» меняет формулировку, «нет» убирает.`,
      );
    } else if (p.docs.length) {
      parts.push('Утверждений из каталога с дословной цитатой не нашёл. Напиши, что делал, своими словами — подберу формулировки из каталога.');
    }
  }
  const t = input.text.toLowerCase();
  if (/ваканс|компани|куда|работ|финтех/.test(t) && !p) {
    const targets = await safe(() => recommendTargets(input.candidateId, 3));
    if (targets?.length) {
      parts.push('По вакансиям платформы ближе всего:');
      for (const v of targets) {
        parts.push(`— ${v.companyName}, ${v.title}: закрываешь ${v.covered} из ${v.total}${v.missing.length ? `, не хватает: ${v.missing.map((m) => m.statement).join('; ')}` : ''}.`);
      }
    } else {
      parts.push('Подбор вакансий сейчас недоступен — попробуй через минуту.');
    }
  }
  if (/тест|грейд|категор/.test(t) || p?.proposed.length) {
    const test = await safe(() => recommendTest(input.candidateId));
    if (test) {
      parts.push(
        `По утверждениям похоже на ${SPEC_RU[test.specialization] ?? test.specialization}, ${GRADE_RU[test.grade] ?? test.grade}: ${test.reason}. Категорию даёт только тест — ${test.allowed ? 'пойдёшь на него?' : `смена грейда откроется ${test.nextAllowedAt ?? 'позже'}.`}`,
      );
    }
  }
  if (!parts.length) {
    parts.push(
      'Сейчас отвечаю в упрощённом режиме. Пришли резюме или ссылки — соберу утверждения с цитатами; спроси про тест или вакансии — отвечу по данным платформы.',
    );
  }
  return parts.join('\n');
}

async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    console.warn('[agent/fallback] recommend unavailable', err instanceof Error ? err.message : err);
    return undefined;
  }
}
