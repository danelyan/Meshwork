// Генераторы заданий Frontend (E-03, ADR-0002). Ключи для code-output считаются
// моделью исполнения в генераторе; юнит-тест сверяет их с реальным исполнением в node:vm.
import { createRng } from '../rng';
import type { TaskGenerator, TaskInstance } from '../types';
import { FRONTEND_BANK2_GENERATORS } from './frontend-bank2';
import { DESIGN_SYSTEM_NEW_GENERATORS } from './frontend-design-system';
import { JUNIOR_EXTRA_GENERATORS } from './frontend-junior-extra';
import { REALTIME_NEW_GENERATORS } from './frontend-realtime';
import { SENIOR_GENERATORS } from './frontend-senior';
import { UI_APP_NEW_GENERATORS } from './frontend-ui-app';
import { WEB_PERF_NEW_GENERATORS } from './frontend-web-perf';

const COLORS = ['red', 'blue', 'green', 'teal', 'orange', 'purple', 'navy', 'olive'];

// ---------------------------------------------------------------------------
// Junior
// ---------------------------------------------------------------------------

export const jsClosure: TaskGenerator = {
  id: 'fe.js-closure',
  subcategoryId: 'frontend.realtime',
  taskId: 'task:code-output',
  title: 'Что выведет код: замыкания',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.js-core', 'fe.event-loop'],
  format: 'text',
  a: 1.3,
  b: -0.6,
  paramSpace: 2e4,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const useLet = rng.int(0, 1) === 1;
    const n = rng.int(3, 4);
    const k = rng.int(2, 5);
    const start = rng.int(0, 2);
    const code = [
      `for (${useLet ? 'let' : 'var'} i = ${start}; i < ${start + n}; i++) {`,
      `  setTimeout(() => console.log(i * ${k}), 0);`,
      '}',
      `console.log('done');`,
    ].join('\n');
    const out = ['done'];
    if (useLet) for (let i = start; i < start + n; i++) out.push(String(i * k));
    else for (let i = 0; i < n; i++) out.push(String((start + n) * k));
    return {
      prompt: 'Что выведет код в консоль? Перечислите значения по порядку через запятую.',
      code,
      answerHint: 'значения через запятую',
      answerKey: out.join(','),
      explanation: useLet
        ? `«done» печатается первым: колбэки setTimeout выполняются после синхронного кода. let создаёт новую привязку i на каждую итерацию, поэтому выводятся ${out.slice(1).join(', ')}.`
        : `«done» печатается первым: колбэки setTimeout выполняются после синхронного кода. var - одна переменная на всю функцию; к моменту вызова колбэков i = ${start + n}, поэтому ${n} раза печатается ${(start + n) * k}.`,
      params: { useLet, n, k, start },
    };
  },
};

export const jsArrayOutput: TaskGenerator = {
  id: 'fe.js-array-output',
  subcategoryId: 'frontend.ui-app',
  taskId: 'task:code-output',
  title: 'Что вернёт цепочка методов',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.js-core'],
  format: 'number',
  a: 1.1,
  b: -1.5,
  paramSpace: 1e8,
  timeLimitSec: 120,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const arr = Array.from({ length: rng.int(4, 6) }, () => rng.int(1, 9));
    const mul = rng.int(2, 4);
    const thr = rng.int(5, 20);
    const kind = rng.int(0, 1);
    const code =
      kind === 0
        ? `const result = [${arr.join(', ')}]\n  .map((x) => x * ${mul})\n  .filter((x) => x > ${thr})\n  .reduce((sum, x) => sum + x, 0);\nconsole.log(result);`
        : `const result = [${arr.join(', ')}]\n  .filter((x, i) => i % 2 === 0)\n  .map((x) => x + ${mul})\n  .length;\nconsole.log(result);`;
    const value = kind === 0 ? arr.map((x) => x * mul).filter((x) => x > thr).reduce((s, x) => s + x, 0) : arr.filter((_, i) => i % 2 === 0).length;
    return {
      prompt: 'Что выведет console.log?',
      code,
      answerHint: 'число',
      answerKey: String(value),
      explanation: kind === 0 ? `map умножает каждый элемент на ${mul}, filter оставляет значения больше ${thr}, reduce складывает оставшиеся.` : 'filter по индексу оставляет элементы на чётных позициях (0, 2, 4…), map не меняет длину, .length - их число.',
      params: { arr: arr.join(','), mul, thr, kind },
    };
  },
};

export const cssSpecificity: TaskGenerator = {
  id: 'fe.css-specificity',
  subcategoryId: 'frontend.design-system',
  taskId: 'task:css-specificity',
  title: 'Какой цвет получит элемент',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.css-cascade'],
  format: 'text',
  a: 1.3,
  b: -1.05,
  paramSpace: 1e5,
  timeLimitSec: 120,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const colors = rng.sample(COLORS, 4);
    type Rule = { sel: string; spec: [number, number, number]; important?: boolean };
    const candidates: Rule[] = [
      { sel: 'p', spec: [0, 0, 1] },
      { sel: '.card', spec: [0, 1, 0] },
      { sel: 'p.card', spec: [0, 1, 1] },
      { sel: '.card.note', spec: [0, 2, 0] },
      { sel: '#intro', spec: [1, 0, 0] },
      { sel: 'section p', spec: [0, 0, 2] },
      { sel: 'section .card', spec: [0, 1, 1] },
    ];
    const rules = rng.sample(candidates, 4).map((r, i) => ({ ...r, color: colors[i]! }));
    const withImportant = rng.int(0, 2) === 0;
    if (withImportant) {
      const idx = rng.int(0, rules.length - 1);
      rules[idx]!.important = true;
    }
    const css = rules.map((r) => `${r.sel} { color: ${r.color}${r.important ? ' !important' : ''}; }`).join('\n');
    const html = '<section>\n  <p id="intro" class="card note">Текст</p>\n</section>';
    let best = rules[0]!;
    for (const r of rules) {
      const key = (x: typeof r) => (x.important ? 1 : 0) * 1e6 + x.spec[0] * 1e4 + x.spec[1] * 1e2 + x.spec[2];
      if (key(r) >= key(best)) best = r; // при равенстве побеждает последнее правило
    }
    return {
      prompt: 'Все правила подходят к элементу <p>. Какой цвет текста у него будет?',
      code: `${css}\n\n${html}`,
      answerHint: 'название цвета',
      answerKey: best.color,
      explanation: `Побеждает ${best.sel}${best.important ? ' - у него !important' : `: специфичность (${best.spec.join(',')}) выше остальных${rules.some((r) => r !== best && r.spec.join() === best.spec.join()) ? ', а при равной специфичности побеждает правило ниже по тексту' : ''}`}.`,
      params: { rules: rules.map((r) => r.sel).join('|'), withImportant },
    };
  },
};

export const cssFlex: TaskGenerator = {
  id: 'fe.css-flex',
  subcategoryId: 'frontend.design-system',
  taskId: 'task:css-layout',
  title: 'Ширина элемента во flex-контейнере',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.css-layout', 'fe.responsive'],
  format: 'number',
  a: 1.3,
  b: -0.55,
  paramSpace: 1e5,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const n = 3;
    const basis = Array.from({ length: n }, () => rng.int(1, 4) * 50);
    const grow: number[] = Array.from({ length: n }, () => rng.int(0, 2));
    if (!grow.some((g) => g > 0)) grow[rng.int(0, n - 1)] = 1;
    const sumGrow = grow.reduce((s, g) => s + g, 0);
    const free = rng.int(1, 4) * 100 * sumGrow;
    const width = basis.reduce((s, b) => s + b, 0) + free;
    const ask = rng.int(0, n - 1);
    const result = basis[ask]! + (free * grow[ask]!) / sumGrow;
    const css = [
      `.row { display: flex; width: ${width}px; }`,
      ...basis.map((b, i) => `.item-${i + 1} { flex: ${grow[i]} 0 ${b}px; }`),
    ].join('\n');
    const html = `<div class="row">\n${basis.map((_, i) => `  <div class="item-${i + 1}"></div>`).join('\n')}\n</div>`;
    return {
      prompt: `Без отступов, границ и переносов. Какой будет ширина .item-${ask + 1} в пикселях?`,
      code: `${css}\n\n${html}`,
      answerHint: 'пиксели',
      answerKey: String(result),
      explanation: `flex: grow shrink basis. Сумма basis = ${basis.reduce((s, b) => s + b, 0)}, свободное место ${free}px делится пропорционально flex-grow (сумма ${sumGrow}): .item-${ask + 1} получает ${basis[ask]} + ${free}·${grow[ask]}/${sumGrow} = ${result}.`,
      params: { basis: basis.join(','), grow: grow.join(','), free, ask },
    };
  },
};

export const htmlSemantics: TaskGenerator = {
  id: 'fe.html-semantics',
  subcategoryId: 'frontend.design-system',
  taskId: 'task:html-semantics',
  title: 'Строка с нарушением доступности',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.html-semantic', 'fe.a11y'],
  format: 'line',
  a: 1.1,
  b: -1.35,
  paramSpace: 2e4,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const bugs = [
      { good: '<img src="/logo.svg" alt="Логотип компании">', bad: '<img src="/logo.svg">', why: 'у изображения нет alt - скринридер прочитает имя файла или ничего' },
      { good: '<button type="button" onclick="open()">Открыть</button>', bad: '<div onclick="open()">Открыть</div>', why: 'кликабельный div без роли и фокуса недоступен с клавиатуры; нужна кнопка' },
      { good: '<label for="email">Почта</label>\n  <input id="email" type="email">', bad: '<span>Почта</span>\n  <input id="email" type="email">', why: 'поле без связанного label: у поля нет доступного имени' },
      { good: '<a href="/pricing">Тарифы</a>', bad: '<a onclick="go(\'/pricing\')">Тарифы</a>', why: 'ссылка без href не фокусируется и не является ссылкой для вспомогательных технологий' },
    ];
    const bugIdx = rng.int(0, bugs.length - 1);
    const order = rng.shuffle(bugs.map((_, i) => i));
    const parts = order.map((i) => (i === bugIdx ? bugs[i]!.bad : bugs[i]!.good));
    const lines = ['<header>', ...parts.map((p) => `  ${p}`).join('\n').split('\n'), '</header>'];
    const badFirst = lines.findIndex((l) => l.trim() === bugs[bugIdx]!.bad.split('\n')[0]!.trim()) + 1;
    return {
      prompt: 'В разметке ровно одно нарушение семантики/доступности. Укажите номер строки, где оно начинается.',
      code: lines.join('\n'),
      answerHint: 'номер строки',
      answerKey: String(badFirst),
      explanation: `Строка ${badFirst}: ${bugs[bugIdx]!.why}.`,
      params: { bugIdx, order: order.join(',') },
    };
  },
};

export const domEvents: TaskGenerator = {
  id: 'fe.dom-events',
  subcategoryId: 'frontend.ui-app',
  taskId: 'task:code-output',
  title: 'Порядок обработчиков события',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.dom-events', 'fe.js-core'],
  format: 'text',
  a: 1.2,
  b: -0.4,
  paramSpace: 1e4,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const nodes = ['outer', 'middle', 'inner'] as const;
    type L = { node: (typeof nodes)[number]; capture: boolean; stop: boolean };
    const listeners: L[] = nodes.map((node) => ({ node, capture: rng.int(0, 2) === 0, stop: false }));
    if (rng.int(0, 1) === 1) listeners[rng.int(0, 2)]!.stop = true;
    const lines = listeners.map(
      (l) => `${l.node}.addEventListener('click', (e) => { log('${l.node}'); ${l.stop ? 'e.stopPropagation(); ' : ''}}${l.capture ? ', { capture: true }' : ''});`,
    );
    const code = `<div id="outer"><div id="middle"><button id="inner">Кнопка</button></div></div>\n\n${lines.join('\n')}\ninner.click();`;
    // Модель: capture outer→middle→inner(target), bubble inner→middle→outer; на target capture-обработчик идёт раньше bubble.
    const out: string[] = [];
    let stopped = false;
    const run = (node: (typeof nodes)[number], capture: boolean) => {
      if (stopped) return;
      const l = listeners.find((x) => x.node === node && x.capture === capture);
      if (!l) return;
      out.push(node);
      if (l.stop) stopped = true;
    };
    for (const n of ['outer', 'middle', 'inner'] as const) run(n, true);
    for (const n of ['inner', 'middle', 'outer'] as const) run(n, false);
    return {
      prompt: 'Что выведет log при клике по кнопке? Перечислите имена по порядку через запятую.',
      code,
      answerHint: 'имена через запятую',
      answerKey: out.join(','),
      explanation: 'Сначала фаза перехвата сверху вниз (обработчики с capture: true), затем всплытие снизу вверх; stopPropagation прерывает дальнейшее распространение, но текущий обработчик уже отработал.',
      params: { capture: listeners.map((l) => +l.capture).join(''), stop: listeners.findIndex((l) => l.stop) },
    };
  },
};

// ---------------------------------------------------------------------------
// Middle
// ---------------------------------------------------------------------------

export const eventLoop: TaskGenerator = {
  id: 'fe.event-loop',
  subcategoryId: 'frontend.realtime',
  taskId: 'task:code-output',
  title: 'Порядок вывода: промисы и таймеры',
  specialization: 'frontend',
  grade: 'middle',
  catalogIds: ['fe.event-loop', 'fe.js-core'],
  format: 'text',
  a: 1.4,
  b: 0.35,
  paramSpace: 5e4,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    // Набор строк и их класс: sync / micro / macro / macro с вложенным micro.
    type S = { code: string; kind: 'sync' | 'micro' | 'macro' | 'macro-micro' | 'micro-micro'; label: string };
    const labels = rng.shuffle(['A', 'B', 'C', 'D', 'E', 'F']).slice(0, 5);
    const [la, lb, lc, ld, le] = labels as [string, string, string, string, string];
    const stmts: S[] = rng.shuffle([
      { code: `console.log('${la}');`, kind: 'sync', label: la },
      { code: `setTimeout(() => console.log('${lb}'), 0);`, kind: 'macro', label: lb },
      { code: `Promise.resolve().then(() => console.log('${lc}'));`, kind: 'micro', label: lc },
      { code: `setTimeout(() => { console.log('${ld}'); Promise.resolve().then(() => console.log('${ld}${ld}')); }, 0);`, kind: 'macro-micro', label: ld },
      { code: `queueMicrotask(() => { console.log('${le}'); Promise.resolve().then(() => console.log('${le}${le}')); });`, kind: 'micro-micro', label: le },
    ]);
    const code = stmts.map((s) => s.code).join('\n') + `\nconsole.log('end');`;
    const sync = stmts.filter((s) => s.kind === 'sync').map((s) => s.label);
    const micro: string[] = [];
    const microLater: string[] = [];
    for (const s of stmts) {
      if (s.kind === 'micro') micro.push(s.label);
      if (s.kind === 'micro-micro') {
        micro.push(s.label);
        microLater.push(`${s.label}${s.label}`);
      }
    }
    const macro: string[] = [];
    for (const s of stmts) {
      if (s.kind === 'macro') macro.push(s.label);
      if (s.kind === 'macro-micro') macro.push(s.label, `${s.label}${s.label}`);
    }
    const out = [...sync, 'end', ...micro, ...microLater, ...macro];
    return {
      prompt: 'Что выведет код? Перечислите значения по порядку через запятую.',
      code,
      answerHint: 'значения через запятую',
      answerKey: out.join(','),
      explanation: 'Сначала весь синхронный код, затем очередь микрозадач до опустошения (включая микрозадачи, добавленные микрозадачами), затем макрозадачи по одной; микрозадача из колбэка setTimeout выполняется сразу после него, до следующего таймера.',
      params: { order: stmts.map((s) => s.kind).join(',') },
    };
  },
};

export const tsTypecheck: TaskGenerator = {
  id: 'fe.ts-typecheck',
  subcategoryId: 'frontend.design-system',
  taskId: 'task:ts-typecheck',
  title: 'Где ошибка типов',
  specialization: 'frontend',
  grade: 'middle',
  catalogIds: ['fe.ts-typing'],
  format: 'line',
  a: 1.4,
  b: 0.55,
  paramSpace: 5e3,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const ent = rng.pick(['User', 'Order', 'Ticket']);
    const opt = rng.pick(['email', 'phone', 'note']);
    type Line = { ok: string; bad: string; why: string };
    const pool: Line[] = [
      { ok: `const len = item.${opt}?.length ?? 0;`, bad: `const len = item.${opt}.length;`, why: `${opt} необязательное (string | undefined): обращение без проверки - ошибка «possibly undefined»` },
      { ok: `const label: string = String(item.id);`, bad: `const label: string = item.id;`, why: 'number не присваивается string' },
      { ok: `const next: ${ent} = { ...item, id: item.id + 1 };`, bad: `const next: ${ent} = { ...item, id: String(item.id + 1) };`, why: 'id должен быть number' },
      { ok: `const tags: string[] = item.tags.filter((t) => t.length > 0);`, bad: `const tags: string[] = item.tags.map((t) => t.length);`, why: 'map вернёт number[], а не string[]' },
      { ok: `const first = item.tags[0] ?? 'none';`, bad: `const first: string = item.tags[0];`, why: 'с noUncheckedIndexedAccess элемент массива - string | undefined' },
    ];
    const chosen = rng.sample(pool, 4);
    const bugIdx = rng.int(0, chosen.length - 1);
    const header = [
      `interface ${ent} {`,
      '  id: number;',
      '  tags: string[];',
      `  ${opt}?: string;`,
      '}',
      '',
      `function use(item: ${ent}) {`,
    ];
    const body = chosen.map((l, i) => `  ${i === bugIdx ? l.bad : l.ok}`);
    const lines = [...header, ...body, '}'];
    const bugLine = header.length + bugIdx + 1;
    return {
      prompt: 'tsconfig: strict и noUncheckedIndexedAccess включены. Ровно одна строка не проходит проверку типов. Укажите её номер.',
      code: lines.join('\n'),
      answerHint: 'номер строки',
      answerKey: String(bugLine),
      explanation: `Строка ${bugLine}: ${chosen[bugIdx]!.why}.`,
      params: { ent, opt, bugIdx, picked: chosen.map((c) => c.why.slice(0, 12)).join('|') },
    };
  },
};

export const apiClientRace: TaskGenerator = {
  id: 'fe.api-client-race',
  subcategoryId: 'frontend.ui-app',
  taskId: 'task:find-bug',
  title: 'Гонка ответов в поиске',
  specialization: 'frontend',
  grade: 'middle',
  catalogIds: ['fe.api-client', 'fe.server-state'],
  format: 'text',
  a: 1.3,
  b: 0.6,
  paramSpace: 1e4,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const queries = ['re', 'rea', 'reac', 'react'].slice(0, rng.int(3, 4));
    const guarded = rng.int(0, 1) === 1;
    const arrival = rng.shuffle(queries);
    const code = [
      'let latest = 0;',
      'input.addEventListener("input", async (e) => {',
      guarded ? '  const my = ++latest;' : '',
      '  const res = await fetch(`/api/search?q=${e.target.value}`);',
      '  const items = await res.json();',
      guarded ? '  if (my !== latest) return; // ответ устарел' : '',
      '  render(items);',
      '});',
    ]
      .filter((l) => l !== '')
      .join('\n');
    const shown = guarded ? queries[queries.length - 1]! : arrival[arrival.length - 1]!;
    return {
      prompt: `Пользователь быстро набирает «${queries[queries.length - 1]}»: запросы уходят для ${queries.map((q) => `«${q}»`).join(', ')} (в этом порядке). Ответы приходят в порядке: ${arrival.map((q) => `«${q}»`).join(', ')}. Для какого запроса результаты останутся на экране после всех ответов?`,
      code,
      answerHint: 'текст запроса',
      answerKey: shown,
      explanation: guarded
        ? 'Счётчик latest отбрасывает ответы на устаревшие запросы: отрисовывается только ответ последнего запроса, независимо от порядка прихода.'
        : `Без защиты от гонки каждый ответ перерисовывает список; на экране остаётся последний пришедший - «${shown}», хотя пользователь ввёл «${queries[queries.length - 1]}».`,
      params: { guarded, arrival: arrival.join(',') },
    };
  },
};

export const stateBug: TaskGenerator = {
  id: 'fe.state-bug',
  subcategoryId: 'frontend.ui-app',
  taskId: 'task:find-bug',
  title: 'Ошибка в работе с состоянием',
  specialization: 'frontend',
  grade: 'middle',
  catalogIds: ['fe.state-mgmt', 'fe.render-lifecycle', 'fe.components'],
  format: 'line',
  a: 1.2,
  b: 0.4,
  paramSpace: 5e3,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    type L = { ok: string[]; bad: string[]; why: string };
    const pool: L[] = [
      { ok: ['  const add = (item) => setItems((prev) => [...prev, item]);'], bad: ['  const add = (item) => { items.push(item); setItems(items); };'], why: 'мутация массива состояния и setState той же ссылкой - React не увидит изменения' },
      {
        ok: ['  useEffect(() => {', '    const id = setInterval(() => setCount((c) => c + 1), 1000);', '    return () => clearInterval(id);', '  }, []);'],
        bad: ['  useEffect(() => {', '    const id = setInterval(() => setCount(count + 1), 1000);', '    return () => clearInterval(id);', '  }, []);'],
        why: 'устаревшее замыкание: count в колбэке всегда начальный, счётчик застрянет на 1',
      },
      { ok: ['  const total = useMemo(() => items.reduce((s, i) => s + i.price, 0), [items]);'], bad: ['  const total = useMemo(() => items.reduce((s, i) => s + i.price, 0), []);'], why: 'пустые зависимости: total не пересчитается при изменении items' },
      { ok: ['  const reset = () => setItems([]);'], bad: ['  const reset = () => { items.length = 0; setItems(items); };'], why: 'мутация состояния: та же ссылка, перерисовки не будет' },
    ];
    const chosen = rng.sample(pool, 3);
    const bugIdx = rng.int(0, chosen.length - 1);
    const lines: string[] = ['function Cart() {', '  const [items, setItems] = useState([]);', '  const [count, setCount] = useState(0);'];
    let bugLine = 0;
    chosen.forEach((l, i) => {
      const block = i === bugIdx ? l.bad : l.ok;
      if (i === bugIdx) bugLine = lines.length + (block.length > 1 ? 2 : 1);
      lines.push(...block);
    });
    lines.push('  return <List items={items} count={count} />;', '}');
    return {
      prompt: 'Компонент React. Ровно в одной строке - ошибка, из-за которой интерфейс не обновится или покажет устаревшее значение. Укажите номер этой строки.',
      code: lines.join('\n'),
      answerHint: 'номер строки',
      answerKey: String(bugLine),
      explanation: `Строка ${bugLine}: ${chosen[bugIdx]!.why}.`,
      params: { bugIdx, picked: chosen.map((c) => c.why.slice(0, 10)).join('|') },
    };
  },
};

export const webVitals: TaskGenerator = {
  id: 'fe.web-vitals',
  subcategoryId: 'frontend.web-perf',
  taskId: 'task:web-vitals',
  title: 'Посчитать сдвиг макета (CLS)',
  specialization: 'frontend',
  grade: 'middle',
  catalogIds: ['fe.web-perf'],
  format: 'number',
  a: 1.1,
  b: 0.9,
  paramSpace: 1e4,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const vh = rng.pick([800, 1000]);
    const h = rng.int(2, 8) * 50;
    const d = rng.int(1, 4) * 50;
    const impact = Math.min(1, (h + d) / vh);
    const distance = d / vh;
    const score = Number((impact * distance).toFixed(6));
    const alt = [score, Number(score.toFixed(3)), Number(score.toFixed(2))].map(String);
    return {
      prompt: `Окно высотой ${vh}px (ширина не важна: элемент на всю ширину). Над блоком высотой ${h}px, видимым целиком, вставился баннер, и блок сдвинулся вниз на ${d}px, оставаясь в окне. Чему равна оценка этого сдвига (layout shift score = impact fraction × distance fraction)? Ответ округлите до трёх знаков.`,
      answerHint: 'десятичное число',
      answerKey: [...new Set(alt)].join('|'),
      explanation: `Impact fraction - доля окна, занятая блоком до и после сдвига: (${h} + ${d}) / ${vh} = ${impact}. Distance fraction - сдвиг относительно высоты окна: ${d} / ${vh} = ${distance}. Произведение ${score}.`,
      params: { vh, h, d },
    };
  },
};

export const complexity: TaskGenerator = {
  id: 'fe.complexity',
  subcategoryId: 'frontend.web-perf',
  taskId: 'task:complexity',
  title: 'Сложность алгоритма',
  specialization: 'frontend',
  grade: 'middle',
  catalogIds: ['common.algo-complexity'],
  format: 'text',
  a: 1.0,
  b: 0.2,
  paramSpace: 1e3,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const fn = rng.pick(['countPairs', 'findDup', 'scan']);
    type V = { code: string[]; key: string; why: string };
    const variants: V[] = [
      {
        code: [`function ${fn}(arr) {`, '  let c = 0;', '  for (let i = 0; i < arr.length; i++)', '    for (let j = i + 1; j < arr.length; j++)', '      if (arr[i] === arr[j]) c++;', '  return c;', '}'],
        key: 'n^2|n²|o(n^2)|o(n²)|квадратичная',
        why: 'вложенные циклы по тому же массиву: n(n−1)/2 сравнений - O(n²)',
      },
      {
        code: [`function ${fn}(arr) {`, '  const seen = new Set();', '  for (const x of arr) {', '    if (seen.has(x)) return x;', '    seen.add(x);', '  }', '  return null;', '}'],
        key: 'n|o(n)|линейная',
        why: 'один проход, операции с Set в среднем O(1) - O(n)',
      },
      {
        code: [`function ${fn}(arr) {`, '  const sorted = [...arr].sort((a, b) => a - b);', '  for (let i = 1; i < sorted.length; i++)', '    if (sorted[i] === sorted[i - 1]) return sorted[i];', '  return null;', '}'],
        key: 'n log n|o(n log n)|nlogn|n*log n|n·log n|n log(n)|o(n log(n))|o(nlogn)',
        why: 'сортировка O(n log n) доминирует над линейным проходом',
      },
      {
        code: [`function ${fn}(sorted, x) {`, '  let lo = 0, hi = sorted.length - 1;', '  while (lo <= hi) {', '    const mid = (lo + hi) >> 1;', '    if (sorted[mid] === x) return mid;', '    if (sorted[mid] < x) lo = mid + 1; else hi = mid - 1;', '  }', '  return -1;', '}'],
        key: 'log n|o(log n)|logn|log(n)|o(logn)|o(log(n))|логарифмическая',
        why: 'бинарный поиск: интервал делится пополам - O(log n)',
      },
    ];
    const v = rng.pick(variants);
    return {
      prompt: 'Какова временная сложность функции по n = длине массива (в O-нотации, худший случай для обычных структур; для Set/Map считать операции O(1))?',
      code: v.code.join('\n'),
      answerHint: 'например: n^2, n log n, log n, n',
      answerKey: v.key,
      explanation: v.why + '.',
      params: { fn, variant: v.key.split('|')[0] },
    };
  },
};

export const FRONTEND_GENERATORS: TaskGenerator[] = [
  jsClosure,
  jsArrayOutput,
  cssSpecificity,
  cssFlex,
  htmlSemantics,
  domEvents,
  eventLoop,
  tsTypecheck,
  apiClientRace,
  stateBug,
  webVitals,
  complexity,
  // Тест на грейд отдельный на подкатегорию (ADR-0003, дополнение 10.10): новые семейства по подкатегориям.
  ...UI_APP_NEW_GENERATORS,
  ...DESIGN_SYSTEM_NEW_GENERATORS,
  ...WEB_PERF_NEW_GENERATORS,
  ...REALTIME_NEW_GENERATORS,
  ...JUNIOR_EXTRA_GENERATORS,
  ...SENIOR_GENERATORS,
  ...FRONTEND_BANK2_GENERATORS,
];
