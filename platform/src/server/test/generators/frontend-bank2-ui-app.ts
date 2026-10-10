// Расширенный банк frontend.ui-app: +3 Junior, +5 Middle, +4 Senior (решение владельца 11.10).
// Ключ считает код генератора по модели, описанной в условии; a, b — ПРЕДЛОЖЕНИЕ.
import { createRng } from '../rng';
import type { TaskInstance } from '../types';
import { fam, UI } from './frontend-bank2-util';

// --- Junior ---------------------------------------------------------------------------

export const listChain = fam({
  id: 'fe.b2-list-chain',
  sub: UI,
  grade: 'junior',
  title: 'Цепочка методов массива',
  catalogIds: ['fe.js-core', 'fe.components'],
  a: 1.2,
  b: -1.0,
  space: 5e4,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const t = rng.int(3, 8);
    const k = rng.int(2, 4);
    const xs = Array.from({ length: rng.int(5, 8) }, () => rng.int(1, 12));
    xs[0] = t + rng.int(1, 4);
    const mapped = xs.filter((x) => x > t).map((x) => x * k);
    const op = rng.pick(['sum', 'len', 'max'] as const);
    const ans = op === 'sum' ? mapped.reduce((p, c) => p + c, 0) : op === 'len' ? mapped.length : Math.max(...mapped);
    const tail = { sum: '.reduce((a, b) => a + b, 0)', len: '.length', max: '' }[op];
    const last = op === 'max' ? `console.log(Math.max(...list));` : `console.log(list${tail});`;
    return {
      prompt: 'Какое число выведет код? Так цепочка методов обычно строит данные для списка в интерфейсе.',
      code: [`const xs = [${xs.join(', ')}];`, `const list = xs.filter((x) => x > ${t}).map((x) => x * ${k});`, last].join('\n'),
      answerHint: 'число',
      answerKey: String(ans),
      explanation: `filter оставляет элементы больше ${t}: ${xs.filter((x) => x > t).join(', ')}; map умножает на ${k}: ${mapped.join(', ')}. Результат ${ans}.`,
      params: { xs: xs.join(','), t, k, op },
    };
  },
});

const FALSY_POOL: Array<{ src: string; v: unknown }> = [
  { src: '0', v: 0 }, { src: '1', v: 1 }, { src: '5', v: 5 }, { src: "''", v: '' }, { src: 'NaN', v: NaN },
  { src: 'null', v: null }, { src: 'false', v: false }, { src: 'undefined', v: undefined }, { src: "'0'", v: '0' },
  { src: "'ok'", v: 'ok' }, { src: '[]', v: [] },
];

export const falsyRender = fam({
  id: 'fe.b2-falsy-render',
  sub: UI,
  grade: 'junior',
  title: 'Условный рендер и нули',
  catalogIds: ['fe.components', 'fe.render-lifecycle'],
  a: 1.2,
  b: -0.9,
  space: 1e4,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const weighted = [...FALSY_POOL, FALSY_POOL[0]!, FALSY_POOL[0]!, FALSY_POOL[4]!];
    const vals = Array.from({ length: rng.int(8, 18) }, () => rng.pick(weighted));
    // React не рисует false, null, undefined и пустую строку, но рисует числа, в том числе 0 и NaN.
    const bad = vals.filter((x) => x.v === 0 || Number.isNaN(x.v));
    const nodes = vals.filter((x) => Boolean(x.v)).length + bad.length; // [] истинно: даёт <b>
    return {
      prompt: 'Компонент для каждого значения v из списка выводит {v && <b>ok</b>}. Сколько всего узлов (элементов <b> и текстовых узлов «0» или «NaN») появится в разметке?',
      code: `const values = [${vals.map((x) => x.src).join(', ')}];`,
      answerHint: 'число',
      answerKey: String(nodes),
      explanation: 'Оператор && возвращает первый ложный операнд. React не рисует false, null, undefined и «», но числа 0 и NaN выводит как текст. Узлы дают истинные значения (<b>) и числа 0 и NaN (текст).',
      params: { values: vals.map((x) => x.src).join(',') },
    };
  },
});

export const spreadMerge = fam({
  id: 'fe.b2-spread-merge',
  sub: UI,
  grade: 'junior',
  title: 'Слияние настроек через spread',
  catalogIds: ['fe.js-core', 'fe.components'],
  format: 'text',
  a: 1.2,
  b: -0.7,
  space: 3e4,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const keys = ['theme', 'size', 'rounded'];
    const dict: Record<string, string[]> = { theme: ['light', 'dark', 'blue'], size: ['sm', 'md', 'lg'], rounded: ['true', 'false'] };
    const defaults: Record<string, string> = {};
    const props: Record<string, string | undefined> = {};
    const src: Record<string, string> = {};
    for (const k of keys) {
      defaults[k] = rng.pick(dict[k]!);
      const kind = rng.pick(['absent', 'undef', 'value'] as const);
      if (kind === 'undef') props[k] = undefined;
      else if (kind === 'value') props[k] = rng.pick(dict[k]!);
      src[k] = kind === 'absent' ? '' : kind === 'undef' ? `${k}: undefined` : `${k}: '${props[k]}'`;
    }
    const defSrc = keys.map((k) => `${k}: '${defaults[k]}'`).join(', ');
    const propSrc = keys.map((k) => src[k]!).filter(Boolean).join(', ');
    const merged: Record<string, unknown> = { ...defaults, ...props };
    return {
      prompt: `Что выведет код? Отсутствующее значение выводится как undefined.`,
      code: [`const defaults = { ${defSrc} };`, `const props = { ${propSrc} };`, `const cfg = { ...defaults, ...props };`, 'console.log(cfg.theme + "/" + cfg.size + "/" + cfg.rounded);'].join('\n'),
      answerHint: 'значение',
      answerKey: keys.map((k) => String(merged[k])).join('/'),
      explanation: 'Spread копирует все собственные ключи, и ключ со значением undefined затирает значение по умолчанию; отсутствующий ключ ничего не меняет.',
      params: { defaults: defSrc, props: propSrc },
    };
  },
});

// --- Middle ---------------------------------------------------------------------------

export const reducerTrace = fam({
  id: 'fe.b2-reducer-trace',
  sub: UI,
  grade: 'middle',
  title: 'Состояние после цепочки действий редьюсера',
  catalogIds: ['fe.state-mgmt', 'fe.components'],
  a: 1.2,
  b: 0.3,
  space: 1e6,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const start = rng.int(0, 9);
    const acts: Array<{ t: string; n?: number }> = Array.from({ length: rng.int(6, 9) }, () => {
      const t = rng.pick(['inc', 'dec', 'add', 'double', 'reset', 'dec', 'add']);
      return t === 'add' ? { t, n: rng.int(2, 7) } : { t };
    });
    const reduce = (s: number, a: { t: string; n?: number }) => {
      switch (a.t) {
        case 'inc': return s + 1;
        case 'dec': return Math.max(0, s - 1);
        case 'add': return s + (a.n ?? 0);
        case 'double': return s * 2;
        default: return start;
      }
    };
    const ans = acts.reduce(reduce, start);
    return {
      prompt: `Начальное состояние — ${start}. Действия диспетчеризуются по порядку, каждое обрабатывается редьюсером ниже. Какое число окажется в состоянии в конце?`,
      code: [
        `const initial = ${start};`,
        'function reducer(s, a) {',
        '  switch (a.type) {',
        "    case 'inc': return s + 1;",
        "    case 'dec': return Math.max(0, s - 1);",
        "    case 'add': return s + a.n;",
        "    case 'double': return s * 2;",
        '    default: return initial; // reset',
        '  }',
        '}',
        `// ${acts.map((a) => (a.t === 'add' ? `add(${a.n})` : a.t)).join(', ')}`,
      ].join('\n'),
      answerHint: 'число',
      answerKey: String(ans),
      explanation: 'Редьюсер чистый: состояние зависит только от предыдущего и действия, так что результат считается по порядку. dec не опускает ниже нуля, reset возвращает начальное.',
      params: { start, acts: acts.map((a) => a.t + (a.n ?? '')).join(',') },
    };
  },
});

export const staleClosure = fam({
  id: 'fe.b2-stale-closure',
  sub: UI,
  grade: 'middle',
  title: 'Устаревшее замыкание в интервале',
  catalogIds: ['fe.render-lifecycle', 'fe.state-mgmt'],
  a: 1.3,
  b: 0.5,
  space: 1e5,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const T = rng.pick([200, 250, 500, 1000]);
    const ticks = rng.int(3, 9);
    const E = T * ticks + rng.int(0, T - 1);
    const step = rng.int(1, 5);
    const v = rng.pick(['stale', 'fn', 'fnStep'] as const);
    const setter = { stale: `setCount(count + ${step})`, fn: `setCount((c) => c + ${step})`, fnStep: `setCount((c) => c + ${step})` }[v];
    const ans = v === 'stale' ? step : ticks * step;
    return {
      prompt: `Компонент смонтирован один раз (обычный режим, без StrictMode), пропсы не меняются. Сколько будет в count через ${E} мс после монтирования (таймеры точные, count стартует с 0, перерисовки мгновенные)?`,
      code: ['useEffect(() => {', `  const id = setInterval(() => ${setter}, ${T});`, '  return () => clearInterval(id);', '}, []);'].join('\n'),
      answerHint: 'число',
      answerKey: String(ans),
      explanation:
        v === 'stale'
          ? `Эффект выполнился один раз, замыкание видит count = 0 навсегда, и каждый тик ставит 0 + ${step} = ${step}.`
          : `Функциональная форма читает актуальное значение: тиков ${ticks}${v === 'fnStep' ? `, каждый добавляет ${step}` : ''}, итог ${ans}.`,
      params: { T, E, v, step },
    };
  },
});

export const effectOrder = fam({
  id: 'fe.b2-effect-order',
  sub: UI,
  grade: 'middle',
  title: 'Порядок эффектов и очисток',
  catalogIds: ['fe.render-lifecycle'],
  format: 'text',
  a: 1.3,
  b: 0.7,
  space: 1e5,
  time: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const eff = rng.sample(['A', 'B', 'C'], rng.int(2, 3)).sort();
    const deps: Record<string, 'none' | 'empty' | 'x'> = {};
    for (const e of eff) deps[e] = rng.pick(['none', 'empty', 'x'] as const);
    if (!Object.values(deps).includes('x')) deps[eff[0]!] = 'x';
    const xs: number[] = [rng.int(1, 3)];
    const renders = rng.int(2, 3);
    for (let i = 1; i < renders; i++) xs.push(rng.pick([xs[i - 1]!, xs[i - 1]! + 1, xs[i - 1]! + 2]));
    const dep = { none: '', empty: ', []', x: ', [x]' };
    // Запуск «empty» всегда с первым x; очистка повторно запускаемого эффекта несёт x прошлого запуска.
    const fixed: string[] = [];
    xs.forEach((x, i) => {
      const prev = xs[i - 1]!;
      const changed = eff.filter((e) => i === 0 || deps[e] === 'none' || (deps[e] === 'x' && x !== prev));
      if (i > 0) for (const e of changed) fixed.push(`-${e}${prev}`);
      for (const e of changed) fixed.push(`+${e}${x}`);
    });
    for (const e of eff) fixed.push(`-${e}${deps[e] === 'empty' ? xs[0] : xs[xs.length - 1]}`);
    return {
      prompt: `Компонент получает проп x по очереди: ${xs.join(' → ')} (по одной отрисовке), затем размонтируется. Эффект печатает «+<имя><x>» при запуске, очистка — «-<имя><x>» со значением x, с которым запускался этот эффект. Если несколько эффектов меняются в одной отрисовке: сначала все очистки по порядку объявления, потом все запуски. Перечислите вывод через запятую.`,
      code: eff.map((e) => `useEffect(() => { log('+${e}' + x); return () => log('-${e}' + x); }${dep[deps[e]!]});`).join('\n'),
      answerHint: 'через запятую, например +A1,-A1',
      answerKey: fixed.join(','),
      explanation: 'Перед повторным запуском React выполняет очистку прошлого запуска с прошлым значением x; эффект без массива зависимостей перезапускается каждую отрисовку, с [] не перезапускается, с [x] — только при смене x. При размонтировании очищаются все эффекты по порядку.',
      params: { xs: xs.join(','), deps: eff.map((e) => e + deps[e]).join(',') },
    };
  },
});

export const dirtyFields = fam({
  id: 'fe.b2-dirty-fields',
  sub: UI,
  grade: 'middle',
  title: 'Какие поля формы изменены',
  catalogIds: ['fe.forms', 'fe.state-mgmt'],
  format: 'list',
  a: 1.2,
  b: 0.3,
  space: 1e6,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const names = rng.sample(['name', 'email', 'phone', 'city', 'bio', 'site', 'role', 'zip', 'tags'], rng.int(5, 9));
    const init: Record<string, string> = {};
    for (const n of names) init[n] = rng.pick(['a', 'b', 'c']);
    const edits = Array.from({ length: rng.int(7, 16) }, () => ({ f: rng.pick(names), v: rng.pick(['a', 'b', 'c']) }));
    const cur = { ...init };
    for (const e of edits) cur[e.f] = e.v;
    const dirtyNames = names.filter((n) => cur[n] !== init[n]).sort();
    const dirty = dirtyNames.length;
    return {
      prompt: 'Поле считается изменённым (dirty), если его текущее значение отличается от начального; возврат к начальному значению снимает пометку. Назовите через запятую поля, помеченные изменёнными после всех правок (если таких нет, none).',
      code: [`initial: ${names.map((n) => `${n}="${init[n]}"`).join(' ')}`, ...edits.map((e, i) => `${i + 1}. ${e.f} := "${e.v}"`)].join('\n'),
      answerHint: 'имена полей или none',
      answerKey: dirty ? dirtyNames.join(',') : 'none',
      explanation: 'dirty сравнивает итоговое значение с начальным, а не считает количество правок: поле, возвращённое к исходному, чистое.',
      params: { names: names.join(','), edits: edits.map((e) => e.f + e.v).join(',') },
    };
  },
});

export const routeRank = fam({
  id: 'fe.b2-route-rank',
  sub: UI,
  grade: 'middle',
  title: 'Какой маршрут сработает',
  catalogIds: ['fe.routing'],
  format: 'text',
  a: 1.2,
  b: 0.4,
  space: 1e5,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const segs = ['users', 'posts', 'new', 'settings', 'edit'];
    const pickSeg = () => rng.pick(segs);
    const mk = (): string[] => {
      const n = rng.int(1, 3);
      const out: string[] = [];
      for (let i = 0; i < n; i++) out.push(rng.pick([pickSeg(), pickSeg(), ':id', ':id']));
      if (rng.int(0, 3) === 0) out.push('*');
      return out;
    };
    const routes: string[][] = [];
    for (let i = 0; i < 6; i++) routes.push(mk());
    // гарантируем, что любой адрес найдёт маршрут: общий splat
    routes[rng.int(0, 5)] = ['*'];
    const mkUrl = () => [pickSeg(), rng.pick(['42', pickSeg()]), rng.pick(['7', pickSeg()])].slice(0, rng.int(1, 3));
    const urls = [mkUrl(), mkUrl(), mkUrl()];
    const pickRoute = (urlParts: string[]) => {
      const score = (r: string[]): number => {
        let sc = 0;
        for (let i = 0; i < r.length; i++) {
          if (r[i] === '*') return sc + 1;
          if (i >= urlParts.length) return -1;
          if (r[i]!.startsWith(':')) sc += 2;
          else if (r[i] === urlParts[i]) sc += 3;
          else return -1;
        }
        return r.length === urlParts.length ? sc : -1;
      };
      const scores = routes.map(score);
      const best = Math.max(...scores);
      return { win: scores.indexOf(best) + 1, scores, best }; // при равенстве выигрывает объявленный раньше
    };
    const res = urls.map(pickRoute);
    return {
      prompt: 'Роутер выбирает среди подходящих маршрутов тот, у которого выше суммарный вес сегментов: статический сегмент — 3, параметр «:id» — 2, «*» (любой хвост, в том числе пустой) — 1. «*» допустим только последним. При равном весе выигрывает объявленный раньше. Какие по номеру маршруты обработают три адреса ниже? Ответ — три номера через запятую, в порядке адресов.',
      code: routes.map((r, i) => `${i + 1}. /${r.join('/')}`).join('\n') + '\n\n' + urls.map((u, i) => `адрес ${i + 1}: /${u.join('/')}`).join('\n'),
      answerHint: 'три номера через запятую, например 2,5,1',
      answerKey: res.map((r) => r.win).join(','),
      explanation: `Побеждают маршруты с максимальным весом: ${res.map((r, i) => `адрес ${i + 1} → ${r.win} (вес ${r.best})`).join('; ')}.`,
      params: { urls: urls.map((u) => u.join('/')).join('|'), routes: routes.map((r) => r.join('/')).join(' | ') },
    };
  },
});

// --- Senior ---------------------------------------------------------------------------

export const srSelectorRenders = fam({
  id: 'fe.b2-sr-selector-renders',
  sub: UI,
  grade: 'senior',
  title: 'Перерисовки подписчиков стора',
  catalogIds: ['fe.state-mgmt', 'fe.render-perf', 'fe.architecture'],
  taskId: 'task:find-bug',
  a: 1.2,
  b: 1.2,
  space: 1e7,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const keys = ['a', 'b', 'c'];
    const state: Record<string, number> = { a: 0, b: 0, c: 0 };
    const comps = [
      { name: 'P1', kind: 'prim', keys: [rng.pick(keys)] },
      { name: 'P2', kind: 'prim', keys: [rng.pick(keys)] },
      { name: 'O1', kind: 'obj', keys: rng.sample(keys, 2) },
      { name: 'S1', kind: 'shallow', keys: rng.sample(keys, 2) },
    ];
    const ups = Array.from({ length: rng.int(5, 8) }, () => ({ k: rng.pick(keys), v: rng.int(0, 2) }));
    let renders = 0;
    for (const u of ups) {
      const before = { ...state };
      state[u.k] = u.v;
      for (const c of comps) {
        const re = c.kind === 'obj' ? true : c.keys.some((k) => before[k] !== state[k]);
        if (re) renders++;
      }
    }
    return {
      prompt: 'Стор хранит {a, b, c} (начально все 0). Каждый вызов set публикует обновление, и подписчик заново вызывает свой селектор. Сравнение по умолчанию — Object.is: примитив перерисовывает, когда значение изменилось; селектор, возвращающий новый объект {…}, перерисовывает при каждом обновлении; «shallow» сравнивает выбранные поля по Object.is. Сколько перерисовок суммарно получат все четыре компонента от списка обновлений (первый показ не считать)?',
      code: [
        ...comps.map((c) => (c.kind === 'prim' ? `${c.name}: useStore(s => s.${c.keys[0]})` : c.kind === 'obj' ? `${c.name}: useStore(s => ({ ${c.keys.map((k) => `${k}: s.${k}`).join(', ')} }))` : `${c.name}: useStore(s => ({ ${c.keys.map((k) => `${k}: s.${k}`).join(', ')} }), shallow)`)),
        'обновления: ' + ups.map((u) => `${u.k}=${u.v}`).join(', '),
      ].join('\n'),
      answerHint: 'число',
      answerKey: String(renders),
      explanation: `Селектор-объект без shallow даёт новый объект каждый раз, поэтому O1 перерисовывается на все ${ups.length} обновлений. Остальные реагируют только на реальную смену выбранных полей. Итого ${renders}.`,
      params: { comps: comps.map((c) => c.name + c.kind + c.keys.join('')).join(','), ups: ups.map((u) => u.k + u.v).join(',') },
    };
  },
});

export const srDeferredRenders = fam({
  id: 'fe.b2-sr-deferred-renders',
  sub: UI,
  grade: 'senior',
  title: 'Отложенный рендер при быстром вводе',
  catalogIds: ['fe.render-perf', 'fe.render-lifecycle'],
  taskId: 'task:web-vitals',
  a: 1.2,
  b: 1.3,
  space: 1e7,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const R = rng.pick([120, 150, 200, 250, 300]);
    const n = rng.int(8, 22);
    const gaps = Array.from({ length: n - 1 }, () => rng.pick([30, 60, 90, 110, 140, 180, 220, 270, 320, 400]));
    // фоновый рендер начинается сразу после срочного; новое нажатие до его завершения отменяет рендер
    let done = 1; // последний рендер никто не прервёт
    for (const g of gaps) if (g >= R) done++;
    return {
      prompt: `Пользователь вводит в поиск ${n} символов; интервалы между соседними нажатиями (мс): ${gaps.join(', ')}. Срочная часть обновления (поле ввода) мгновенна. Тяжёлый список рисуется через useDeferredValue: отложенный рендер стартует сразу после срочного и занимает ${R} мс; если за это время приходит новое нажатие, текущий отложенный рендер отбрасывается и начинается новый. Сколько отложенных рендеров дойдёт до конца?`,
      answerHint: 'число',
      answerKey: String(done),
      explanation: `Рендер после нажатия заканчивается, только если до следующего нажатия прошло не меньше ${R} мс. Таких интервалов ${done - 1}, плюс последнее нажатие, после которого никто не мешает. Итого ${done}.`,
      params: { R, gaps: gaps.join(',') },
    };
  },
});

export const srFetchWaterfall = fam({
  id: 'fe.b2-sr-fetch-waterfall',
  sub: UI,
  grade: 'senior',
  title: 'Водопад запросов в дереве компонентов',
  catalogIds: ['fe.server-state', 'fe.architecture', 'fe.api-client'],
  taskId: 'task:web-vitals',
  a: 1.2,
  b: 1.4,
  space: 1e7,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const n = rng.int(5, 8);
    const names = rng.sample(['Page', 'Header', 'Feed', 'Post', 'Comments', 'Sidebar', 'Author', 'Stats', 'Tags'], n);
    const parent: number[] = [-1];
    for (let i = 1; i < n; i++) parent.push(rng.int(0, i - 1));
    const t = names.map(() => rng.int(5, 40) * 10);
    // Вложенность: компонент запрашивает данные только после того, как отрисовался его родитель (данные родителя получены).
    const finish: number[] = [];
    for (let i = 0; i < n; i++) finish.push((i === 0 ? 0 : finish[parent[i]!]!) + t[i]!);
    const waterfall = Math.max(...finish);
    const parallel = Math.max(...t);
    const useHoist = rng.int(0, 1) === 1;
    const depth = (i: number): number => (parent[i] === -1 ? 0 : 1 + depth(parent[i]!));
    return {
      prompt: `Каждый компонент запрашивает свои данные при первом рендере и не рисует детей, пока данные не пришли; рендер мгновенный, сеть не ограничена. ${useHoist ? 'Все запросы поднимают на уровень маршрута и стартуют одновременно при навигации.' : 'Запросы остаются в компонентах.'} Через сколько мс (от старта) будет готово всё дерево?`,
      code: names.map((nm, i) => `${'  '.repeat(depth(i))}${nm}  // запрос ${t[i]} мс`).join('\n'),
      answerHint: 'миллисекунды',
      answerKey: String(useHoist ? parallel : waterfall),
      explanation: useHoist
        ? `Запросы параллельны, ждём самый долгий: ${parallel} мс.`
        : `Запрос ребёнка стартует только после данных родителя, поэтому время — самая длинная цепочка от корня: ${waterfall} мс.`,
      params: { parent: parent.join(','), t: t.join(','), useHoist },
    };
  },
});

export const srErrorBoundary = fam({
  id: 'fe.b2-sr-error-boundary',
  sub: UI,
  grade: 'senior',
  title: 'Границы ошибок и что останется на экране',
  catalogIds: ['fe.components', 'fe.architecture', 'fe.render-lifecycle'],
  taskId: 'task:find-bug',
  a: 1.1,
  b: 1.1,
  space: 1e7,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const n = rng.int(8, 11);
    const uniq = ['App', ...rng.sample(['Nav', 'Feed', 'Card', 'Chart', 'Table', 'Row', 'Menu', 'Modal', 'Form', 'List', 'Item'], n - 1)];
    const parent: number[] = [-1];
    for (let i = 1; i < n; i++) parent.push(i === 2 ? 1 : rng.int(0, i - 1));
    // граница на корне убрала бы всё дерево, поэтому границы — внутренние узлы с потомками
    const inner = Array.from({ length: n - 1 }, (_, i) => i + 1).filter((i) => parent.includes(i));
    const boundary = new Set<number>(rng.sample(inner, Math.min(inner.length, rng.int(2, 3))));
    const inSubtree = (i: number, root: number): boolean => i === root || (parent[i]! >= 0 && inSubtree(parent[i]!, root));
    const catcher = (i: number): number => {
      for (let p = parent[i]!; p >= 0; p = parent[p]!) if (boundary.has(p)) return p;
      return -1;
    };
    const all = Array.from({ length: n - 1 }, (_, i) => i + 1);
    const covered = all.filter((i) => catcher(i) >= 0);
    const loose = all.filter((i) => catcher(i) < 0);
    const thrower = new Set<number>(rng.sample(covered, rng.int(1, 2)));
    // изредка одна из ошибок не накрыта границей: тогда уходит всё приложение
    if (loose.length && rng.int(0, 5) === 0) thrower.add(rng.pick(loose));
    const roots = [...thrower].map(catcher);
    const lost = roots.includes(-1);
    const removed = new Set<number>();
    if (!lost) for (let i = 0; i < n; i++) if (roots.some((r) => inSubtree(i, r))) removed.add(i);
    const visible = lost ? 0 : n - removed.size;
    const depth = (i: number): number => (parent[i] === -1 ? 0 : 1 + depth(parent[i]!));
    // порядок вывода — обход в глубину
    const order: number[] = [];
    const walk = (i: number) => {
      order.push(i);
      for (let j = 0; j < n; j++) if (parent[j] === i) walk(j);
    };
    walk(0);
    return {
      prompt: 'Граница ошибок ловит ошибки рендера потомков (не свои) и вместо их поддерева показывает запасной вид; сама граница и её потомки в списке на экране не считаются (остаётся только запасной вид). Ошибка без границы выше по дереву размонтирует всё приложение. Сколько компонентов из списка останется на экране после всех ошибок?',
      code: order.map((i) => `${'  '.repeat(depth(i))}${uniq[i]}${boundary.has(i) ? ' [ErrorBoundary]' : ''}${thrower.has(i) ? ' [бросает ошибку при рендере]' : ''}`).join('\n'),
      answerHint: 'число',
      answerKey: String(visible),
      explanation: lost
        ? 'Хотя бы одна ошибка не попала под границу, поэтому уходит всё приложение: 0.'
        : `Каждая ошибка уходит к ближайшей границе выше; их поддеревья заменяются запасным видом (убрано ${removed.size} из ${n}).`,
      params: { parent: parent.join(','), boundary: [...boundary].join(','), thrower: [...thrower].join(',') },
    };
  },
});

export const UI_BANK2_GENERATORS = [
  listChain, falsyRender, spreadMerge,
  reducerTrace, staleClosure, effectOrder, dirtyFields, routeRank,
  srSelectorRenders, srDeferredRenders, srFetchWaterfall, srErrorBoundary,
];
