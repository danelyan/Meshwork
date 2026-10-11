// Общие помощники расширенного банка frontend (решение владельца 11.10: ~26 семейств на подкатегорию).
// Ключ всегда считает код генератора; a, b – ПРЕДЛОЖЕНИЕ (экспертные, не калиброваны на людях).
import type { AnswerFormat, TaskGenerator, TaskInstance } from '../types';
import type { Grade } from '../../types';

export const UI = 'frontend.ui-app';
export const DS = 'frontend.design-system';
export const WP = 'frontend.web-perf';
export const RT = 'frontend.realtime';

interface Def {
  id: string;
  sub: string;
  grade: Grade;
  title: string;
  catalogIds: string[];
  format?: AnswerFormat;
  taskId?: string;
  a: number;
  b: number;
  space: number;
  time?: number;
  generate: (seed: number) => TaskInstance;
}

export function fam(d: Def): TaskGenerator {
  return {
    id: d.id,
    subcategoryId: d.sub,
    taskId: d.taskId ?? 'task:code-output',
    title: d.title,
    specialization: 'frontend',
    grade: d.grade,
    catalogIds: d.catalogIds,
    format: d.format ?? 'number',
    a: d.a,
    b: d.b,
    paramSpace: d.space,
    timeLimitSec: d.time ?? (d.grade === 'junior' ? 150 : d.grade === 'middle' ? 200 : 260),
    generate: d.generate,
  };
}
