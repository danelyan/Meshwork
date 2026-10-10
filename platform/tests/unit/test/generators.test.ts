import { createContext, runInContext, runInNewContext } from 'node:vm';

import { checkAnswer, normalizeAnswer } from '@/server/test/answers';
import { GENERATORS, generatorsFor } from '@/server/test/generators';
import { cacheConsistency } from '@/server/test/generators/backend';
import { domEvents, eventLoop, jsArrayOutput, jsClosure } from '@/server/test/generators/frontend';

const SEEDS = Array.from({ length: 150 }, (_, i) => i * 7919 + 13);

describe('банк генераторов', () => {
  it('не меньше 12 на специализацию, id уникальны, привязаны к каталогу', () => {
    expect(generatorsFor('backend').length).toBeGreaterThanOrEqual(12);
    expect(generatorsFor('frontend').length).toBeGreaterThanOrEqual(12);
    expect(new Set(GENERATORS.map((g) => g.id)).size).toBe(GENERATORS.length);
    for (const g of GENERATORS) {
      expect(g.taskId).toMatch(/^task:/);
      expect(g.catalogIds.length).toBeGreaterThan(0);
      expect(g.a).toBeGreaterThan(0);
    }
  });

  for (const g of GENERATORS) {
    describe(g.id, () => {
      it('ключ принимается проверкой, seed детерминирован, разные seed дают разные варианты', () => {
        const prompts = new Set<string>();
        for (const seed of SEEDS) {
          const inst = g.generate(seed);
          expect(inst.prompt.length).toBeGreaterThan(10);
          expect(inst.answerKey.length).toBeGreaterThan(0);
          for (const k of inst.answerKey.split('|')) expect(checkAnswer(g.format, k, inst.answerKey)).toBe(true);
          expect(normalizeAnswer(g.format, inst.answerKey.split('|')[0]!)).not.toBeNull();
          // Детерминизм
          expect(g.generate(seed)).toEqual(inst);
          prompts.add(`${inst.prompt}\n${inst.code ?? ''}`);
          if (g.format === 'line') {
            const n = Number(inst.answerKey);
            expect(n).toBeGreaterThanOrEqual(1);
            expect(n).toBeLessThanOrEqual(inst.code!.split('\n').length);
          }
        }
        expect(prompts.size).toBeGreaterThanOrEqual(10);
      });
    });
  }
});

/**
 * Реальное исполнение сгенерированного кода: console.log + фальшивые таймеры. Контекст с
 * microtaskMode 'afterEvaluate' (docs node:vm): микрозадачи контекста выполняются до возврата
 * runInContext, поэтому колбэк таймера запускается тоже внутри контекста — его микрозадачи
 * отрабатывают до следующего таймера, как в браузере.
 */
function runJsFull(code: string): string[] {
  const out: string[] = [];
  const timers: (() => void)[] = [];
  const ctx = createContext(
    {
      console: { log: (v: unknown) => out.push(String(v)) },
      setTimeout: (fn: () => void) => timers.push(fn),
      __timers: timers,
    },
    { microtaskMode: 'afterEvaluate' },
  );
  // queueMicrotask в новом контексте не определён: задаём через Promise того же контекста.
  runInContext('globalThis.queueMicrotask = (fn) => { Promise.resolve().then(fn); };', ctx);
  runInContext(code, ctx, { timeout: 1000 });
  while (timers.length > 0) runInContext('__timers.shift()()', ctx, { timeout: 1000 });
  return out;
}

describe('ключи code-output совпадают с исполнением в node:vm', () => {
  it('jsClosure', () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const inst = jsClosure.generate(seed);
      expect(runJsFull(inst.code!).join(',')).toBe(inst.answerKey);
    }
  });
  it('jsArrayOutput', () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const inst = jsArrayOutput.generate(seed);
      expect(runJsFull(inst.code!).join(',')).toBe(inst.answerKey);
    }
  });
  it('eventLoop', () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const inst = eventLoop.generate(seed);
      expect(runJsFull(inst.code!).join(',')).toBe(inst.answerKey);
    }
  });
  it('domEvents: модель фаз совпадает с jsdom-подобной реализацией', () => {
    // Мини-реализация DOM Events Level 3: capture сверху вниз, bubble снизу вверх, на target — capture раньше.
    for (const seed of SEEDS.slice(0, 60)) {
      const inst = domEvents.generate(seed);
      const js = inst.code!.split('\n\n')[1]!;
      const nodes = ['outer', 'middle', 'inner'];
      const listeners: { node: string; capture: boolean; fn: (e: { stopPropagation(): void }) => void }[] = [];
      const log: string[] = [];
      const ctx: Record<string, unknown> = { log: (s: string) => log.push(s) };
      for (const n of nodes) {
        ctx[n] = {
          addEventListener: (_t: string, fn: (e: { stopPropagation(): void }) => void, opts?: { capture?: boolean }) =>
            listeners.push({ node: n, capture: Boolean(opts?.capture), fn }),
          click: () => {
            let stopped = false;
            const e = { stopPropagation: () => (stopped = true) };
            const fire = (node: string, capture: boolean) => {
              if (stopped) return;
              for (const l of listeners) if (l.node === node && l.capture === capture) l.fn(e);
            };
            for (const x of nodes) fire(x, true);
            for (const x of [...nodes].reverse()) fire(x, false);
          },
        };
      }
      runInNewContext(js, ctx, { timeout: 1000 });
      expect(log.join(',')).toBe(inst.answerKey);
    }
  });
});

describe('инвариант выводимости ответа из условия', () => {
  it('у всех генераторов на 150 seed: условие/код непусты, number-ключ числовой', () => {
    for (const g of GENERATORS) {
      for (const seed of SEEDS) {
        const inst = g.generate(seed);
        expect(inst.prompt.trim().length, g.id).toBeGreaterThan(0);
        expect(inst.answerKey.trim().length, g.id).toBeGreaterThan(0);
        if (inst.code !== undefined) expect(inst.code.trim().length, g.id).toBeGreaterThan(0);
        if (g.format === 'number')
          for (const k of inst.answerKey.split('|')) expect(Number.isFinite(Number(k)), `${g.id} ${seed}`).toBe(true);
      }
    }
  }, 60_000);

  it('be.cache-consistency: есть начальная цена, запись и чтение до неё; ответ не всегда равен последней цене в БД', () => {
    let stale = 0;
    for (const seed of SEEDS) {
      const inst = cacheConsistency.generate(seed);
      const start = (inst.params as { start: number }).start;
      expect(inst.prompt).toContain(`цена в БД = ${start}`);
      const lines = inst.code!.split('\n');
      expect(lines[0]).toContain(`${start}`);
      const writeIdx = lines.findIndex((l) => l.includes('обновляет'));
      expect(writeIdx).toBeGreaterThan(1);
      expect(lines.slice(1, writeIdx).some((l) => l.includes('читает'))).toBe(true);
      const dbValues = lines.flatMap((l) => (l.includes('обновляет') ? [Number(l.match(/→ (\d+)/)![1])] : []));
      if (Number(inst.answerKey) !== dbValues[dbValues.length - 1]) stale++;
    }
    expect(stale).toBeGreaterThan(SEEDS.length * 0.3);
  });
});
