import { prisma } from '@/server/db';
import { getEnv } from '@/server/env';
import { gapMap, recommendTargets, recommendTasks, recommendTest } from '@/server/recommend';
import { pipelineParts, targetsParts, testPart } from './fallback';
import type { PipelineResult } from './pipeline';

/**
 * Демо-режим без языковой модели (LLM_PROVIDER=stub + LLM_STUB_DEMO=true): ответ
 * консультанта строится шаблонами по данным платформы — как в плане В, но это не
 * сбой, поэтому без пометки «упрощённый режим». Рекомендации — только из кода.
 */
export function isDemoMode(): boolean {
  const env = getEnv();
  return env.LLM_PROVIDER === 'stub' && env.LLM_STUB_DEMO;
}

export interface DemoReplyInput {
  candidateId: string;
  text: string;
  pipeline?: PipelineResult;
}

const NEED_CONFIRM = 'Вакансии подбираются по подтверждённым утверждениям, а пока подтверждённых нет. Подтверди карточки — покажу вакансии.';

export async function demoReply(input: DemoReplyInput): Promise<string> {
  const { candidateId, pipeline: p } = input;
  if (p) {
    const parts = pipelineParts(p);
    if (p.proposed.length) {
      const test = await testPart(candidateId);
      if (test) parts.push(test);
      parts.push('Подтверди карточки — покажу подходящие вакансии и что подтянуть.');
    }
    return parts.join('\n');
  }

  const t = input.text.toLowerCase();
  const confirmed = await prisma.claim.count({ where: { candidateId, status: { in: ['confirmed', 'edited'] } } });

  if (/тест|грейд|категор/.test(t)) {
    return (await testPart(candidateId)) ?? 'Подбор теста сейчас недоступен — попробуй через минуту.';
  }
  if (/что дальше|дальше|план|подтян|пробел|не хватает|задани|чему учиться|как вырасти|как расти/.test(t)) {
    return planReply(candidateId, confirmed);
  }
  if (/ваканс|компани|куда|работ|финтех|подбор|подходит/.test(t) || confirmed > 0) {
    return vacanciesReply(candidateId, confirmed);
  }
  return [
    'Я работаю без языковой модели: собираю утверждения из резюме и ссылок по словарю каталога и отвечаю по данным платформы.',
    confirmed === 0
      ? 'Пришли резюме или ссылки — покажу карточки; подтверди их — подберу вакансии.'
      : 'Спроси про вакансии, тест или «что дальше» — отвечу.',
  ].join('\n');
}

async function vacanciesReply(candidateId: string, confirmed: number): Promise<string> {
  if (confirmed === 0) return NEED_CONFIRM;
  const lines = await targetsParts(candidateId, 3);
  if (!lines) return 'Подбор вакансий сейчас недоступен — попробуй через минуту.';
  if (!lines.length) return 'Подходящих вакансий по подтверждённым утверждениям пока нет. Добавь источники или спроси «что дальше» — подскажу, что подтянуть.';
  const parts = ['По вакансиям платформы ближе всего:', ...lines];
  const test = await testPart(candidateId);
  if (test) parts.push(test);
  parts.push('Спроси «что дальше» — составлю план из пробелов и заданий.');
  return parts.join('\n');
}

async function planReply(candidateId: string, confirmed: number): Promise<string> {
  try {
    const top = confirmed > 0 ? (await recommendTargets(candidateId, 1))[0] : undefined;
    const test = await recommendTest(candidateId);
    const target = top
      ? ({ kind: 'vacancy', id: top.vacancyId } as const)
      : ({ kind: 'category', id: `${test.specialization}:${test.grade}` } as const);
    const gaps = await gapMap(candidateId, target);
    if (!gaps.length) return 'По выбранной цели пробелов не вижу — всё уже подтверждено на платформе.';
    const top3 = gaps.slice(0, 3);
    const tasks = await recommendTasks(candidateId, top3.map((g) => g.id), 3);
    const parts = [
      `План${top ? ` к вакансии «${top.companyName}, ${top.title}»` : ` к категории ${test.specialization} ${test.grade}`}. Сначала закрыть пробелы:`,
      ...top3.map((g) => `— ${g.statement}${g.currentLevel ? ' (пока слабее, чем нужно)' : ' (утверждения нет)'}; чем подтвердить: ${g.suggestedProof.join(', ') || 'задание на платформе'}.`),
    ];
    if (tasks.length) parts.push('Задания, которые это закроют:', ...tasks.map((x) => `— ${x.title}: ${x.reason}`));
    parts.push(confirmed === 0 ? 'Подтверждённых утверждений пока нет: подтверди карточки — план станет точнее и появятся вакансии.' : 'Категорию даёт только тест — пройдёшь его?');
    return parts.join('\n');
  } catch (err) {
    console.warn('[agent/demo-reply] plan unavailable', err instanceof Error ? err.message : err);
    return 'План сейчас недоступен — попробуй через минуту.';
  }
}
