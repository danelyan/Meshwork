// Помощники расширения банка AI (ai-bank2-*.ts, решение владельца 11.10: ~26 семейств на подкатегорию).
// Фабрика сокращает шаблонный код; правила те же, что в ai.ts: ключ считает код (R-T-02), несущественные
// параметры – от seed (R-T-01), a и b – ПРЕДЛОЖЕНИЕ (экспертные, без калибровки на людях).
import { createRng, type Rng } from '../rng';
import type { AnswerFormat, TaskGenerator, TaskInstance } from '../types';

import { num } from './ai-util';

export interface FamilyMeta {
  id: string;
  /** Должен входить в proof одного из catalogIds (claims-catalog.json), иначе тест покрытия ключей падает. */
  taskId: string;
  title: string;
  sub: string;
  grade: TaskGenerator['grade'];
  catalogIds: string[];
  format?: AnswerFormat;
  a: number;
  b: number;
  space: number;
  time: number;
}

export function family(m: FamilyMeta, gen: (rng: Rng) => TaskInstance): TaskGenerator {
  return {
    id: m.id,
    taskId: m.taskId,
    title: m.title,
    specialization: 'ai',
    subcategoryId: m.sub,
    grade: m.grade,
    catalogIds: m.catalogIds,
    format: m.format ?? 'number',
    a: m.a,
    b: m.b,
    paramSpace: m.space,
    timeLimitSec: m.time,
    generate: (seed) => gen(createRng(seed)),
  };
}

/** Число, округлённое до d знаков, как строка-ключ. */
export function fx(x: number, d: number): string {
  return num(Number(x.toFixed(d)));
}

export function sum(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0);
}
