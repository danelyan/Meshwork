// Сведение карты глубины по компетенциям в результат ИИнтервью: оси, соответствие грейду, итог,
// сильные стороны и зона роста (docs/competency-model.md § 5). Чистые функции.
import type { Grade } from '../../lib/grades';
import { GRADE_LABEL } from '../../lib/grades';
import type { DepthMapItem } from '../call/types';
import { depthStatus } from '../call/types';
import { AXIS_WEIGHTS, type Axis, type BlockId, type CompetencyDef, gradeForLevel, levelForGrade } from './model';
import type { AxisResult, CompetencyResult, GradeFitLabel, InterviewSummary } from './types';

export const INTERVIEW_MODEL_VERSION = 'competency-model-v1-2026-10-10';

/** ПРЕДЛОЖЕНИЕ: границы подписи «соответствие грейду» по доле компетенций на уровне ≥ заявленного. */
export const GRADE_FIT_BANDS = { match: 0.67, partial: 0.34 } as const;

const MAX_TOTAL = 8;

export function competencyResult(d: DepthMapItem, c: CompetencyDef): CompetencyResult {
  const status = depthStatus(d);
  return {
    id: c.id,
    title: c.title,
    axis: c.axis,
    status,
    probed: d.probed,
    maxLevel: d.maxLevel,
    demonstrated: status === 'confirmed' ? gradeForLevel(d.maxLevel) : null,
    total: d.total,
  };
}

function axisResult(axis: Exclude<Axis, 'grade_fit'>, items: readonly CompetencyResult[]): AxisResult {
  const probed = items.filter((c) => c.axis === axis && c.status !== 'not_probed');
  const confirmed = probed.filter((c) => c.status === 'confirmed').length;
  const score = probed.length ? Math.round((probed.reduce((s, c) => s + c.total, 0) / (probed.length * MAX_TOTAL)) * 100) : null;
  return { axis, score, probed: probed.length, confirmed };
}

export function gradeFitLabel(share: number | null): GradeFitLabel {
  if (share === null) return 'unknown';
  if (share >= GRADE_FIT_BANDS.match) return 'match';
  if (share >= GRADE_FIT_BANDS.partial) return 'partial';
  return 'below';
}

export function gradeFitText(label: GradeFitLabel, grade: Grade | null): string {
  const g = grade ? GRADE_LABEL[grade] : 'заявленному грейду';
  if (label === 'match') return `Соответствует ${g} по интервью`;
  if (label === 'partial') return `Частично соответствует ${g}`;
  if (label === 'below') return `Ниже ${g} по интервью`;
  return 'Соответствие грейду не определено';
}

/**
 * Соответствие грейду: доля проверенных технических и системных компетенций с продемонстрированным уровнем
 * ≥ уровня заявленного грейда. Без заявленного грейда сравниваем с Junior.
 */
export function gradeFitShare(items: readonly CompetencyResult[], grade: Grade | null): number | null {
  const need = levelForGrade(grade ?? 'junior');
  const probed = items.filter((c) => (c.axis === 'technical' || c.axis === 'systems') && c.status !== 'not_probed');
  if (probed.length === 0) return null;
  const ok = probed.filter((c) => c.demonstrated !== null && levelForGrade(c.demonstrated) >= need).length;
  return ok / probed.length;
}

/** Итог 0–100: взвешенное среднее по доступным осям (веса нормируются). */
export function overallScore(axes: readonly AxisResult[]): number | null {
  const avail = axes.filter((a) => a.score !== null);
  if (avail.length === 0) return null;
  const w = avail.reduce((s, a) => s + AXIS_WEIGHTS[a.axis], 0);
  return Math.round(avail.reduce((s, a) => s + (a.score as number) * AXIS_WEIGHTS[a.axis], 0) / w);
}

export function buildInterviewSummary(args: {
  depthMap: readonly DepthMapItem[];
  competencyOf: (topic: string) => CompetencyDef | null;
  claimedGrade: Grade | null;
  blocks: readonly BlockId[];
}): InterviewSummary {
  const competencies = args.depthMap.flatMap((d) => {
    const c = args.competencyOf(d.topic);
    return c ? [competencyResult(d, c)] : [];
  });
  const share = gradeFitShare(competencies, args.claimedGrade);
  const label = gradeFitLabel(share);
  const axes: AxisResult[] = [
    axisResult('technical', competencies),
    axisResult('systems', competencies),
    axisResult('communication', competencies),
    { axis: 'grade_fit', score: share === null ? null : Math.round(share * 100), probed: competencies.filter((c) => (c.axis === 'technical' || c.axis === 'systems') && c.status !== 'not_probed').length, confirmed: 0 },
  ];
  const confirmed = competencies.filter((c) => c.status === 'confirmed').sort((a, b) => b.total - a.total || a.title.localeCompare(b.title));
  const growth = competencies.filter((c) => c.status === 'not_confirmed').sort((a, b) => a.total - b.total || a.title.localeCompare(b.title));
  return {
    modelVersion: INTERVIEW_MODEL_VERSION,
    claimedGrade: args.claimedGrade,
    axes,
    gradeFit: { share, label, text: gradeFitText(label, args.claimedGrade) },
    overall: overallScore(axes),
    competencies,
    strengths: confirmed.slice(0, 3).map((c) => c.title),
    growth: growth.slice(0, 3).map((c) => c.title),
    blocks: [...args.blocks],
  };
}

export function interviewSummaryText(s: InterviewSummary): string {
  const probed = s.competencies.filter((c) => c.status !== 'not_probed');
  if (probed.length === 0) return 'Ответов для оценки не было.';
  const ok = probed.filter((c) => c.status === 'confirmed');
  const head = `Подтверждено компетенций: ${ok.length} из ${probed.length} проверенных. ${s.gradeFit.text}.`;
  const strong = s.strengths.length ? ` Сильные стороны: ${s.strengths.join(', ')}.` : '';
  const grow = s.growth.length ? ` Зона роста: ${s.growth.join(', ')}.` : '';
  const unsure = probed.filter((c) => c.status === 'inconclusive');
  const tail = unsure.length ? ` Не определено: ${unsure.map((c) => c.title).join(', ')}.` : '';
  return head + strong + grow + tail;
}

export const INTERVIEW_DISCLAIMER =
  'ИИнтервью показывает, что из компетенций категории подтвердилось сейчас. Оно не меняет категорию - её даёт тест - и не является вердиктом о грейде: состав компетенций, веса и пороги - экспертные оценки, на людях не калиброваны. Грамотность, акцент и ошибки распознавания речи не оцениваются.';
