// Цифры теста на грейд для /validation — ЕДИНСТВЕННЫЙ источник чисел страницы.
// Источник: перемер политики adr-0002-v7 11.10.2026 (docs/validation-results.md, раздел «Перемер политики v7»):
// сводный JSON — platform/eval/test/results.json (run.ts, 18 подкатегорий); строки по специализациям — тот же run.ts
// с --spec (средние по подкатегориям специализации); персоны — eval/test/subcategory-personas.ts, среднее по 18 подкатегориям.
// Перепрогнали eval — обновите этот файл и раздел docs в одном коммите. Все числа — синтетика: популяции θ и персоны
// заданы агентом, параметры заданий экспертные; на людях не проверено.

export const GRADE_TEST_DOC = 'docs/validation-results.md, раздел «Перемер политики v7 (11.10)»; platform/eval/test/results.json';
export const GRADE_TEST_POLICY =
  'adr-0002-v7: пороги Junior −0,7, Middle −0,1, Senior +0,8; подтверждение при P ≥ 0,8; 7–10 заданий, остановка по SE 0,4, дозадавание до 3; ротация семейств между попытками, индекс честности, общие компетенции в пуле подкатегории';

import raw from '../../../eval/test/results.json';

import { DEFAULT_ITEM_LIMITS, formatItemRange } from '@/lib/test-limits';

import { parseLengthBlock } from './length-sweep';

/** Персоны по подкатегориям: вымышленные кандидаты с моделью знаний, заданной агентом; seed 1, N = 1000 на персону и заявленный грейд, среднее по 18 подкатегориям. */
export interface PersonaRow {
  id: string;
  legend: string;
  truth: 'ниже Junior' | 'Junior' | 'Middle' | 'Senior';
  /** Заявил Junior → подтверждён Junior. */
  pJunior: number;
  /** Заявил Middle → подтверждён Middle. */
  pMiddle: number;
  /** Заявил Senior → подтверждён Senior. */
  pSenior: number;
}

export const PERSONAS: PersonaRow[] = [
  { id: 'N0', legend: 'новичок', truth: 'ниже Junior', pJunior: 0.0, pMiddle: 0.0, pSenior: 0.0 },
  { id: 'N1', legend: 'пограничный новичок', truth: 'ниже Junior', pJunior: 0.06, pMiddle: 0.0, pSenior: 0.0 },
  { id: 'J', legend: 'Junior', truth: 'Junior', pJunior: 0.99, pMiddle: 0.06, pSenior: 0.0 },
  { id: 'Jw', legend: 'Junior с одной слабой темой', truth: 'Junior', pJunior: 0.97, pMiddle: 0.08, pSenior: 0.0 },
  { id: 'JI', legend: 'идеальный Junior (контроль)', truth: 'Junior', pJunior: 1.0, pMiddle: 0.0, pSenior: 0.0 },
  { id: 'M', legend: 'Middle', truth: 'Middle', pJunior: 1.0, pMiddle: 0.99, pSenior: 0.02 },
  { id: 'Mw', legend: 'Middle с одной слабой темой', truth: 'Middle', pJunior: 1.0, pMiddle: 0.99, pSenior: 0.03 },
  { id: 'S', legend: 'Senior', truth: 'Senior', pJunior: 1.0, pMiddle: 1.0, pSenior: 0.99 },
];

/** Разброс по подкатегориям и строки, где ложное подтверждение старшего грейда выше цели 0,10 (11 из 144). */
export const PERSONA_NOTE =
  'Честные персоны подтверждают свой грейд не ниже цели во всех 18 подкатегориях (Junior и Middle ≥ 0,90, «с одной слабой темой» ≥ 0,85, Senior ≥ 0,93). Ложное подтверждение старшего грейда выше 0,10 — в 11 строках из 144: худшее 0,22 (ai.mlops, «Junior с одной слабой темой» → Middle), пограничный новичок → Junior до 0,20 (ai.bi-analytics) и 0,12 (backend.data-model), «Middle с одной слабой темой» → Senior 0,11 (backend.web-api). Это свойство банка подкатегории на синтетике, а не измерение на людях.';

/** θ-синтетика: N = 2000 на подкатегорию, seed 1, политика v7; строка — среднее по подкатегориям специализации. Доли — от 0 до 1. */
export interface SyntheticRow {
  population: 'persona' | 'legacy';
  specialization: 'backend' | 'frontend' | 'ai' | 'engineering';
  falseConfirm: number;
  falseReject: number;
  /** Совпадение исхода двух попыток с разными вариантами заданий (test-retest). */
  retest: number;
  /** κ Коэна двух попыток по бинарному решению. */
  kappa: number;
  /** Средняя длина теста, заданий. */
  length: number;
  /** Ложное подтверждение, если кандидат знает трюк по 30 % шаблонов (атака утечкой). */
  leak30: number;
  /** Ложное подтверждение при «лучшей из 3 попыток» с обучением между ними. */
  bestOf3: number;
  /** AUC θ̂ Middle против Junior (популяции пересекаются). */
  aucMiddleJunior: number;
}

export const SYNTHETIC: SyntheticRow[] = [
  { population: 'persona', specialization: 'backend', falseConfirm: 0.291, falseReject: 0.322, retest: 0.722, kappa: 0.441, length: 8.62, leak30: 0.46, bestOf3: 0.704, aucMiddleJunior: 0.646 },
  { population: 'persona', specialization: 'frontend', falseConfirm: 0.304, falseReject: 0.31, retest: 0.702, kappa: 0.404, length: 8.51, leak30: 0.482, bestOf3: 0.691, aucMiddleJunior: 0.662 },
  { population: 'persona', specialization: 'ai', falseConfirm: 0.303, falseReject: 0.314, retest: 0.712, kappa: 0.423, length: 8.32, leak30: 0.461, bestOf3: 0.667, aucMiddleJunior: 0.669 },
  { population: 'persona', specialization: 'engineering', falseConfirm: 0.285, falseReject: 0.335, retest: 0.703, kappa: 0.402, length: 8.54, leak30: 0.444, bestOf3: 0.647, aucMiddleJunior: 0.656 },
  { population: 'legacy', specialization: 'backend', falseConfirm: 0.056, falseReject: 0.546, retest: 0.777, kappa: 0.411, length: 8.93, leak30: 0.139, bestOf3: 0.303, aucMiddleJunior: 0.883 },
  { population: 'legacy', specialization: 'frontend', falseConfirm: 0.069, falseReject: 0.521, retest: 0.775, kappa: 0.425, length: 8.73, leak30: 0.145, bestOf3: 0.288, aucMiddleJunior: 0.886 },
];

/** Цели из плана проверки (docs/validation-plan.md) — подпись столбцов. */
export const TARGETS = {
  falseConfirm: '≤ 10 %',
  falseReject: '≤ 20 %',
  retest: '≥ 90 %',
  kappa: '≥ 0,70',
  auc: '≥ 0,90',
  length: `${formatItemRange(DEFAULT_ITEM_LIMITS)} + до 3`,
} as const;

/** Команды воспроизведения из platform/ (без LLM, без БД; полный прогон ≈ 50 с, персоны ≈ 20 с на специализацию). */
export const GRADE_TEST_COMMANDS = [
  'npx tsx eval/test/run.ts --n 2000 --json eval/test/results.json',
  'npx tsx eval/test/run.ts --n 2000 --seed 1 --spec backend                      # и frontend, ai, engineering',
  'npx tsx eval/test/run.ts --n 2000 --seed 1 --spec backend --population legacy',
  'npx tsx eval/test/subcategory-personas.ts --spec backend --n 1000 --seed 1     # и frontend, ai, engineering',
  'npx tsx eval/test/length-sweep.ts   # лимиты длины 7–10 … 12–16, ≈ 4 мин',
  'npx tsx eval/test/bank-width.ts',
];

/** «Длина теста и надёжность»: lengthSweep и bankWidth из results.json (eval/test/length-sweep.ts, bank-width.ts). */
export const LENGTH_BLOCK = parseLengthBlock(raw);
