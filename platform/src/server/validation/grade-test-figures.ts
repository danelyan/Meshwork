// Цифры теста на грейд для /validation. Политика adr-0002-v7 (11.10.2026).
// SYNTHETIC читается из закоммиченного eval/test/results.json (пишет `eval/test/run.ts --json`): среднее по подкатегориям,
// модель ошибки «экземпляр» (σ = 0,2). PERSONAS — константы из прогона `eval/test/subcategory-personas.ts` (см. ниже):
// у него нет JSON-вывода, поэтому после перепрогона обновляйте их вместе с разделом docs/validation-results.md.

import raw from '../../../eval/test/results.json';

import { DEFAULT_ITEM_LIMITS, formatItemRange } from '@/lib/test-limits';

import { parseLengthBlock } from './length-sweep';

export const GRADE_TEST_DOC = 'docs/validation-results.md, раздел «Версии политики теста на грейд» и § «Повторяемость на втором банке»';
export const GRADE_TEST_POLICY = `adr-0002-v7 (11.10): порог Junior −0,7, Middle −0,1, Senior +0,8, порог подтверждения 0,8, ${formatItemRange(DEFAULT_ITEM_LIMITS)} заданий + дозадавание, пул — подкатегория (26–27 семейств)`;

/**
 * Персоны: профили знаний по семействам подкатегории (не легенды людей), одни и те же на каждой подкатегории.
 * Источник: `npx tsx eval/test/subcategory-personas.ts --spec <backend|frontend|ai|engineering> --n 1000 --seed 1`
 * (11.10, adr-0002-v7), 18 подкатегорий; в строках — среднее по подкатегориям, в скобках минимум и максимум.
 */
export interface PersonaRow {
  id: string;
  legend: string;
  truth: 'ниже Junior' | 'Junior' | 'Middle' | 'Senior';
  /** Заявил Junior → подтверждён Junior: среднее, минимум, максимум по подкатегориям. */
  pJunior: [number, number, number];
  /** Заявил Middle → подтверждён Middle. */
  pMiddle: [number, number, number];
}

export const PERSONAS: PersonaRow[] = [
  { id: 'N0', legend: 'новичок: решает половину простых тем наугад', truth: 'ниже Junior', pJunior: [0, 0, 0], pMiddle: [0, 0, 0] },
  { id: 'N1', legend: 'пограничный новичок: уверенно только базовые темы', truth: 'ниже Junior', pJunior: [0.062, 0.02, 0.2], pMiddle: [0, 0, 0] },
  { id: 'J', legend: 'Junior: уверенно Junior-темы, Middle-темы наполовину', truth: 'Junior', pJunior: [0.991, 0.97, 1], pMiddle: [0.057, 0.01, 0.15] },
  { id: 'M', legend: 'Middle: Junior-темы все, Middle-темы почти все', truth: 'Middle', pJunior: [1, 1, 1], pMiddle: [0.991, 0.93, 1] },
  { id: 'S', legend: 'Senior: все темы Junior и Middle, почти все Senior', truth: 'Senior', pJunior: [1, 1, 1], pMiddle: [1, 1, 1] },
];

/** θ-синтетика: N = 2000 на подкатегорию, seed 1, текущая механика (дозадавание включено). Доли — от 0 до 1. */
export interface SyntheticRow {
  setting: 'strict' | 'competitor';
  label: string;
  /** Подкатегорий в усреднении. */
  subcategories: number;
  falseConfirm: number;
  falseReject: number;
  /** Совпадение исхода двух попыток с разными вариантами заданий (test-retest). */
  retest: number;
  /** κ Коэна двух попыток по бинарному решению. */
  kappa: number;
  /** Средняя длина теста, заданий. */
  length: number;
  /** Ложное подтверждение, если кандидат знает трюк по 30 % шаблонов; в постановке конкурентов не считается. */
  leak30: number | null;
  /** AUC θ̂ Middle против Junior и Junior против новичка (в постановке конкурентов Junior/новичок не считается). */
  aucMiddleJunior: number;
  aucJuniorNovice: number | null;
}

type SummaryEntry = { mean: number };
const instance = raw.summary.instance as unknown as Record<string, SummaryEntry>;
const m = (key: string): number => {
  const e = instance[key];
  if (!e) throw new Error(`results.json: нет ${key}`);
  return e.mean;
};
const subs = raw.subcategories as unknown as { byError: { instance: { strict: { auc: { juniorVsNovice: number } } } } }[];
const aucJuniorNovice = Math.round((subs.reduce((a, x) => a + x.byError.instance.strict.auc.juniorVsNovice, 0) / subs.length) * 1000) / 1000;

export const SYNTHETIC: SyntheticRow[] = [
  {
    setting: 'strict',
    label: 'Строгая: истина — метка популяции',
    subcategories: subs.length,
    falseConfirm: m('strict.falsePass'),
    falseReject: m('strict.falseFail'),
    retest: m('strict.retest.decisionAgreement'),
    kappa: m('strict.retest.kappaBinary'),
    length: m('strict.length.mean'),
    leak30: m('strict.leak.falsePass'),
    aucMiddleJunior: m('strict.auc.middleVsJunior'),
    aucJuniorNovice,
  },
  {
    setting: 'competitor',
    label: 'Постановка конкурентов: θ ~ N(0; 1)',
    subcategories: subs.length,
    falseConfirm: m('competitor.falsePass'),
    falseReject: m('competitor.falseFail'),
    retest: m('competitor.retest.decisionAgreement'),
    kappa: m('competitor.retest.kappaBinary'),
    length: m('competitor.length.mean'),
    leak30: null,
    aucMiddleJunior: m('competitor.aucByBand.middleVsJunior'),
    aucJuniorNovice: null,
  },
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

/** Команды воспроизведения из platform/ (без LLM, без БД; run.ts ≈ 3 мин, персоны ≈ 1 мин на направление). */
export const GRADE_TEST_COMMANDS = [
  'npx tsx eval/test/run.ts --n 2000 --json eval/test/results.json',
  'npx tsx eval/test/subcategory-personas.ts --spec backend --n 1000 --seed 1',
  'npx tsx eval/test/subcategory-personas.ts --spec frontend --n 1000 --seed 1',
  'npx tsx eval/test/subcategory-personas.ts --spec ai --n 1000 --seed 1',
  'npx tsx eval/test/subcategory-personas.ts --spec engineering --n 1000 --seed 1',
  'npx tsx eval/test/length-sweep.ts   # лимиты длины 7–10 … 12–16, ≈ 4 мин',
  'npx tsx eval/test/bank-width.ts',
];

/** «Длина теста и надёжность»: lengthSweep и bankWidth из results.json (eval/test/length-sweep.ts, bank-width.ts). */
export const LENGTH_BLOCK = parseLengthBlock(raw);
