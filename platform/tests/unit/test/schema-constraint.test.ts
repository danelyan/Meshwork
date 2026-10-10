import { schemaConstraint } from '@/server/test/generators/backend';

/** Независимая симуляция: разбирает SQL из условия и выполняет INSERT-ы сверху вниз. */
function simulateInserts(code: string): number[] {
  const minAge = Number(/CHECK \(age >= (\d+)\)/.exec(code)![1]);
  const inserts = [...code.matchAll(/INSERT INTO users \(([^)]*)\) VALUES \(([^;]*)\);/g)];
  const taken = new Set<string>();
  const failing: number[] = [];
  inserts.forEach((m, i) => {
    const cols = m[1].split(',').map((s) => s.trim());
    const vals = m[2].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    const row = Object.fromEntries(cols.map((c, j) => [c, vals[j]]));
    const noName = row.name === undefined;
    const lowAge = row.age !== undefined && Number(row.age) < minAge;
    const dupEmail = taken.has(row.email);
    if (noName || lowAge || dupEmail) {
      failing.push(i + 1);
      return;
    }
    taken.add(row.email);
  });
  return failing;
}

describe('be.schema-constraint', () => {
  it('ключ совпадает с выполнением INSERT-ов сверху вниз на 300 seed', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const t = schemaConstraint.generate(seed);
      expect(t.answerKey, `seed ${seed}`).toBe(simulateInserts(t.code!).join(','));
    }
  });
});
