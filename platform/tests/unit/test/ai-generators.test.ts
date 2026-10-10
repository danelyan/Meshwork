import { catalogFromFile } from '@/server/claims/catalog-file';
import { checkAnswer } from '@/server/test/answers';
import { generatorsFor, hasTestFor, NoGeneratorsError, requireGenerators } from '@/server/test/generators';
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

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

describe('генераторы ai.* (ADR 0003, дополнение 10.10)', () => {
  it('12–16 семейств, ключи ai.*, оба грейда, a/b в коридоре backend/frontend', () => {
    expect(AI_GENERATORS.length).toBeGreaterThanOrEqual(12);
    expect(AI_GENERATORS.length).toBeLessThanOrEqual(16);
    expect(generatorsFor('ai')).toHaveLength(AI_GENERATORS.length);
    for (const g of AI_GENERATORS) {
      expect(g.id).toMatch(/^ai\.[a-z0-9-]+$/);
      expect(g.taskId).toMatch(/^task:/);
      expect(g.specialization).toBe('ai');
      if (g.grade === 'junior') expect(g.b).toBeLessThan(0);
      else expect(g.b).toBeGreaterThan(0);
      expect(g.a).toBeGreaterThanOrEqual(0.8);
      expect(g.a).toBeLessThanOrEqual(1.6);
    }
    // Дозадавание Junior опирается на ≥ JUNIOR_PROBE_MAX Junior-шаблонов после основной фазы.
    expect(AI_GENERATORS.filter((g) => g.grade === 'junior').length).toBeGreaterThanOrEqual(6);
    expect(AI_GENERATORS.filter((g) => g.grade === 'middle').length).toBeGreaterThanOrEqual(6);
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
