/**
 * Влияние порога Middle (0,4/0,3 → 0,25/0,15, решение владельца 09.10, research/13) на размеченные профили eval.
 * Без LLM: утверждения берутся из gold-разметки (eval/labels, eval/demo/*), покрытие
 * считается тем же decideGrade, что и в продукте. Запуск: npx tsx scripts/threshold-impact.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { catalogFromFile } from '../src/server/claims/catalog-file';
import { decideGrade, middleSignature } from '../src/server/recommend/test';

const OLD = 0.4;
const NEW = 0.25;
const catalog = new Map(catalogFromFile().map((e) => [e.id, e]));
const pick = (cov: number, t: number) => (cov >= t ? 'middle' : 'junior');

interface Label { id: string; specialization: string; gradeExpected: string; claims: { catalogId: string }[] }
const files = [
  ...readdirSync('eval/labels').filter((f) => f.endsWith('.json')).map((f) => join('eval/labels', f)),
  ...readdirSync('eval/demo').map((d) => join('eval/demo', d, 'label.json')),
];
const rows: string[] = [];
let changed = 0, changedJunior = 0, changedMiddle = 0, goldMiddle = 0, goldJunior = 0, okOld = 0, okNew = 0, graded = 0;
for (const f of files) {
  const l = JSON.parse(readFileSync(f, 'utf8')) as Label;
  if (l.specialization !== 'backend' && l.specialization !== 'frontend') continue;
  const cov = decideGrade(middleSignature(catalog, l.specialization), new Set(l.claims.map((c) => c.catalogId))).coverage;
  const a = pick(cov, OLD), b = pick(cov, NEW);
  if (l.gradeExpected === 'junior' || l.gradeExpected === 'middle') {
    graded++;
    if (l.gradeExpected === 'middle') goldMiddle++; else goldJunior++;
    if (a === l.gradeExpected) okOld++;
    if (b === l.gradeExpected) okNew++;
  }
  if (a !== b) { changed++; if (l.gradeExpected === 'junior') changedJunior++; if (l.gradeExpected === 'middle') changedMiddle++; }
  rows.push(`| ${l.id} | ${l.specialization} | ${Math.round(cov * 100)} % | ${a} | ${b} | ${l.gradeExpected} |${a !== b ? ' <- меняется' : ''}`);
}
console.log('| профиль | спец. | покрытие Middle | при 0,4 | при 0,25 | gold |\n|---|---|---|---|---|---|');
console.log(rows.join('\n'));
console.log(`\nразмечено junior/middle: ${graded} (junior ${goldJunior}, middle ${goldMiddle})`);
console.log(`меняют рекомендацию: ${changed}; из них gold=junior ${changedJunior}, gold=middle ${changedMiddle}`);
console.log(`совпадение с gold: при 0,4 ${okOld}/${graded}, при 0,25 ${okNew}/${graded}`);
