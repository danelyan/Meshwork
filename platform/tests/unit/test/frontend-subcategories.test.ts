// Frontend по подкатегориям (ADR-0003, дополнение 10.10): разметка, число семейств, детерминизм, 300 seed
// и сверка ключей независимым решением (исполнение кода в node:vm, jsdom, прямые модели без кода генератора).
import { createContext, runInContext } from "node:vm";

import { JSDOM } from "jsdom";

import { checkAnswer } from "@/server/test/answers";
import { generatorsFor } from "@/server/test/generators";
import * as UI from "@/server/test/generators/frontend-ui-app";
import * as DS from "@/server/test/generators/frontend-design-system";
import * as WP from "@/server/test/generators/frontend-web-perf";
import * as RT from "@/server/test/generators/frontend-realtime";
import type { TaskGenerator } from "@/server/test/types";

const SUBS = [
  "frontend.ui-app",
  "frontend.design-system",
  "frontend.web-perf",
  "frontend.realtime",
];
const generatorsForSubcategory = (sub: string) =>
  generatorsFor("frontend").filter((g) => g.subcategoryId === sub);
const SEEDS = Array.from({ length: 300 }, (_, i) => i * 7919 + 13);

describe("разметка frontend по подкатегориям", () => {
  it("у каждого семейства есть subcategoryId из четырёх подкатегорий", () => {
    for (const g of generatorsFor("frontend"))
      expect(SUBS, g.id).toContain(g.subcategoryId);
  });
  for (const sub of SUBS) {
    it(`${sub}: не меньше 8 семейств, и Junior, и Middle (по 4+), a и b в допустимых диапазонах`, () => {
      const gs = generatorsForSubcategory(sub);
      expect(gs.length).toBeGreaterThanOrEqual(8);
      expect(
        gs.filter((g) => g.grade === "junior").length,
      ).toBeGreaterThanOrEqual(4);
      expect(
        gs.filter((g) => g.grade === "middle").length,
      ).toBeGreaterThanOrEqual(4);
      expect(new Set(gs.map((g) => g.id)).size).toBe(gs.length);
      for (const g of gs) {
        expect(g.a, g.id).toBeGreaterThanOrEqual(1.0);
        expect(g.a, g.id).toBeLessThanOrEqual(1.4);
        if (g.grade === "junior") {
          expect(g.b, g.id).toBeGreaterThanOrEqual(-1.5);
          expect(g.b, g.id).toBeLessThanOrEqual(-0.4);
        } else {
          expect(g.b, g.id).toBeGreaterThanOrEqual(0.2);
          expect(g.b, g.id).toBeLessThanOrEqual(0.9);
        }
      }
    });
  }
});

describe("300 seed: детерминизм, ключ принимается проверкой, вариативность", () => {
  for (const g of generatorsFor("frontend")) {
    it(g.id, () => {
      const seen = new Set<string>();
      for (const seed of SEEDS) {
        const inst = g.generate(seed);
        expect(g.generate(seed)).toEqual(inst);
        expect(inst.prompt.trim().length).toBeGreaterThan(10);
        expect(inst.answerKey.length).toBeGreaterThan(0);
        // ключ принимается проверкой и в записи по формату (ключ уникален: вариант единственный либо только форматные синонимы)
        for (const k of inst.answerKey.split("|"))
          expect(checkAnswer(g.format, k, inst.answerKey), `${seed}`).toBe(
            true,
          );
        if (g.format === "line") {
          const n = Number(inst.answerKey);
          expect(
            Number.isInteger(n) && n >= 1 && n <= inst.code!.split("\n").length,
            `${g.id} ${seed}`,
          ).toBe(true);
        }
        seen.add(`${inst.prompt}\n${inst.code ?? ""}`);
      }
      expect(seen.size, `${g.id}: разных экземпляров`).toBeGreaterThanOrEqual(
        10,
      );
    });
  }
});

// ---------------------------------------------------------------------------------------------------
// Вспомогательное: исполнение кода
// ---------------------------------------------------------------------------------------------------

function run(code: string, globals: Record<string, unknown>): void {
  const ctx = createContext(globals);
  runInContext(code, ctx, { timeout: 1000 });
}

const each = (
  g: TaskGenerator,
  fn: (inst: ReturnType<TaskGenerator["generate"]>, seed: number) => void,
  seeds = SEEDS,
) => {
  for (const seed of seeds) fn(g.generate(seed), seed);
};

// ---------------------------------------------------------------------------------------------------
// ui-app
// ---------------------------------------------------------------------------------------------------

describe("ключи ui-app", () => {
  it("fe.form-validation: исполнение validate(form)", () => {
    each(UI.formValidation, (inst, seed) => {
      let got: string[] = [];
      run(inst.code!, { console: { log: (v: string[]) => (got = v) } });
      expect(got.length).toBeGreaterThan(0);
      expect([...got].sort().join(","), `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it("fe.route-match: независимое ранжирование (сегментное сравнение классов)", () => {
    const cls = (seg: string) =>
      seg === "*" ? 0 : seg.startsWith(":") ? 1 : 2;
    each(UI.routeMatch, (inst, seed) => {
      const routes = [...inst.code!.matchAll(/path="([^"]+)"/g)].map(
        (m) => m[1]!,
      );
      const url = /Пользователь открыл адрес (\S+)\./.exec(inst.prompt)![1]!;
      const u = url.split("/").filter(Boolean);
      // совпадение: статические сегменты равны, :x заменяет один сегмент, * забирает остаток
      const matched = routes.filter((r) => {
        const rs = r.split("/").filter(Boolean);
        for (let i = 0; i < rs.length; i++) {
          if (rs[i] === "*") return true;
          if (i >= u.length) return false;
          if (!rs[i]!.startsWith(":") && rs[i] !== u[i]) return false;
        }
        return rs.length === u.length;
      });
      // сравнение: больше статических сегментов, затем больше динамических, затем без splat
      const rank = (r: string) => {
        const rs = r.split("/").filter(Boolean);
        return [
          rs.filter((s) => cls(s) === 2).length,
          rs.filter((s) => cls(s) === 1).length,
          rs.includes("*") ? 0 : 1,
        ];
      };
      const best = [...matched].sort((x, y) => {
        const a = rank(x);
        const b = rank(y);
        for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i]! - a[i]!;
        return 0;
      })[0]!;
      expect(best, `seed ${seed} ${url} ${routes.join(" ")}`).toBe(
        inst.answerKey,
      );
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// design-system
// ---------------------------------------------------------------------------------------------------

describe("ключи design-system", () => {
  it("fe.tokens-resolve: разбор CSS и цепочка предков", () => {
    each(DS.tokensResolve, (inst, seed) => {
      const css = inst.code!.split("\n\n")[0]!;
      const decl = (sel: string) => {
        const line = css.split("\n").find((l) => l.startsWith(sel + " "))!;
        return /--accent:\s*([a-z]+);/.exec(line)?.[1];
      };
      const fb = /var\(--accent,\s*([a-z]+)\)/.exec(css)![1]!;
      const chain = [".btn", ".card", ".theme", ":root"]; // ближайший предок первым; .sidebar не предок
      const found = chain.map(decl).find((v) => v !== undefined) ?? fb;
      expect(found, `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it("fe.focus-trap: jsdom определяет доступность для Tab (tabIndex ≥ 0 и не disabled)", () => {
    each(DS.focusTrap, (inst, seed) => {
      const dom = new JSDOM(`<body>${inst.code}</body>`);
      const els = [
        ...dom.window.document.querySelectorAll("[id]"),
      ] as HTMLElement[];
      const tab = els.filter(
        (e) =>
          e.tabIndex >= 0 &&
          !(e as HTMLButtonElement).disabled &&
          !(e.tagName === "A" && !e.hasAttribute("href")),
      );
      const keys = /Нажаты клавиши по порядку: ([^.]+)\. Какой/
        .exec(inst.prompt)![1]!
        .split(", ");
      let pos = 0;
      for (const k of keys)
        pos = (pos + (k === "Shift+Tab" ? tab.length - 1 : 1)) % tab.length;
      expect(tab[pos]!.id, `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it("fe.variant-resolve: исполнение конфигурации и отдельный резолвер", () => {
    each(DS.variantResolve, (inst, seed) => {
      const [cfgSrc, jsx] = inst.code!.split("\n\n");
      type Cfg = {
        base: Record<string, number>;
        variants: Record<string, Record<string, Record<string, number>>>;
        compound: {
          size: string;
          tone: string;
          style: Record<string, number>;
        }[];
        defaults: { size: string; tone: string };
      };
      const ctx = createContext({});
      runInContext(cfgSrc!.replace("const button =", "globalThis.out ="), ctx);
      const cfg = (ctx as unknown as { out: Cfg }).out;
      const props: Record<string, string> = Object.fromEntries(
        [...jsx!.matchAll(/(\w+)="(\w+)"/g)].map((m) => [m[1]!, m[2]!]),
      );
      const sel = {
        size: props.size ?? cfg.defaults.size,
        tone: props.tone ?? cfg.defaults.tone,
      };
      const layers = [
        cfg.base,
        cfg.variants.size![sel.size]!,
        cfg.variants.tone![sel.tone]!,
        ...cfg.compound
          .filter((c) => c.size === sel.size && c.tone === sel.tone)
          .map((c) => c.style),
      ];
      const prop = /Чему равно (\w+) у кнопки/.exec(inst.prompt)![1]!;
      let val: number | undefined;
      for (const l of layers) if (l[prop] !== undefined) val = l[prop];
      expect(String(val), `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it("fe.semver-release: классификация по ключевым словам и сброс младших частей", () => {
    each(DS.semverRelease, (inst, seed) => {
      const [maj, min, pat] = /версии (\d+)\.(\d+)\.(\d+)\./
        .exec(inst.prompt)!
        .slice(1)
        .map(Number) as [number, number, number];
      const lines = inst.code!.split("\n");
      const isMajor = (l: string) =>
        /удалён|переименован|обязательным|больше не/.test(l);
      const isMinor = (l: string) => /добавлен|deprecated/.test(l);
      const next = lines.some(isMajor)
        ? `${maj + 1}.0.0`
        : lines.some(isMinor)
          ? `${maj}.${min + 1}.0`
          : `${maj}.${min}.${pat + 1}`;
      expect(next, `seed ${seed}`).toBe(inst.answerKey);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// web-perf
// ---------------------------------------------------------------------------------------------------

describe("ключи web-perf", () => {
  it("fe.cache-control: модель «свежо до момента X»", () => {
    each(WP.cacheControl, (inst, seed) => {
      const header = /«Cache-Control: ([^»]+)»/.exec(inst.prompt)![1]!;
      const times = /в секунды: ([\d, ]+) \(/
        .exec(inst.prompt)![1]!
        .split(", ")
        .map(Number);
      const maxAge = /max-age=(\d+)/.exec(header)?.[1];
      const cacheable =
        !/no-store|no-cache/.test(header) && maxAge !== undefined;
      let freshUntil = -1;
      let hits = 0;
      for (const t of times) {
        if (cacheable && t < freshUntil) continue;
        hits++;
        freshUntil = t + Number(maxAge ?? 0);
      }
      expect(String(hits), `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it("fe.swr-cache: интервальная модель", () => {
    each(WP.swrCache, (inst, seed) => {
      const [maxAge] = /max-age=(\d+), stale-while-revalidate=(\d+)/
        .exec(inst.prompt)!
        .slice(1)
        .map(Number) as [number, number];
      const times = /в секунды: ([\d, ]+)\./
        .exec(inst.prompt)![1]!
        .split(", ")
        .map(Number);
      // свежесть до lastContact + maxAge; любой запрос позже уходит на сервер (в окне swr - в фоне, дальше - блокирующе)
      let freshUntil = times[0]! + maxAge;
      let hits = 1;
      for (const t of times.slice(1)) {
        if (t < freshUntil) continue;
        hits++;
        freshUntil = t + maxAge;
      }
      expect(String(hits), `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it("fe.script-order: двухфазная модель по тегам", () => {
    each(WP.scriptOrder, (inst, seed) => {
      const tags = [...inst.code!.matchAll(/<script[^>]*>.*?<\/script>/g)].map(
        (m) => m[0],
      );
      const info = tags.map((t) => ({
        name: /src="(\w)\.js"/.exec(t)?.[1] ?? /log\('(\w)'\)/.exec(t)![1]!,
        late: /\sdefer\s|type="module"/.test(t),
      }));
      const order = [
        ...info.filter((i) => !i.late),
        ...info.filter((i) => i.late),
      ]
        .map((i) => i.name)
        .join(",");
      expect(order, `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it("fe.cls-image-line: jsdom ищет <img> без width+height и без aspect-ratio", () => {
    each(WP.clsImageLine, (inst, seed) => {
      const lines = inst.code!.split("\n");
      const bad = lines
        .map((l, i) => ({ l, i: i + 1 }))
        .filter(({ l }) => l.trim().startsWith("<img"))
        .filter(({ l }) => {
          const img = new JSDOM(l).window.document.querySelector("img")!;
          const hasSize =
            img.hasAttribute("width") && img.hasAttribute("height");
          const hasRatio = /aspect-ratio/.test(img.getAttribute("style") ?? "");
          return !hasSize && !hasRatio;
        });
      expect(bad.length, `seed ${seed}`).toBe(1);
      expect(String(bad[0]!.i)).toBe(inst.answerKey);
    });
  });

  it("fe.critical-path: рекурсивная длина самой длинной цепочки", () => {
    each(WP.criticalPath, (inst, seed) => {
      const rows = inst.code!.split("\n").map((l) => {
        const m = /^(\S+)\s+(\d+) мс\s+(.*)$/.exec(l)!;
        return {
          name: m[1]!,
          ms: Number(m[2]),
          parent: /подключён из (\S+)/.exec(m[3]!)?.[1],
        };
      });
      const total = (r: (typeof rows)[number]): number =>
        r.ms + (r.parent ? total(rows.find((x) => x.name === r.parent)!) : 0);
      expect(String(Math.max(...rows.map(total))), `seed ${seed}`).toBe(
        inst.answerKey,
      );
    });
  });

  it("fe.memo-renders: сравнение props по Object.is на таблице идентичностей", () => {
    each(WP.memoRenders, (inst, seed) => {
      const propLines = inst
        .code!.split("\n")
        .filter((l) => /^ {4}\w+=/.test(l));
      expect(propLines).toHaveLength(3);
      const events = /обновления состояния: ([^.]+)\./
        .exec(inst.prompt)![1]!
        .split(", ");
      // идентичность значения пропа на рендере r: новый объект каждый раз, зависит от tick, либо постоянная
      const value = (line: string, render: number, tick: number) => {
        if (
          /\(\) =>|\{\{|\.slice\(\)\}$/.test(line.trim()) &&
          !/useMemo/.test(line)
        )
          return Symbol(`${render}`);
        if (/\[tick\]|\+ tick/.test(line)) return `t${tick}`;
        return "const";
      };
      let tick = 0;
      let prev = propLines.map((l) => value(l, 0, tick));
      let renders = 1;
      events.forEach((e, i) => {
        if (e === "setTick") tick++;
        const cur = propLines.map((l) => value(l, i + 1, tick));
        if (cur.some((v, j) => !Object.is(v, prev[j]))) renders++;
        prev = cur;
      });
      expect(String(renders), `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it("fe.bundle-initial: разбор текста модулей и обход графа", () => {
    each(WP.bundleInitial, (inst, seed) => {
      const blocks = inst.code!.split("\n\n");
      const size = new Map<string, number>();
      const stat = new Map<string, string[]>();
      for (const b of blocks) {
        const head = /^\/\/ (\w+)\.ts/.exec(b)![1]!;
        size.set(head, Number(/ - (\d+) кБ/.exec(b)?.[1] ?? 0));
        stat.set(
          head,
          [...b.matchAll(/^import \{ x \} from '\.\/(\w+)';$/gm)].map(
            (m) => m[1]!,
          ),
        );
      }
      const seen = new Set<string>();
      const walk = (m: string) => {
        for (const t of stat.get(m) ?? []) {
          if (seen.has(t)) continue;
          seen.add(t);
          walk(t);
        }
      };
      walk("index");
      expect(
        String([...seen].reduce((s, m) => s + size.get(m)!, 0)),
        `seed ${seed}`,
      ).toBe(inst.answerKey);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// realtime
// ---------------------------------------------------------------------------------------------------

/** Мини-браузер: WebSocket с состояниями и очередь событий по времени. */
function runWs(code: string, serverSendsMessage: boolean): number[] {
  const log: unknown[] = [];
  type Task = { at: number; n: number; fn: () => void };
  const queue: Task[] = [];
  let now = 0;
  let n = 0;
  const later = (ms: number, fn: () => void) =>
    queue.push({ at: now + ms, n: n++, fn });
  class FakeWS {
    readyState = 0;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((e: unknown) => void) | null = null;
    listeners: Record<string, (() => void)[]> = {};
    cancelled = false;
    constructor() {
      later(10, () => {
        if (this.cancelled) return;
        this.readyState = 1;
        this.onopen?.();
        (this.listeners.open ?? []).forEach((f) => f());
        if (serverSendsMessage) later(1, () => this.onmessage?.({}));
      });
    }
    addEventListener(t: string, f: () => void) {
      (this.listeners[t] ??= []).push(f);
    }
    close() {
      if (this.readyState >= 2) return;
      if (this.readyState === 0) this.cancelled = true;
      this.readyState = 2;
      later(5, () => {
        this.readyState = 3;
        this.onclose?.();
        (this.listeners.close ?? []).forEach((f) => f());
      });
    }
  }
  run(code, {
    WebSocket: FakeWS,
    log: (v: unknown) => log.push(v),
    setTimeout: (f: () => void, ms: number) => later(ms, f),
  });
  while (queue.length > 0) {
    queue.sort((a, b) => a.at - b.at || a.n - b.n);
    const t = queue.shift()!;
    now = t.at;
    t.fn();
  }
  return log.filter((v): v is number => typeof v === "number");
}

describe("ключи realtime", () => {
  it("fe.ws-readystate: модель WebSocket с очередью событий", () => {
    each(RT.wsReadystate, (inst, seed) => {
      const msg = inst.code!.includes("onmessage");
      expect(runWs(inst.code!, msg).join(","), `seed ${seed}`).toBe(
        inst.answerKey,
      );
    });
  });

  it("fe.backoff-total: исполнение кода с поддельными таймером и сокетом", () => {
    each(RT.backoffTotal, (inst, seed) => {
      const outcomes = /Результаты попыток по порядку: ([^.]+)\./
        .exec(inst.prompt)![1]!
        .split(", ")
        .map((s) => s.includes("успех"));
      let total = 0;
      let ws: { onopen?: () => void; onclose?: () => void } = {};
      const ctx = createContext({
        URL: "wss://x",
        WebSocket: function () {
          ws = {};
          return ws;
        },
        setTimeout: (_f: () => void, ms: number) => (total += ms),
      });
      runInContext(inst.code!, ctx);
      runInContext("connect()", ctx);
      for (let i = 0; i < outcomes.length - 1; i++) {
        // сокет, созданный connect(), лежит в глобальной ws контекста
        const cur = runInContext("ws", ctx) as typeof ws;
        if (outcomes[i]) cur.onopen!();
        cur.onclose!();
        runInContext("connect()", ctx);
      }
      expect(String(total), `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it("fe.pubsub-log: реальное исполнение", () => {
    each(RT.pubsubLog, (inst, seed) => {
      const out: string[] = [];
      run(inst.code!, { log: (s: string) => out.push(s) });
      expect(out.length > 0 ? out.join(",") : "(пусто)", `seed ${seed}`).toBe(
        inst.answerKey,
      );
    });
  });

  it("fe.sse-resume: разбор потока по строкам", () => {
    each(RT.sseResume, (inst, seed) => {
      const [received] = inst.code!.split("\n--- соединение оборвалось ---");
      // независимый парсер: события разделены пустой строкой, «id» применяется при завершении события
      let lastId: string | undefined;
      let pendingId: string | undefined;
      let hasData = false;
      for (const line of received!.split("\n")) {
        if (line === "") {
          if (hasData) lastId = pendingId ?? lastId;
          hasData = false;
          continue;
        }
        const [field, ...rest] = line.split(": ");
        if (field === "id") pendingId = rest.join(": ");
        if (field === "data") hasData = true;
      }
      expect(lastId, `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it("fe.seq-reorder: наибольший непрерывный префикс из полученных", () => {
    each(RT.seqReorder, (inst, seed) => {
      const start = Number(/let expected = (\d+);/.exec(inst.code!)![1]);
      const arrival = /таком порядке seq: ([\d, ]+)$/
        .exec(inst.code!)![1]!
        .split(", ")
        .map(Number);
      const prefixApplied = (k: number) => {
        const got = new Set(arrival.slice(0, k));
        let e = start;
        while (got.has(e)) e++;
        return e - start;
      };
      let expected: number;
      if (inst.prompt.startsWith("Сколько сообщений останется"))
        expected = new Set(arrival).size - prefixApplied(arrival.length);
      else if (inst.prompt.startsWith("Сколько сообщений будет применено"))
        expected = prefixApplied(
          Number(/пакета № (\d+)/.exec(inst.prompt)![1]),
        );
      else expected = start + prefixApplied(arrival.length) - 1;
      expect(String(expected), `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it("fe.optimistic-queue: пересчёт очереди после каждого ответа", () => {
    each(RT.optimisticQueue, (inst, seed) => {
      const start = Number(/на экране: (\d+)/.exec(inst.code!)![1]);
      const ops = [...inst.code!.matchAll(/^([A-Z]): ([+×])(\d+)$/gm)].map(
        (m) => ({ id: m[1]!, mul: m[2] === "×", k: Number(m[3]) }),
      );
      const resp = /Ответы сервера пришли в порядке: (.+)$/m
        .exec(inst.code!)![1]!
        .split(", ")
        .map((s) => ({ id: s[0]!, ok: s.endsWith("успех") }));
      const k = Number(/ответа № (\d+)/.exec(inst.prompt)![1]);
      let queue = [...ops];
      for (const r of resp.slice(0, k))
        if (!r.ok) queue = queue.filter((o) => o.id !== r.id);
      const val = queue.reduce((v, o) => (o.mul ? v * o.k : v + o.k), start);
      expect(String(val), `seed ${seed}`).toBe(inst.answerKey);
    });
  });

  it("fe.conflict-merge: сортировка правок по убыванию ts", () => {
    each(RT.conflictMerge, (inst, seed) => {
      const edits = inst.code!.split("\n").map((l) => {
        const m = /клиент (\w)\s+поле (\w+)\s+ts=(\d+)/.exec(l)!;
        return { c: m[1]!, f: m[2]!, ts: Number(m[3]) };
      });
      const seen = new Set<string>();
      let fromB = 0;
      for (const e of [...edits].sort((a, b) => b.ts - a.ts)) {
        if (seen.has(e.f)) continue;
        seen.add(e.f);
        if (e.c === "B") fromB++;
      }
      expect(String(fromB), `seed ${seed}`).toBe(inst.answerKey);
    });
  });
});
