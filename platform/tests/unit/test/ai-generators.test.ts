import { catalogFromFile } from '@/server/claims/catalog-file';
import { checkAnswer } from '@/server/test/answers';
import { getSubcategory } from '@/lib/directions';
import {
  generatorsFor,
  generatorsForSubcategory,
  hasTestFor,
  MIN_FAMILIES_PER_SUBCATEGORY,
  NoGeneratorsError,
  poolFor,
  requireGenerators,
} from '@/server/test/generators';
import {
  AI_GENERATORS,
  cosineTopK,
  holdoutReport,
  imputerFit,
  modelRegistry,
  promptInjection,
  ragChunking,
  toolLoop,
} from '@/server/test/generators/ai';
import { bonferroni, circuitBreaker, earlyStopping, latencyPercentile, rateLimits, srmCheck } from '@/server/test/generators/ai-extra';

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

describe('генераторы ai.* (ADR 0003, дополнение 10.10)', () => {
  it('семейства ai.*: оба грейда, a/b в коридоре backend/frontend, у каждого подкатегория своего направления', () => {
    expect(AI_GENERATORS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(AI_GENERATORS.map((g) => g.id)).size).toBe(AI_GENERATORS.length);
    expect(generatorsFor('ai')).toHaveLength(AI_GENERATORS.length);
    for (const g of AI_GENERATORS) {
      expect(g.id).toMatch(/^ai\.[a-z0-9-]+$/);
      expect(g.taskId).toMatch(/^task:/);
      expect(g.specialization).toBe('ai');
      expect(getSubcategory(g.subcategoryId)?.specialization, g.id).toBe('ai');
      if (g.grade === 'junior') expect(g.b).toBeLessThan(0);
      else expect(g.b).toBeGreaterThan(0);
      expect(g.a).toBeGreaterThanOrEqual(0.8);
      expect(g.a).toBeLessThanOrEqual(1.6);
    }
    // Дозадавание Junior опирается на ≥ JUNIOR_PROBE_MAX Junior-шаблонов после основной фазы.
    expect(AI_GENERATORS.filter((g) => g.grade === 'junior').length).toBeGreaterThanOrEqual(6);
    expect(AI_GENERATORS.filter((g) => g.grade === 'middle').length).toBeGreaterThanOrEqual(6);
  });

  it('пять подкатегорий ai — по ≥ 8 семейств (MIN_FAMILIES_PER_SUBCATEGORY), в каждой оба грейда', () => {
    for (const sub of ['ai.llm-apps', 'ai.ai-integration', 'ai.ml-engineering', 'ai.mlops', 'ai.data-science']) {
      const fam = generatorsForSubcategory(sub);
      expect(fam.length, sub).toBeGreaterThanOrEqual(MIN_FAMILIES_PER_SUBCATEGORY);
      expect(fam.filter((g) => g.grade === 'junior').length, sub).toBeGreaterThanOrEqual(3);
      expect(fam.filter((g) => g.grade === 'middle').length, sub).toBeGreaterThanOrEqual(3);
      const pool = poolFor('ai', sub)!;
      expect(pool.legacy).toBe(false);
      expect(pool.generators.every((g) => g.subcategoryId === sub)).toBe(true);
    }
  });

  it('каждый catalogId — запись каталога ai.* или common.*, и запись ссылается на задание (proof task:)', () => {
    const cat = new Map(catalogFromFile().map((e) => [e.id, e]));
    for (const g of AI_GENERATORS) {
      for (const id of g.catalogIds) {
        expect(id, g.id).toMatch(/^(ai|common)\./);
        expect(cat.has(id), `${g.id} → ${id}`).toBe(true);
      }
      // Хотя бы одно утверждение называет это задание путём доказательства.
      expect(g.catalogIds.some((id) => cat.get(id)!.proof.includes(g.taskId)), g.id).toBe(true);
    }
  });

  it('покрытие ключей: все ai.* утверждения каталога, кроме ручных (interview:), доказываются хотя бы одним заданием', () => {
    const covered = new Set(AI_GENERATORS.flatMap((g) => g.catalogIds));
    const ai = catalogFromFile().filter((e) => e.specialization === 'ai');
    const testable = ai.filter((e) => e.proof.some((p) => p.startsWith('task:')));
    for (const e of testable) expect(covered.has(e.id), e.id).toBe(true);
  });

  for (const g of AI_GENERATORS) {
    it(`${g.id}: 300 seed без исключений, детерминизм, ключ принимается, варианты различаются`, () => {
      const prompts = new Set<string>();
      const keys = new Set<string>();
      for (const seed of SEEDS) {
        const inst = g.generate(seed);
        expect(g.generate(seed)).toEqual(inst);
        for (const k of inst.answerKey.split('|')) expect(checkAnswer(g.format, k, inst.answerKey), `${g.id} ${seed}`).toBe(true);
        if (g.format === 'list') {
          const parts = inst.answerKey.split(',');
          expect(new Set(parts).size, `${g.id} ${seed}`).toBe(parts.length);
        }
        if (g.format === 'line') {
          const n = Number(inst.answerKey);
          expect(n).toBeGreaterThanOrEqual(1);
          expect(n).toBeLessThanOrEqual(inst.code!.split('\n').length);
        }
        prompts.add(`${inst.prompt}\n${inst.code ?? ''}`);
        keys.add(inst.answerKey);
      }
      expect(prompts.size).toBeGreaterThanOrEqual(30);
      // Ответ не угадывается константой: не меньше 3 разных ключей на 300 seed.
      expect(keys.size).toBeGreaterThanOrEqual(3);
    });
  }
});

describe('ключи ai.* совпадают с независимым пересчётом', () => {
  it('ai.rag-chunking: моделирование окна', () => {
    for (const seed of SEEDS) {
      const t = ragChunking.generate(seed);
      const { n, size, overlap } = t.params as { n: number; size: number; overlap: number };
      let count = 0;
      for (let start = 0; start < n; start += size - overlap) {
        count++;
        if (start + size >= n) break;
      }
      expect(t.answerKey, `seed ${seed}`).toBe(String(count));
    }
  });

  it('ai.cosine-topk: top-k по косинусу из кода задания, без ничьих на границе', () => {
    for (const seed of SEEDS) {
      const t = cosineTopK.generate(seed);
      const vecs = [...t.code!.matchAll(/^(\w+)\s*= \[([^\]]+)\]$/gm)].map((m) => ({ name: m[1]!, v: m[2]!.split(',').map(Number) }));
      const q = vecs[0]!.v;
      const k = (t.params as { k: number }).k;
      const sims = vecs.slice(1).map((d) => ({ name: d.name, s: d.v.reduce((acc, x, i) => acc + x * q[i]!, 0) / (Math.hypot(...d.v) * Math.hypot(...q)) }));
      sims.sort((a, b) => b.s - a.s);
      expect(sims[k - 1]!.s - sims[k]!.s).toBeGreaterThan(0.01);
      expect(t.answerKey.split(',').sort()).toEqual(sims.slice(0, k).map((x) => x.name).sort());
    }
  });

  it('ai.tool-loop: исполнение цикла по сценарию ответов модели', () => {
    for (const seed of SEEDS) {
      const t = toolLoop.generate(seed);
      const code = t.code!;
      const max = Number(/MAX_STEPS = (\d+)/.exec(code)![1]);
      const answers = [...code.matchAll(/^ответ \d+: (.*)$/gm)].map((m) => (m[1]!.startsWith('финальный') ? 0 : m[1]!.split(',').length));
      let llm = 0;
      let tools = 0;
      for (let s = 0; s < max && s < answers.length; s++) {
        llm++;
        if (answers[s] === 0) break;
        tools += answers[s]!;
      }
      const ask = (t.params as { ask: 'llm' | 'tools' }).ask;
      expect(t.answerKey, `seed ${seed}`).toBe(String(ask === 'llm' ? llm : tools));
    }
  });

  it('ai.prompt-injection: ответ указывает на единственную строку с уязвимым паттерном', () => {
    const vuln = /"role": "system", "content": SYSTEM \+|TOOLS\[call\.name\]|HTMLResponse|os\.environ/;
    for (const seed of SEEDS) {
      const t = promptInjection.generate(seed);
      const lines = t.code!.split('\n');
      const hits = lines.map((l, i) => (vuln.test(l) ? i + 1 : 0)).filter(Boolean);
      expect(hits).toEqual([Number(t.answerKey)]);
    }
  });

  it('ловушки различают подходы: лучшая на тесте ≠ ответ, fit на всех данных ≠ ответ, последняя версия ≠ production', () => {
    for (const seed of SEEDS) {
      const h = holdoutReport.generate(seed);
      const tests = [...h.code!.matchAll(/\|\s*([\d.]+)\s*$/gm)].map((m) => Number(m[1]));
      expect(Math.max(...tests)).not.toBe(Number(h.answerKey));

      const i = imputerFit.generate(seed);
      expect(i.explanation).toMatch(/при fit на всех данных/);
      const all = Number(/; ([\d.]+) получилось бы/.exec(i.explanation)![1]);
      expect(all).not.toBe(Number(i.answerKey));

      const r = modelRegistry.generate(seed);
      const { prod, latest } = r.params as { prod: number; latest: number };
      expect(prod).not.toBe(latest);
      expect(r.answerKey.split('|')[0]).toBe(`v${prod}`);
    }
  });
});

describe('ключи ai-extra совпадают с независимым пересчётом', () => {
  it('ai.rate-limits: min(RPM, ⌊TPM / токенов на запрос⌋)', () => {
    for (const seed of SEEDS) {
      const t = rateLimits.generate(seed);
      const { rpm, tpm, tin, tout } = t.params as Record<string, number>;
      expect(t.answerKey).toBe(String(Math.min(rpm!, Math.floor(tpm! / (tin! + tout!)))));
    }
  });

  it('ai.latency-percentile: nearest-rank по коду задания', () => {
    for (const seed of SEEDS) {
      const t = latencyPercentile.generate(seed);
      const xs = t.code!.split(', ').map(Number).sort((a, b) => a - b);
      const p = (t.params as { p: number }).p;
      expect(t.answerKey).toBe(String(xs[Math.ceil((p / 100) * xs.length) - 1]));
    }
  });

  it('ai.bonferroni: p < 0.05 / m по коду задания', () => {
    for (const seed of SEEDS) {
      const t = bonferroni.generate(seed);
      const ps = [...t.code!.matchAll(/p = ([\d.]+)/g)].map((m) => Number(m[1]));
      expect(t.answerKey).toBe(String(ps.filter((p) => p < 0.05 / ps.length).length));
    }
  });

  it('ai.srm-check: χ² против 3,84 по числам из кода задания', () => {
    for (const seed of SEEDS) {
      const t = srmCheck.generate(seed);
      const bad = [...t.code!.matchAll(/^(\w+): A = (\d+), B = (\d+)$/gm)]
        .filter((m) => {
          const a = Number(m[2]);
          const b = Number(m[3]);
          const e = (a + b) / 2;
          return ((a - e) ** 2 + (b - e) ** 2) / e > 3.84;
        })
        .map((m) => m[1]);
      expect(t.answerKey).toBe(bad.join(','));
    }
  });

  it('ai.early-stopping: лучшая эпоха — минимум val_loss до остановки', () => {
    for (const seed of SEEDS) {
      const t = earlyStopping.generate(seed);
      const val = [...t.code!.matchAll(/^\s*\d+\s*\|\s*[\d.]+\s*\|\s*([\d.]+)\s*$/gm)].map((m) => Number(m[1]));
      const { stopAt } = t.params as { stopAt: number };
      const seen = val.slice(0, stopAt);
      expect(Number(t.answerKey)).toBe(seen.indexOf(Math.min(...seen)) + 1);
    }
  });

  it('ai.circuit-breaker: до провайдера доходит не больше запросов, чем всего, и хотя бы failN', () => {
    for (const seed of SEEDS) {
      const t = circuitBreaker.generate(seed);
      const n = t.code!.split('\n').length;
      const k = Number(t.answerKey);
      expect(k).toBeLessThanOrEqual(n);
      expect(k).toBeGreaterThanOrEqual(Math.min(n, (t.params as { failN: number }).failN));
    }
  });
});

describe('направление без генераторов', () => {
  it('engineering: теста нет, requireGenerators падает с понятной ошибкой', () => {
    expect(hasTestFor('ai')).toBe(true);
    expect(hasTestFor('backend')).toBe(true);
    if (generatorsFor('engineering').length === 0) {
      expect(hasTestFor('engineering')).toBe(false);
      expect(() => requireGenerators('engineering')).toThrow(NoGeneratorsError);
      expect(() => requireGenerators('engineering')).toThrow(/Engineering пока недоступен/);
    }
  });
});
