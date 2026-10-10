// Ключи дополнительных Junior-семейств и Senior-семейств frontend: независимое решение
// (исполнение кода в node:vm, jsdom + dom-accessibility-api, компилятор TypeScript, отдельные модели).
// Семейства с реальным React (эффекты, контекст, key) - в frontend-senior-react.test.tsx.
import { createContext, runInContext } from 'node:vm';

import { computeAccessibleName } from 'dom-accessibility-api';
import { JSDOM } from 'jsdom';
import ts from 'typescript';

import * as J from '@/server/test/generators/frontend-junior-extra';
import * as S from '@/server/test/generators/frontend-senior';
import { normalizeSequence } from '@/server/test/answers';
import type { TaskGenerator } from '@/server/test/types';

const SEEDS = Array.from({ length: 300 }, (_, i) => i * 7919 + 13);
const each = (g: TaskGenerator, fn: (inst: ReturnType<TaskGenerator['generate']>, seed: number) => void) => {
  for (const seed of SEEDS) fn(g.generate(seed), seed);
};
function exec(code: string, globals: Record<string, unknown> = {}) {
  const ctx = createContext(globals);
  runInContext(code, ctx, { timeout: 1000 });
  return ctx;
}

describe('дополнительные Junior', () => {
  it('fe.controlled-input: преобразование применяется к «старое значение + символ»', () => {
    each(J.controlledInput, (inst, seed) => {
      const expr = /\(\(v\) => (.+)\)\(e\.target\.value\)/.exec(inst.code!)![1]!;
      const ctx = exec(`globalThis.h = (v) => ${expr};`);
      const h = (ctx as unknown as { h: (v: string) => string }).h;
      const typed = [...inst.prompt.matchAll(/«(.)»/g)].map((m) => m[1]!);
      let v = '';
      for (const ch of typed) v = h(v + ch);
      expect(v === '' ? '(пусто)' : v, `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it('fe.view-state: исполнение view()', () => {
    each(J.viewState, (inst, seed) => {
      let out = '';
      exec(inst.code!, { console: { log: (v: string) => (out = v) } });
      expect(out, `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it('fe.accessible-name: dom-accessibility-api (алгоритм accname)', () => {
    each(J.accessibleName, (inst, seed) => {
      const dom = new JSDOM(`<body>${inst.code}</body>`);
      const el = dom.window.document.getElementById('b')!;
      expect(normalizeSequence(computeAccessibleName(el)), `seed ${seed}`).toBe(normalizeSequence(inst.answerKey));
    });
  });

  it('fe.css-units: разбор CSS и пересчёт', () => {
    each(J.cssUnits, (inst, seed) => {
      const root = Number(/html \{ font-size: (\d+)px/.exec(inst.code!)![1]);
      const card = Number(/\.card \{ font-size: ([\d.]+)rem/.exec(inst.code!)![1]) * root;
      const m = /\.note \{ font-size: ([\d.]+)em; padding: ([\d.]+)em; margin-left: ([\d.]+)rem/.exec(inst.code!)!;
      const font = Number(m[1]) * card;
      const val = inst.prompt.includes('font-size у') ? font : inst.prompt.includes('padding') ? Number(m[2]) * font : Number(m[3]) * root;
      expect(Number(val.toFixed(4)), `seed ${seed}`).toBe(Number(inst.answerKey));
    });
  });

  it('fe.debounce-count: реальное debounce/throttle на виртуальном времени', () => {
    each(J.debounceCount, (inst, seed) => {
      const times = /моменты \(мс от начала\): ([\d, ]+)\./.exec(inst.prompt)![1]!.split(', ').map(Number);
      let now = 0;
      let calls = 0;
      const timers: { at: number; fn: () => void; id: number }[] = [];
      let nextId = 1;
      const advance = (to: number) => {
        for (;;) {
          timers.sort((a, b) => a.at - b.at);
          const t = timers[0];
          if (!t || t.at > to) break;
          timers.shift();
          now = t.at;
          t.fn();
        }
        now = to;
      };
      const ctx = exec(`${inst.code}`, {
        search: () => calls++,
        Date: { now: () => now },
        setTimeout: (fn: () => void, ms: number) => {
          const id = nextId++;
          timers.push({ at: now + ms, fn, id });
          return id;
        },
        clearTimeout: (id: number) => {
          const i = timers.findIndex((t) => t.id === id);
          if (i >= 0) timers.splice(i, 1);
        },
      });
      for (const t of times) {
        advance(t);
        runInContext('onInput()', ctx);
      }
      advance(now + 100000);
      expect(String(calls), `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it('fe.render-blocking: jsdom + правила блокировки', () => {
    each(J.renderBlocking, (inst, seed) => {
      const doc = new JSDOM(inst.code!).window.document;
      const css = [...doc.querySelectorAll('link[rel="stylesheet"]')].filter((l) => (l.getAttribute('media') ?? 'all') !== 'print').length;
      const js = [...doc.querySelectorAll('script[src]')].filter((s) => !s.hasAttribute('async') && !s.hasAttribute('defer') && s.getAttribute('type') !== 'module').length;
      expect(String(css + js), `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it('fe.ws-send-delivery: модель сокета с состояниями', () => {
    each(J.wsSendDelivery, (inst, seed) => {
      const sent: string[] = [];
      const queue: (() => void)[] = [];
      class FakeWS {
        readyState = 0;
        onopen: (() => void) | null = null;
        onclose: (() => void) | null = null;
        constructor() {
          queue.push(() => {
            this.readyState = 1;
            this.onopen?.();
          });
        }
        send(m: string) {
          if (this.readyState === 0) throw new Error('InvalidStateError');
          if (this.readyState === 1) sent.push(m);
        }
        close() {
          this.readyState = 2;
          queue.push(() => {
            this.readyState = 3;
            this.onclose?.();
          });
        }
      }
      exec(inst.code!.replace('const ws', 'var ws'), { WebSocket: FakeWS });
      while (queue.length) queue.shift()!();
      expect(sent.length ? sent.join(',') : '(пусто)', `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it('fe.chat-dedupe: исполнение', () => {
    each(J.chatDedupe, (inst, seed) => {
      let out = '';
      exec(inst.code!, { console: { log: (v: number) => (out = String(v)) } });
      expect(out, `seed ${seed}`).toBe(inst.answerKey);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// Senior
// ---------------------------------------------------------------------------------------------------

describe('Senior: ui-app', () => {
  it('fe.sr-query-cache: пошаговое время с секундной сеткой', () => {
    each(S.srQueryCache, (inst, seed) => {
      const stale = Number(/свежими (\d+) с/.exec(inst.prompt)![1]);
      const gc = Number(/через (\d+) с \(новая/.exec(inst.prompt)![1]);
      const ev = [...inst.prompt.matchAll(/(\d+) (монтирование|размонтирование)/g)].map((m) => ({ t: Number(m[1]), mount: m[2] === 'монтирование' }));
      let subs = 0;
      let fetchedAt = -Infinity; // момент загрузки; -Infinity - записи нет
      let emptySince: number | null = null;
      let fetches = 0;
      let k = 0;
      for (let t = 0; t <= ev[ev.length - 1]!.t; t++) {
        if (emptySince !== null && t - emptySince >= gc) {
          fetchedAt = -Infinity;
          emptySince = null;
        }
        while (k < ev.length && ev[k]!.t === t) {
          if (ev[k]!.mount) {
            subs++;
            emptySince = null;
            if (fetchedAt === -Infinity || t - fetchedAt >= stale) {
              fetches++;
              fetchedAt = t;
            }
          } else {
            subs--;
            if (subs === 0) emptySince = t;
          }
          k++;
        }
      }
      expect(String(fetches), `seed ${seed}`).toBe(inst.answerKey);
    });
  });
});

describe('Senior: design-system', () => {
  it('fe.sr-ts-props: компилятор TypeScript находит ровно одну строку с ошибкой', () => {
    const opts: ts.CompilerOptions = {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      types: [],
      skipLibCheck: true,
    };
    const host = ts.createCompilerHost(opts);
    for (const seed of SEEDS.slice(0, 40)) {
      const inst = S.srTsProps.generate(seed);
      const file = '/virtual/props.ts';
      const origGet = host.getSourceFile.bind(host);
      host.getSourceFile = (name, lang, ...rest) => (name === file ? ts.createSourceFile(name, inst.code!, lang) : origGet(name, lang, ...rest));
      const program = ts.createProgram([file], opts, host);
      const sf = program.getSourceFile(file)!;
      const lines = new Set(program.getSemanticDiagnostics(sf).map((d) => sf.getLineAndCharacterOfPosition(d.start!).line + 1));
      expect([...lines], `seed ${seed}\n${inst.code}`).toEqual([Number(inst.answerKey)]);
    }
  }, 180_000);

  it('fe.sr-contrast-audit: контраст по точной формуле sRGB (порог 0,04045)', () => {
    const lin = (h: string, i: number) => {
      const v = parseInt(h.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const L = (h: string) => 0.2126 * lin(h, 1) + 0.7152 * lin(h, 3) + 0.0722 * lin(h, 5);
    each(S.srContrastAudit, (inst, seed) => {
      let failing = 0;
      for (const line of inst.code!.split('\n')) {
        const m = /текст (#\w{6}) на фоне (#\w{6}), размер (\d+)px( жирный)?/.exec(line)!;
        const size = Number(m[3]);
        const large = size >= 24 || (Boolean(m[4]) && size >= 18.66);
        const [hi, lo] = [L(m[1]!), L(m[2]!)].sort((a, b) => b - a);
        const ratio = (hi! + 0.05) / (lo! + 0.05);
        if (ratio < (large ? 3 : 4.5)) failing++;
      }
      expect(String(failing), `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it('fe.sr-container-query: разбор правил и порядок в тексте', () => {
    each(S.srContainerQuery, (inst, seed) => {
      const css = inst.code!.split('\n\n')[0]!;
      const c = /@container \(min-width: (\d+)px\) \{ \.cards \{ grid-template-columns: repeat\((\d+)/.exec(css)!;
      const m = /@media \(min-width: (\d+)px\) \{ \.cards \{ grid-template-columns: repeat\((\d+)/.exec(css)!;
      const containerWins = css.indexOf('@container') > css.indexOf('@media');
      let total = 0;
      for (const p of inst.code!.matchAll(/окно (\d+)px, \.panel (\d+)px/g)) {
        const hitM = Number(p[1]) >= Number(m[1]);
        const hitC = Number(p[2]) >= Number(c[1]);
        const colsM = Number(m[2]);
        const colsC = Number(c[2]);
        if (hitM && hitC) total += containerWins ? colsC : colsM;
        else if (hitC) total += colsC;
        else if (hitM) total += colsM;
        else total += 1;
      }
      expect(String(total), `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it('fe.sr-barrel-cost: неподвижная точка по тексту модулей', () => {
    each(S.srBarrelCost, (inst, seed) => {
      const mods = new Map<string, { size: number; effect: boolean; deps: string[] }>();
      for (const m of inst.code!.matchAll(/^\/\/ (\w+)\.js - (\d+) кБ([^\n]*)$/gm)) {
        mods.set(m[1]!, {
          size: Number(m[2]),
          effect: m[3]!.includes('побочный эффект'),
          deps: /импортирует ([\w, ]+)/.exec(m[3]!)?.[1]?.split(', ') ?? [],
        });
      }
      const flag = /"sideEffects": (.+)$/m.exec(inst.code!)![1]!;
      const used = /import \{ ([\w, ]+) \} from 'ui-lib'/.exec(inst.code!)![1]!.split(', ');
      const inc = new Set(used);
      if (flag === 'true') for (const k of mods.keys()) inc.add(k);
      else if (flag.startsWith('[')) for (const f of flag.matchAll(/src\/(\w+)\.js/g)) inc.add(f[1]!);
      for (let changed = true; changed;) {
        changed = false;
        for (const k of [...inc])
          for (const d of mods.get(k)!.deps) {
            if (inc.has(d)) continue;
            inc.add(d);
            changed = true;
          }
      }
      const total = [...inc].reduce((s, k) => s + mods.get(k)!.size, 0);
      expect(String(total), `seed ${seed}`).toBe(inst.answerKey);
    });
  });
});

describe('Senior: web-perf', () => {
  it('fe.sr-render-strategy: временна́я модель по условию', () => {
    each(S.srRenderStrategy, (inst, seed) => {
      const nums = /готовы за (\d+), медленного виджета - за (\d+); загрузка и выполнение JS занимают (\d+) .*гидратация занимает (\d+)\./.exec(inst.prompt)!;
      const [main, slow, js, hydr] = nums.slice(1).map(Number) as [number, number, number, number];
      const tail = inst.prompt.slice(inst.prompt.lastIndexOf('при:'));
      let tti: number;
      if (tail.includes('CSR')) tti = js + main;
      else if (tail.includes('ожиданием')) tti = Math.max(main, slow) + js + hydr;
      else tti = Math.max(js, main) + hydr;
      expect(String(tti), `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it('fe.sr-lcp-phases: метки навигации и применённые правки', () => {
    each(S.srLcpPhases, (inst, seed) => {
      const m = /на (\d+); запрос LCP-изображения начался на (\d+); изображение загружено на (\d+); элемент отрисован на (\d+)/.exec(inst.prompt)!;
      const [ttfb, reqAt, loaded, painted] = m.slice(1).map(Number) as [number, number, number, number];
      let dTtfb = ttfb;
      let delay = reqAt - ttfb;
      let dur = loaded - reqAt;
      const render = painted - loaded;
      if (inst.prompt.includes('preload')) delay = 0;
      const q = /стало (\d+) %/.exec(inst.prompt)?.[1];
      if (q) dur = Math.round((dur * Number(q)) / 100);
      const x = /уменьшился на (\d+) мс/.exec(inst.prompt)?.[1];
      if (x) dTtfb = Math.max(100, dTtfb - Number(x));
      expect(String(dTtfb + delay + dur + render), `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it('fe.sr-cache-stale: разбор таблицы ресурсов', () => {
    each(S.srCacheStale, (inst, seed) => {
      const visit = Number(/вернулся через (\d+) с/.exec(inst.prompt)![1]);
      let stale = 0;
      for (const line of inst.code!.split('\n')) {
        if (line.includes('хеш') && line.includes('immutable')) continue;
        if (line.includes('no-cache')) continue;
        const age = Number(/max-age=(\d+)/.exec(line)![1]);
        if (line.includes(' изменён;') && visit < age) stale++;
      }
      expect(String(stale), `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it('fe.sr-memo-cost: суммирование по строкам', () => {
    each(S.srMemoCost, (inst, seed) => {
      const renders = Number(/перерисовался (\d+) раз/.exec(inst.prompt)![1]);
      const K = Number(/стоит (\d+) мс на каждый/.exec(inst.prompt)![1]);
      let total = 0;
      for (const line of inst.code!.split('\n')) {
        const R = Number(/R =\s*(\d+) мс/.exec(line)![1]);
        const changes = Number(/в (\d+) из/.exec(line)?.[1] ?? renders);
        const without = renders * R;
        const withMemo = renders * K + changes * R;
        total += without - withMemo;
      }
      expect(String(total), `seed ${seed}`).toBe(inst.answerKey);
    });
  });
});

describe('Senior: realtime', () => {
  it('fe.sr-heartbeat: пошаговые миллисекунды', () => {
    each(S.srHeartbeat, (inst, seed) => {
      const T = Number(/более (\d+) мс, клиент/.exec(inst.prompt)![1]);
      const arrivals: number[] = [];
      for (const m of inst.code!.matchAll(/ping \d+ \(на (\d+) мс\): (?:ответ потерян|pong через (\d+) мс)/g)) if (m[2]) arrivals.push(Number(m[1]) + Number(m[2]));
      let last = 0;
      let closedAt = -1;
      for (let t = 0; t < 200000 && closedAt < 0; t++) {
        if (arrivals.includes(t)) last = t;
        if (t - last === T) closedAt = t;
      }
      expect(String(closedAt), `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it('fe.sr-ot-insert: порядок вставок по исходным промежуткам', () => {
    each(S.srOtInsert, (inst, seed) => {
      const base = /документа «(\w+)»/.exec(inst.prompt)![1]!;
      const order = /принял операции в порядке: ([A-C, ]+)\./.exec(inst.prompt)![1]!.split(', ');
      const ops = new Map([...inst.code!.matchAll(/клиент (\w): вставить «(\w+)» в позицию (\d+)/g)].map((m) => [m[1]!, { text: m[2]!, pos: Number(m[3]) }]));
      let doc = '';
      for (let gap = 0; gap <= base.length; gap++) {
        for (const c of order) if (ops.get(c)!.pos === gap) doc += ops.get(c)!.text;
        if (gap < base.length) doc += base[gap];
      }
      expect(doc.toLowerCase(), `seed ${seed}`).toBe(inst.answerKey.toLowerCase());
    });
  });

  it('fe.sr-idempotent-retry: пошаговое выполнение попыток', () => {
    each(S.srIdempotentRetry, (inst, seed) => {
      const T = Number(/Таймаут запроса - (\d+) мс/.exec(inst.prompt)![1]);
      const withKey = inst.prompt.includes('одним и тем же ключом');
      let balance = Number(/Исходный баланс - (\d+)/.exec(inst.prompt)![1]);
      for (const line of inst.code!.split('\n')) {
        const amount = Number(/\+(\d+);/.exec(line)![1]);
        const tries = [...line.matchAll(/\d\) (потерян по пути|сервер отвечает через (\d+) мс)/g)].map((m) => (m[2] ? Number(m[2]) : null));
        let applied = 0;
        for (const t of tries) {
          if (t !== null) applied++;
          if (t !== null && t <= T) break;
        }
        balance += amount * (withKey ? Math.min(applied, 1) : applied);
      }
      expect(String(balance), `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it('fe.sr-replay-window: разбор условия', () => {
    each(S.srReplayWindow, (inst, seed) => {
      const rate = Number(/публикует (\d+) событий/.exec(inst.prompt)![1]);
      const [T, B] = /не старше (\d+) с и не больше (\d+) штук/.exec(inst.prompt)!.slice(1).map(Number) as [number, number];
      const gaps = /Обрывы длились \(с\): ([\d, ]+)\./.exec(inst.prompt)![1]!.split(', ').map(Number);
      const replayed = gaps.filter((d) => d <= T && rate * d <= B).reduce((s, d) => s + rate * d, 0);
      expect(String(replayed), `seed ${seed}`).toBe(inst.answerKey);
    });
  });
});
