// Расширенный банк frontend.web-perf: +3 Junior, +5 Middle, +4 Senior (решение владельца 11.10).
// Закрывает пробел «SSR и гидрация ниже Senior» (docs/research/competitors/test-banks.md).
// Ключ считает код генератора по модели из условия; a, b – ПРЕДЛОЖЕНИЕ.
import { createRng } from '../rng';
import type { TaskInstance } from '../types';
import { fam, WP } from './frontend-bank2-util';

// --- Junior ---------------------------------------------------------------------------

export const lazyImages = fam({
  id: 'fe.b2-lazy-images',
  sub: WP,
  grade: 'junior',
  title: 'Ленивая загрузка изображений',
  catalogIds: ['fe.web-perf', 'fe.render-perf'],
  taskId: 'task:web-vitals',
  a: 1.2,
  b: -1.0,
  space: 1e5,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const H = rng.int(5, 12) * 100;
    const pLazy = rng.int(3, 9);
    const step = rng.int(60, 360);
    const imgs = Array.from({ length: rng.int(14, 30) }, (_, i) => ({
      top: i * rng.int(180, 320),
      lazy: rng.int(0, 9) < pLazy,
    }));
    imgs.forEach((im, i) => (im.top = i === 0 ? rng.int(0, 200) : imgs[i - 1]!.top + rng.int(Math.floor(step / 2), step)));
    const loaded = imgs.filter((im) => !im.lazy || im.top < H).length;
    return {
      prompt: `Страница открыта, высота окна ${H}px, пользователь ещё не прокручивал. Упрощение для задачи (реальный порог близости задаёт браузер): картинка с loading="lazy" загружается, только если её верх выше нижней границы окна; без lazy загружается сразу. Сколько картинок будет загружено при первом показе?`,
      code: imgs.map((im, i) => `img${i + 1}: top=${im.top}px${im.lazy ? ' loading="lazy"' : ''}`).join('\n'),
      answerHint: 'число',
      answerKey: String(loaded),
      explanation: `Без lazy загружаются все такие картинки, а lazy – только те, что начинаются выше ${H}px. Итого ${loaded}.`,
      params: { H, imgs: imgs.map((i) => `${i.top}${i.lazy ? 'L' : ''}`).join(',') },
    };
  },
});

export const ssrVsCsr = fam({
  id: 'fe.b2-ssr-vs-csr',
  sub: WP,
  grade: 'junior',
  title: 'Первый контент: SSR или клиентский рендер',
  catalogIds: ['fe.ssr', 'fe.web-perf'],
  taskId: 'task:web-vitals',
  a: 1.2,
  b: -0.6,
  space: 1e6,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const render = rng.pick([40, 60, 80, 120]);
    const dataApi = rng.pick([100, 150, 200, 300]);
    const htmlFull = rng.pick([60, 80, 100]);
    const htmlShell = rng.pick([20, 30, 40]);
    const js = rng.pick([200, 300, 400, 500]);
    const exec = rng.pick([60, 100, 150]);
    const ttfb = rng.pick([80, 100, 150]);
    // SSR: сервер собирает данные и HTML (данные ждёт на сервере), страница видна после скачивания HTML
    const ssr = ttfb + dataApi + render + htmlFull;
    // CSR: оболочка, затем скрипт, исполнение, запрос данных, отрисовка
    const csr = ttfb + htmlShell + js + exec + dataApi + render;
    const ask = rng.pick(['ssr', 'csr', 'gap'] as const);
    const ans = ask === 'ssr' ? ssr : ask === 'csr' ? csr : csr - ssr;
    return {
      prompt: `Время в мс. SSR: ответ сервера начинается через ${ttfb}, сервер ждёт данные ${dataApi} и рендерит HTML ${render}, затем HTML скачивается ${htmlFull}; контент виден сразу после загрузки HTML. Клиентский рендер: ответ начинается через ${ttfb}, оболочка скачивается ${htmlShell}, скрипт – ${js}, исполняется ${exec}, затем запрос данных ${dataApi} и отрисовка ${render}. Все шаги идут последовательно. ${ask === 'ssr' ? 'Через сколько мс появится контент при SSR?' : ask === 'csr' ? 'Через сколько мс появится контент при клиентском рендере?' : 'На сколько мс раньше появится контент при SSR, чем при клиентском рендере?'}`,
      answerHint: 'миллисекунды',
      answerKey: String(ans),
      explanation: `SSR: ${ttfb} + ${dataApi} + ${render} + ${htmlFull} = ${ssr}. Клиентский рендер: ${ttfb} + ${htmlShell} + ${js} + ${exec} + ${dataApi} + ${render} = ${csr}.`,
      params: { ttfb, dataApi, render, htmlFull, htmlShell, js, exec, ask },
    };
  },
});

export const transferSize = fam({
  id: 'fe.b2-transfer-size',
  sub: WP,
  grade: 'junior',
  title: 'Размер передачи после минификации и сжатия',
  catalogIds: ['fe.web-perf', 'fe.bundler'],
  taskId: 'task:web-vitals',
  a: 1.1,
  b: -0.9,
  space: 1e6,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const files = rng.sample(['app.js', 'vendor.js', 'styles.css', 'chart.js', 'icons.js'], rng.int(3, 4)).map((name) => ({
      name,
      kb: rng.pick([100, 200, 300, 400, 500, 600]),
      gz: rng.pick([true, true, false]),
    }));
    const min = rng.pick([20, 30, 40]);
    const gzr = rng.pick([50, 60, 70]);
    const total = files.reduce((s, f) => {
      const m = (f.kb * (100 - min)) / 100;
      return s + (f.gz ? (m * (100 - gzr)) / 100 : m);
    }, 0);
    return {
      prompt: `Файлы минифицируют (размер уменьшается на ${min} %), затем те, у кого включён gzip, сжимаются ещё: размер после минификации уменьшается на ${gzr} %. Сколько КБ суммарно уйдёт по сети?`,
      code: files.map((f) => `${f.name}: ${f.kb} КБ, gzip ${f.gz ? 'включён' : 'выключен'}`).join('\n'),
      answerHint: 'КБ, число',
      answerKey: String(Number(total.toFixed(2))),
      explanation: 'Для каждого файла сначала уменьшаем размер на процент минификации, затем при включённом gzip ещё на процент сжатия; результаты складываем.',
      params: { files: files.map((f) => `${f.kb}${f.gz ? 'g' : ''}`).join(','), min, gzr },
    };
  },
});

// --- Middle ---------------------------------------------------------------------------

const HYDRATION_LINES: Array<{ line: string; bad: boolean }> = [
  { line: '<p>{new Date().toLocaleTimeString()}</p>', bad: true },
  { line: '<p>{Math.random().toFixed(2)}</p>', bad: true },
  { line: '<p>{typeof window !== "undefined" ? "client" : "server"}</p>', bad: true },
  { line: '<p>{typeof localStorage !== "undefined" ? localStorage.getItem("theme") : "light"}</p>', bad: true },
  { line: '<p>{typeof window !== "undefined" ? window.innerWidth : 0}</p>', bad: true },
  { line: '<p>{props.user.name}</p>', bad: false },
  { line: '<p>{items.length} шт.</p>', bad: false },
  { line: '<p>{formatPrice(props.price)}</p>', bad: false },
  { line: '<p>{useId()}</p>', bad: false },
  { line: '<ul>{items.map((i) => <li key={i.id}>{i.title}</li>)}</ul>', bad: false },
  { line: '<p>{Date.now() - props.createdAt}</p>', bad: true },
  { line: '<p>{props.count > 0 ? "есть" : "нет"}</p>', bad: false },
];

export const hydrationMismatch = fam({
  id: 'fe.b2-hydration-mismatch',
  sub: WP,
  grade: 'middle',
  title: 'Где гидрация даст расхождение',
  catalogIds: ['fe.ssr', 'fe.render-lifecycle'],
  taskId: 'task:find-bug',
  a: 1.3,
  b: 0.5,
  space: 1e6,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const picks = Array.from({ length: rng.int(6, 18) }, () => rng.pick(HYDRATION_LINES));
    const bad = picks.filter((p) => p.bad).length;
    return {
      prompt: 'Компоненты рендерятся на сервере, а затем гидрируются в браузере с теми же пропсами. Сколько из строк разметки (в каждой – отдельный компонент; на сервере нет window и localStorage, поэтому обращения к ним защищены проверкой typeof) выведут при первом рендере на клиенте не то, что вывел сервер, то есть вызовут ошибку гидрации?',
      code: picks.map((p, i) => `${i + 1}. ${p.line}`).join('\n'),
      answerHint: 'число',
      answerKey: String(bad),
      explanation: 'Расхождение дают значения, зависящие от времени, случайности и окружения браузера (Date, Math.random, window, localStorage). Чистые функции пропсов и useId на сервере и клиенте совпадают.',
      params: { lines: picks.map((p) => p.line).join('|') },
    };
  },
});

export const serverAwaits = fam({
  id: 'fe.b2-server-awaits',
  sub: WP,
  grade: 'middle',
  title: 'TTFB при последовательных await на сервере',
  catalogIds: ['fe.ssr', 'fe.api-client', 'fe.web-perf'],
  taskId: 'task:web-vitals',
  a: 1.2,
  b: 0.4,
  space: 1e6,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const names = rng.sample(['user', 'cart', 'prices', 'feed', 'banner', 'stock'], rng.int(4, 5));
    const dur = names.map(() => rng.pick([40, 60, 80, 120, 150, 200]));
    const groups: number[][] = [];
    let i = 0;
    while (i < names.length) {
      const size = rng.int(1, Math.min(3, names.length - i));
      groups.push(Array.from({ length: size }, (_, k) => i + k));
      i += size;
    }
    const base = rng.pick([30, 50]);
    const total = base + groups.reduce((s, g) => s + Math.max(...g.map((k) => dur[k]!)), 0);
    const code = groups.map((g) => (g.length === 1 ? `const ${names[g[0]!]} = await get('${names[g[0]!]}'); // ${dur[g[0]!]} мс` : `const [${g.map((k) => names[k]).join(', ')}] = await Promise.all([${g.map((k) => `get('${names[k]}')`).join(', ')}]); // ${g.map((k) => dur[k]).join(', ')} мс`)).join('\n');
    return {
      prompt: `Серверный компонент выполняет код ниже; каждый запрос get занимает указанное время, остальной рендер – ${base} мс, HTML отправляется после завершения всего. Через сколько мс браузер получит первый байт ответа?`,
      code,
      answerHint: 'миллисекунды',
      answerKey: String(total),
      explanation: `Отдельные await идут друг за другом, а запросы внутри Promise.all – параллельно (берётся самый долгий). Сумма по группам плюс ${base} мс рендера: ${total}.`,
      params: { dur: dur.join(','), groups: groups.map((g) => g.join('+')).join('|'), base },
    };
  },
});

export const routeChunks = fam({
  id: 'fe.b2-route-chunks',
  sub: WP,
  grade: 'middle',
  title: 'Сколько кода загрузится при навигации',
  catalogIds: ['fe.bundler', 'fe.web-perf', 'fe.routing'],
  taskId: 'task:web-vitals',
  a: 1.2,
  b: 0.5,
  space: 1e6,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const chunkNames = ['core', 'charts', 'editor', 'tables', 'forms', 'maps'];
    const size: Record<string, number> = {};
    for (const c of chunkNames) size[c] = rng.pick([20, 30, 45, 60, 80, 120]);
    const routes: Record<string, string[]> = {
      '/': ['core'],
      '/stats': ['core', ...rng.sample(['charts', 'tables'], rng.int(1, 2))],
      '/edit': ['core', ...rng.sample(['editor', 'forms', 'tables'], rng.int(1, 2))],
      '/geo': ['core', 'maps', ...rng.sample(['charts', 'forms'], 1)],
    };
    const paths = Object.keys(routes);
    const visits = Array.from({ length: rng.int(4, 6) }, () => rng.pick(paths));
    const loaded = new Set<string>();
    for (const v of visits) for (const c of routes[v]!) loaded.add(c);
    const total = [...loaded].reduce((s, c) => s + size[c]!, 0);
    return {
      prompt: `Каждый маршрут подгружает свои чанки динамическим import; загруженный чанк кэшируется и повторно не качается. Пользователь последовательно открывает: ${visits.join(' → ')}. Сколько КБ кода будет загружено за всю сессию?`,
      code: `размеры, КБ: ${chunkNames.map((c) => `${c}=${size[c]}`).join(', ')}\n${paths.map((p) => `${p}: ${routes[p]!.join(' + ')}`).join('\n')}`,
      answerHint: 'КБ, число',
      answerKey: String(total),
      explanation: `Берём объединение чанков посещённых маршрутов без повторов: ${[...loaded].join(', ')}.`,
      params: { visits: visits.join(','), size: chunkNames.map((c) => size[c]).join(',') },
    };
  },
});

export const inputLatency = fam({
  id: 'fe.b2-input-latency',
  sub: WP,
  grade: 'middle',
  title: 'Задержка взаимодействия при долгих задачах',
  catalogIds: ['fe.web-perf', 'fe.render-perf', 'fe.event-loop'],
  taskId: 'task:web-vitals',
  a: 1.3,
  b: 0.7,
  space: 1e7,
  time: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const tasks: Array<[number, number]> = [];
    let t = rng.int(0, 100);
    for (let i = 0; i < rng.int(3, 4); i++) {
      const d = rng.pick([40, 80, 120, 200, 300]);
      tasks.push([t, d]);
      t += d + rng.pick([50, 100, 200, 300]);
    }
    const handler = rng.pick([20, 40, 60]);
    const paint = rng.pick([16, 24, 32]);
    const clicks = Array.from({ length: rng.int(3, 4) }, () => rng.int(0, t));
    const lat = clicks.map((c) => {
      const cur = tasks.find(([s, d]) => c >= s && c < s + d);
      return (cur ? cur[0] + cur[1] - c : 0) + handler + paint;
    });
    const worst = Math.max(...lat);
    return {
      prompt: `Главный поток выполняет задачи без прерывания; обработчик клика начинается, когда поток свободен. Задержка взаимодействия = ожидание освобождения потока + обработчик (${handler} мс) + отрисовка (${paint} мс). Пользователь кликает в моменты (мс от начала): ${clicks.join(', ')}. Какова наибольшая задержка взаимодействия (так считается INP при малом числе взаимодействий)?`,
      code: tasks.map(([s, d], i) => `задача ${i + 1}: с ${s} по ${s + d} мс`).join('\n'),
      answerHint: 'миллисекунды',
      answerKey: String(worst),
      explanation: `Клик внутри долгой задачи ждёт её окончания, иначе ожидания нет. Задержки: ${lat.join(', ')}; наибольшая ${worst}.`,
      params: { tasks: tasks.map((x) => x.join('+')).join(','), clicks: clicks.join(','), handler, paint },
    };
  },
});

export const resourceHints = fam({
  id: 'fe.b2-resource-hints',
  sub: WP,
  grade: 'middle',
  title: 'Preload и preconnect на критическом пути',
  catalogIds: ['fe.web-perf', 'fe.render-perf'],
  taskId: 'task:web-vitals',
  a: 1.2,
  b: 0.6,
  space: 1e6,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const html = rng.pick([100, 150, 200]);
    const css = rng.pick([80, 120, 160]);
    const font = rng.pick([100, 140, 180, 220]);
    const conn = rng.pick([60, 100, 140]);
    const preload = rng.int(0, 1) === 1;
    const preconnect = rng.int(0, 1) === 1;
    // HTML получен на html; <link> в голове известен сразу
    const cssReady = html + css;
    // Шрифт: без preload запрос стартует, когда CSS получен и разобран; с preload – сразу после HTML.
    const start = preload ? html : cssReady;
    // Соединение со шрифтовым хостом: с preconnect открывается параллельно с CSS, начиная с html.
    const connReady = preconnect ? html + conn : start + conn;
    const fontReady = Math.max(start, connReady) + font;
    const ready = Math.max(fontReady, cssReady);
    return {
      prompt: `Все значения в мс. HTML загружен к ${html}. Затем качается CSS (${css} мс, из того же источника). Шрифт лежит на отдельном домене, его описание – в CSS; открытие соединения к домену занимает ${conn}, загрузка шрифта – ${font}. ${preconnect ? 'В <head> есть preconnect к домену шрифтов: соединение открывается сразу после получения HTML.' : 'Предварительного соединения нет: оно открывается в момент запроса шрифта.'} ${preload ? 'Есть <link rel="preload" as="font">: запрос шрифта идёт сразу после HTML.' : 'Шрифт запрашивается, когда браузер получил CSS.'} Страница готова, когда получены CSS и шрифт. Когда?`,
      answerHint: 'миллисекунды',
      answerKey: String(ready),
      explanation: `CSS готов к ${cssReady}. Запрос шрифта стартует в ${start}, соединение готово к ${connReady}, шрифт – к ${fontReady}. Страница готова к ${ready}.`,
      params: { html, css, font, conn, preload, preconnect },
    };
  },
});

// --- Senior ---------------------------------------------------------------------------

export const srIslandsTti = fam({
  id: 'fe.b2-sr-islands-tti',
  sub: WP,
  grade: 'senior',
  title: 'Интерактивность при полной и частичной гидрации',
  catalogIds: ['fe.ssr', 'fe.render-perf', 'fe.architecture'],
  taskId: 'task:web-vitals',
  a: 1.2,
  b: 1.4,
  space: 1e7,
  time: 280,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const names = rng.sample(['Header', 'Search', 'Gallery', 'Reviews', 'Cart', 'Footer', 'Recs'], rng.int(5, 6));
    const cost = names.map(() => rng.pick([30, 50, 70, 90, 120, 150]));
    const interactive = names.map((_, i) => i).filter(() => rng.int(0, 2) === 0);
    if (interactive.length === 0) interactive.push(rng.int(0, names.length - 1));
    const base = rng.pick([100, 150, 200]); // скачивание и разбор рантайма
    const html = rng.pick([200, 300]);
    const full = html + base + cost.reduce((s, c) => s + c, 0);
    const part = html + base + interactive.reduce((s, i) => s + cost[i]!, 0);
    const ask = rng.pick(['full', 'part', 'gain'] as const);
    const ans = ask === 'full' ? full : ask === 'part' ? part : full - part;
    return {
      prompt: `HTML виден и страница нарисована к ${html} мс. Дальше загружается и разбирается рантайм (${base} мс), затем гидрируются компоненты по очереди на главном потоке, цена каждого указана. Полная гидрация обрабатывает все компоненты; в архитектуре «острова» гидрируются только компоненты, отмеченные как интерактивные (*), остальные остаются статическим HTML. ${ask === 'full' ? 'Когда страница станет полностью интерактивной при полной гидрации?' : ask === 'part' ? 'Когда все интерактивные острова готовы к вводу при частичной гидрации?' : 'На сколько мс раньше интерактивные элементы будут готовы при островах, чем при полной гидрации?'}`,
      code: names.map((n, i) => `${n}${interactive.includes(i) ? ' *' : ''}: ${cost[i]} мс`).join('\n'),
      answerHint: 'миллисекунды',
      answerKey: String(ans),
      explanation: `Полная: ${html} + ${base} + ${cost.reduce((a, b) => a + b, 0)} = ${full}. Острова: ${html} + ${base} + ${interactive.reduce((s, i) => s + cost[i]!, 0)} = ${part}. Выигрыш ${full - part}. Цена – сложнее общее состояние между островами и риск расхождений при вложенных островах.`,
      params: { cost: cost.join(','), interactive: interactive.join(','), base, html, ask },
    };
  },
});

export const srCdnVary = fam({
  id: 'fe.b2-sr-cdn-vary',
  sub: WP,
  grade: 'senior',
  title: 'Кэш CDN и заголовок Vary для SSR-страниц',
  catalogIds: ['fe.ssr', 'fe.web-perf', 'fe.architecture'],
  taskId: 'task:web-vitals',
  a: 1.2,
  b: 1.2,
  space: 1e7,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const paths = ['/', '/catalog', '/item/7', '/cart', '/about', '/faq'];
    const langs = ['ru', 'en', 'de'];
    const cookies = ['anon', 'u1', 'u2', 'u3'];
    const vary = rng.pick([[], ['accept-language'], ['cookie'], ['accept-language', 'cookie']] as string[][]);
    const reqs = Array.from({ length: rng.int(6, 14) }, () => ({ p: rng.pick(paths), l: rng.pick(langs), c: rng.pick(cookies) }));
    const keys = new Set(reqs.map((r) => `${r.p}|${vary.includes('accept-language') ? r.l : ''}|${vary.includes('cookie') ? r.c : ''}`));
    return {
      prompt: `CDN кэширует ответы SSR-страниц на час (время ожидания не истекает за наше окно). Ключ кэша – URL плюс значения заголовков из Vary: ${vary.length ? vary.join(', ') : 'заголовок Vary отсутствует'}. Сколько запросов из списка дойдёт до origin (первый запрос с новым ключом – промах, остальные – попадание)?`,
      code: reqs.map((r, i) => `${i + 1}. GET ${r.p}  Accept-Language: ${r.l}  Cookie: ${r.c}`).join('\n'),
      answerHint: 'число',
      answerKey: String(keys.size),
      explanation: `Различных ключей кэша ${keys.size}. Vary: Cookie почти уничтожает hit-ratio на персонализированных страницах, а отсутствие Vary при языковых версиях отдаёт чужой язык (оба риска стоит учитывать при проектировании).`,
      params: { vary: vary.join(','), reqs: reqs.map((r) => `${r.p}${r.l}${r.c}`).join(',') },
    };
  },
});

export const srPerfBudget = fam({
  id: 'fe.b2-sr-perf-budget',
  sub: WP,
  grade: 'senior',
  title: 'Бюджет JS под целевой TTI',
  catalogIds: ['fe.web-perf', 'fe.bundler', 'fe.architecture'],
  taskId: 'task:web-vitals',
  a: 1.1,
  b: 1.1,
  space: 1e7,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const mbps = rng.pick([1.6, 4, 8]);
    const net = 8 / mbps; // мс на КБ
    const cpu = rng.pick([1, 2, 3]); // мс на КБ разбора и выполнения
    const rtts = rng.int(2, 4);
    const rtt = rng.pick([100, 150, 200, 300]);
    const rest = rng.pick([200, 300, 500]); // данные, рендер вне бандла
    const budget = rng.pick([3000, 4000, 5000]);
    const free = budget - rtts * rtt - rest;
    const kb = Math.floor(free / (net + cpu));
    return {
      prompt: `Целевой TTI – ${budget} мс на медленном устройстве. На задержки сети уходит ${rtts} круга по ${rtt} мс, прочая работа вне JS-бандла – ${rest} мс. Загрузка бандла: ${mbps} Мбит/с (1 КБ = 8 кбит), разбор и выполнение – ${cpu} мс на КБ, всё последовательно. Какой максимальный размер бандла (КБ, целое, округлить вниз) укладывается в бюджет?`,
      answerHint: 'КБ, целое число',
      answerKey: String(kb),
      explanation: `На бандл остаётся ${free} мс. Один КБ стоит ${net} мс сети и ${cpu} мс процессора, всего ${net + cpu}; ${free} / ${net + cpu} округляем вниз до ${kb}. Бюджет в КБ придётся пересматривать, когда меняется профиль устройств.`,
      params: { mbps, cpu, rtts, rtt, rest, budget },
    };
  },
});

export const srClsWindow = fam({
  id: 'fe.b2-sr-cls-window',
  sub: WP,
  grade: 'senior',
  title: 'CLS по окнам сессии',
  catalogIds: ['fe.web-perf', 'fe.render-perf'],
  taskId: 'task:web-vitals',
  a: 1.2,
  b: 1.3,
  space: 1e8,
  time: 280,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const shifts: Array<{ t: number; imp: number; dist: number }> = [];
    let t = rng.int(200, 1500);
    for (let i = 0; i < rng.int(5, 8); i++) {
      shifts.push({ t, imp: rng.pick([10, 20, 30, 40, 50]), dist: rng.pick([10, 20, 30]) });
      t += rng.pick([200, 500, 800, 1500, 2500]);
    }
    // значение сдвига в сотых: impact (в %) × distance (в %) / 100
    const val = (s: { imp: number; dist: number }) => (s.imp * s.dist) / 100;
    const windows: number[] = [];
    let cur = 0;
    let startT = -1;
    let lastT = -1;
    for (const s of shifts) {
      if (startT >= 0 && (s.t - lastT > 1000 || s.t - startT >= 5000)) {
        windows.push(cur);
        cur = 0;
        startT = -1;
      }
      if (startT < 0) startT = s.t;
      cur += val(s);
      lastT = s.t;
    }
    windows.push(cur);
    const cls = Math.max(...windows) / 100;
    return {
      prompt: 'Оценка сдвига = доля затронутой области × доля сдвига (в долях единицы). CLS – наибольшая сумма по «окну сессии»: окно закрывается, если между соседними сдвигами прошло больше 1000 мс или длительность окна дошла до 5000 мс (следующий сдвиг открывает новое окно). Чему равен CLS (две цифры после запятой)?',
      code: shifts.map((s, i) => `${i + 1}. t=${s.t} мс, затронуто ${s.imp} %, сдвиг ${s.dist} %`).join('\n'),
      answerHint: 'число, например 0.12',
      answerKey: cls.toFixed(2),
      explanation: `Окна: ${windows.map((w) => (w / 100).toFixed(2)).join('; ')}. Берём наибольшее – ${cls.toFixed(2)}. Это не сумма всех сдвигов за жизнь страницы, как считалось раньше.`,
      params: { shifts: shifts.map((s) => `${s.t}/${s.imp}/${s.dist}`).join(',') },
    };
  },
});

export const WP_BANK2_GENERATORS = [
  lazyImages, ssrVsCsr, transferSize,
  hydrationMismatch, serverAwaits, routeChunks, inputLatency, resourceHints,
  srIslandsTti, srCdnVary, srPerfBudget, srClsWindow,
];
