// Выгрузка слепого набора для размечающих: npx tsx eval/matching/export-blind.ts → eval/matching/blind/items.json.
// Ключ (соответствие id) в файл не пишется: blind-eval.ts восстанавливает его тем же детерминированным buildBlindSet.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBlindSet, LEVEL_LEGEND } from './blind-set';

const here = dirname(fileURLToPath(import.meta.url));
const { items } = buildBlindSet();
mkdirSync(join(here, 'blind'), { recursive: true });
// Компактно: вакансия – блок, кандидат – одна строка (файл читают агенты кусками).
const vac = items.map(({ candidates, ...v }) => `  {${JSON.stringify(v).slice(1, -1)},"candidates":[\n${candidates.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]}`);
const head = {
  instructions: 'Вакансии и профили кандидатов (вымышленные). Оцените релевантность каждого кандидата вакансии: 0 – не подходит, 1 – можно рассматривать, 2 – сильный кандидат.',
  legend: `${LEVEL_LEGEND} categoryFromTest – специализация и грейд, присвоенные кандидату по итогам теста на платформе (null – тест не пройден). fsp – данные Федерации спортивного программирования.`,
};
writeFileSync(join(here, 'blind', 'items.json'), `{${JSON.stringify(head).slice(1, -1)},"vacancies":[\n${vac.join(',\n')}\n]}\n`);
console.log(`записано: blind/items.json – ${items.length} вакансий, ${items.reduce((s, v) => s + v.candidates.length, 0)} пар`);
