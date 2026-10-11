// Цифры теста на грейд для /validation. Закоммиченного results-файла у eval/test нет (скрипты печатают
// таблицы в консоль), поэтому числа вынесены сюда — ЕДИНСТВЕННЫЙ источник для страницы.
// Источник чисел: docs/validation-results.md, раздел «Тест на грейд (ADR 0002) — персоны и θ-синтетика,
// параметры заданий экспертные» (политика adr-0002-v3, 10.10.2026): подразделы «Результаты по персонам»,
// «Чувствительность: θ-синтетика» и архивная таблица «Популяция синтетики: старая и по персонам» (AUC).
// Перепрогнали eval — обновите этот файл и раздел docs в одном коммите.

export const GRADE_TEST_DOC = 'docs/validation-results.md, раздел «Тест на грейд (ADR 0002) — персоны и θ-синтетика»';
export const GRADE_TEST_POLICY = 'Снимок политики adr-0002-v3 (10.10; действующая — adr-0002-v7, её цифры — в docs/validation-results.md, «Версии политики теста на грейд»): порог Junior −0,7, Middle −0,1, порог подтверждения 0,8, 7–10 заданий + дозадавание до 3 Junior';

/** Персоны: вымышленные кандидаты с моделью знаний, заданной агентом; seed 1, N = 4000 попыток на персону. */
export interface PersonaRow {
  id: string;
  legend: string;
  truth: 'ниже Junior' | 'Junior' | 'Middle';
  /** Заявил Junior → подтверждён Junior. */
  pJunior: number;
  /** Заявил Middle → подтверждён Middle. */
  pMiddle: number;
}

export const PERSONAS: PersonaRow[] = [
  { id: 'B1', legend: 'логист, кода не писала', truth: 'ниже Junior', pJunior: 0.0, pMiddle: 0.0 },
  { id: 'B2', legend: 'курсы Python 3 мес.', truth: 'ниже Junior', pJunior: 0.12, pMiddle: 0.0 },
  { id: 'F3', legend: 'верстальщик без JS', truth: 'ниже Junior', pJunior: 0.01, pMiddle: 0.0 },
  { id: 'B3', legend: 'уверенный Junior, Django', truth: 'Junior', pJunior: 0.94, pMiddle: 0.22 },
  { id: 'B4', legend: 'слабый узкий Junior, платежи', truth: 'Junior', pJunior: 0.98, pMiddle: 0.46 },
  { id: 'F1', legend: 'пограничный Junior/Middle, React', truth: 'Junior', pJunior: 0.97, pMiddle: 0.43 },
  { id: 'B5', legend: 'Middle, Java/Spring, Kafka', truth: 'Middle', pJunior: 1.0, pMiddle: 1.0 },
  { id: 'F2', legend: 'Middle с перекосом в вёрстку', truth: 'Middle', pJunior: 0.99, pMiddle: 0.42 },
];

/** θ-синтетика: N = 2000 на специализацию, seed 1, текущая механика. Доли — от 0 до 1. */
export interface SyntheticRow {
  population: 'persona' | 'legacy';
  specialization: 'backend' | 'frontend';
  falseConfirm: number;
  falseReject: number;
  /** Совпадение исхода двух попыток с разными вариантами заданий (test-retest). */
  retest: number;
  /** κ Коэна двух попыток; посчитан без дозадавания (--no-probe). */
  kappa: number;
  /** Средняя длина теста, заданий. */
  length: number;
  /** Ложное подтверждение, если кандидат знает трюк по 30 % шаблонов (атака утечкой). */
  leak30: number;
  /** Ложное подтверждение при «лучшей из 3 попыток» без интервала. */
  bestOf3: number;
  /** AUC θ̂ Middle против Junior и Junior против новичка (архивная таблица без дозадавания). */
  aucMiddleJunior: number;
  aucJuniorNovice: number;
}

export const SYNTHETIC: SyntheticRow[] = [
  { population: 'persona', specialization: 'backend', falseConfirm: 0.32, falseReject: 0.243, retest: 0.707, kappa: 0.42, length: 8.91, leak30: 0.562, bestOf3: 0.569, aucMiddleJunior: 0.707, aucJuniorNovice: 0.865 },
  { population: 'persona', specialization: 'frontend', falseConfirm: 0.319, falseReject: 0.248, retest: 0.697, kappa: 0.4, length: 8.89, leak30: 0.522, bestOf3: 0.588, aucMiddleJunior: 0.686, aucJuniorNovice: 0.86 },
  { population: 'legacy', specialization: 'backend', falseConfirm: 0.032, falseReject: 0.579, retest: 0.815, kappa: 0.48, length: 9.26, leak30: 0.121, bestOf3: 0.071, aucMiddleJunior: 0.897, aucJuniorNovice: 0.85 },
  { population: 'legacy', specialization: 'frontend', falseConfirm: 0.04, falseReject: 0.591, retest: 0.82, kappa: 0.45, length: 9.08, leak30: 0.099, bestOf3: 0.081, aucMiddleJunior: 0.891, aucJuniorNovice: 0.849 },
];

/** Цели из плана проверки (docs/validation-plan.md) — подпись столбцов. */
export const TARGETS = {
  falseConfirm: '≤ 10 %',
  falseReject: '≤ 20 %',
  retest: '≥ 90 %',
  kappa: '≥ 0,70',
  auc: '≥ 0,90',
  length: '7–10 + до 3',
} as const;

/** Команды воспроизведения из platform/ (без LLM, без БД, ~15 с). */
export const GRADE_TEST_COMMANDS = [
  'npm run eval:test-personas -- --n 4000 --seed 1',
  'npx tsx eval/test/personas.ts --n 4000 --seed 1 --no-probe',
  'npx tsx eval/test/run.ts --n 2000 --seed 1',
  'npx tsx eval/test/run.ts --n 2000 --seed 1 --population legacy',
];
