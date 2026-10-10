// Общие помощники семейств common-*.ts (ADR 0003, дополнение 11.10). Ключ ответа считает код генератора (R-T-02).
import type { CommonCompetency, TaskGenerator } from '../types';

export type CommonFamilyDef = Omit<TaskGenerator, 'taskId' | 'shared' | 'subcategoryId'> & { competency: CommonCompetency };

/** Общее семейство: id `cm.*`, taskId `task:cm-*`, без подкатегории, с пометкой shared. */
export function commonFamily(def: CommonFamilyDef): TaskGenerator {
  const { competency, ...rest } = def;
  return { ...rest, taskId: `task:${def.id.replace('.', '-')}`, shared: { competency } };
}

/** Таблица моноширинным текстом: имя, шапка, разделитель, строки. */
export function table(name: string, cols: string[], rows: (string | number)[][]): string {
  const w = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells: (string | number)[]) => cells.map((c, i) => String(c).padEnd(w[i]!)).join(' | ');
  return [name, line(cols), w.map((x) => '-'.repeat(x)).join('-+-'), ...rows.map(line)].join('\n');
}

/** Номера (с 1) через запятую. */
export function numbers(xs: readonly number[]): string {
  return xs.join(',');
}
