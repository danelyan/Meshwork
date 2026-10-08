import { countOf, FORMS } from '@/lib/plural';
import { recommendTargets, recommendTest } from '@/server/recommend';
import { NO_CONFIRMED_REASON } from '@/server/recommend/types';
import type { PipelineResult } from './pipeline';

/**
 * План В: провайдер LLM упал / таймаут / бюджет исчерпан. Стенд отвечает
 * всегда (ТЗ фаза 3 «Деградация»): словарное извлечение по маркерам каталога
 * (extractByMarkers из claims) + шаблонные ответы по сценарию. Без модели.
 */

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

/** Что прочитал / нашёл / отбросил — общая часть ответа после конвейера (план В и демо-режим). */
export function pipelineParts(p: PipelineResult): string[] {
  const parts: string[] = [];
  if (p.docs.length) parts.push(`Прочитал: ${p.docs.map((d) => d.label).join(', ')}.`);
  if (p.failed.length) parts.push(`Не удалось прочитать: ${p.failed.join(', ')}.`);
  if (p.hiddenText > 0) parts.push('В документе найден скрытый текст — он проигнорирован.');
  if (p.injectionSuspect) parts.push('В присланных данных есть похожее на инструкции для модели — проигнорировано.');
  if (p.proposed.length) {
    parts.push(
      `Нашёл ${countOf(p.proposed.length, FORMS.claim)}${p.rejected ? `, ${p.rejected} отбросил (${p.rejectSummary || 'нет цитаты в источнике'})` : ''}${p.merged ? `, объединил ${countOf(p.merged, FORMS.repeat)} из разных источников` : ''}. Посмотри карточки: «да» переводит утверждение в профиль, «поправить» меняет формулировку, «нет» убирает.`,
    );
  } else if (p.alreadyKnown > 0) {
    parts.push(`Новых утверждений нет: ${p.alreadyKnown} уже в вашем профиле.`);
  } else if (p.docs.length) {
    parts.push('Утверждений из каталога с дословной цитатой не нашёл. Напиши, что делал, своими словами — подберу формулировки из каталога.');
  }
  return parts;
}

/** Предложение теста по подтверждённым и предложенным утверждениям; undefined, если подбор недоступен. */
export async function testPart(candidateId: string): Promise<string | undefined> {
  const test = await safe(() => recommendTest(candidateId));
  if (!test) return undefined;
  if (test.reason === NO_CONFIRMED_REASON) return 'Тест предложу, когда будут подтверждённые утверждения: подтверди карточки.';
  return `По утверждениям похоже на ${SPEC_RU[test.specialization] ?? test.specialization}, ${GRADE_RU[test.grade] ?? test.grade}: ${test.reason}. Категорию даёт только тест — ${test.allowed ? 'пойдёшь на него?' : `смена грейда откроется ${test.nextAllowedAt ?? 'позже'}.`}`;
}

/** Строки по вакансиям из recommendTargets; undefined, если подбор недоступен. */
export async function targetsParts(candidateId: string, limit = 3): Promise<string[] | undefined> {
  const targets = await safe(() => recommendTargets(candidateId, limit));
  if (!targets) return undefined;
  return targets.map(
    (v) =>
      `— ${v.companyName}, ${v.title}: закрываешь ${v.covered} из ${v.total}${v.missing.length ? `, не хватает: ${v.missing.map((m) => m.statement).join('; ')}` : ''}.`,
  );
}

/** Шаблонный ответ по сценарию. Рекомендации — только из кода (recommend_*), если модуль отвечает. */
export async function fallbackReply(input: FallbackInput): Promise<string> {
  const p = input.pipeline;
  const parts: string[] = p ? pipelineParts(p) : [];
  const t = input.text.toLowerCase();
  if (/ваканс|компани|куда|работ|финтех/.test(t) && !p) {
    const lines = await targetsParts(input.candidateId);
    if (lines?.length) {
      parts.push('По вакансиям платформы ближе всего:', ...lines);
    } else if (lines) {
      parts.push('Пока подбирать не из чего: вакансии считаются по подтверждённым утверждениям. Подтверди карточки — покажу вакансии.');
    } else {
      parts.push('Подбор вакансий сейчас недоступен — попробуй через минуту.');
    }
  }
  if (/тест|грейд|категор/.test(t) || p?.proposed.length) {
    const test = await testPart(input.candidateId);
    if (test) parts.push(test);
  }
  if (p?.proposed.length) parts.push('Подтверди карточки — покажу подходящие вакансии.');
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
