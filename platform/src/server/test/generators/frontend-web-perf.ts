// Генераторы frontend.web-perf (критический путь, кэш, порядок скриптов, CLS, мемоизация, бандл).
// Ключ считает код генератора, не LLM (R-T-02); юнит-тест сверяет его независимым решением
// (tests/unit/test/frontend-subcategories.test.ts). a, b — ПРЕДЛОЖЕНИЕ, калибруются персонами.
// Сверено с MDN через Context7 10.10: defer/module выполняются после разбора документа по порядку,
// Cache-Control (max-age, no-store, no-cache, stale-while-revalidate), React.memo сравнивает props по Object.is.
import { createRng } from '../rng';
import type { TaskGenerator, TaskInstance } from '../types';

const SUB = 'frontend.web-perf';

// --- Junior: Cache-Control ----------------------------------------------------------

export const cacheControl: TaskGenerator = {
  id: 'fe.cache-control',
  subcategoryId: SUB,
  taskId: 'task:code-output',
  title: 'Сколько запросов дойдёт до сервера',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.web-perf', 'fe.browser-storage'],
  format: 'number',
  a: 1.3,
  b: -0.8,
  paramSpace: 5e4,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const maxAge = rng.pick([30, 60, 120, 300]);
    const variants = [
      { header: `Cache-Control: max-age=${maxAge}`, kind: 'max-age' },
      { header: 'Cache-Control: no-store', kind: 'no-store' },
      { header: 'Cache-Control: no-cache', kind: 'no-cache' },
      {
        header: `Cache-Control: public, max-age=${maxAge}, immutable`,
        kind: 'max-age',
      },
      { header: `Cache-Control: private, max-age=${maxAge}`, kind: 'max-age' },
    ];
    const v = rng.pick(variants);
    const n = rng.int(4, 6);
    const times: number[] = [0];
    for (let i = 1; i < n; i++) times.push(times[i - 1]! + rng.int(1, Math.round(maxAge * 0.9)));
    // Модель: свежесть считается от последнего обращения к серверу (запрос или повторная проверка 304).
    let hits = 0;
    let last = -Infinity;
    for (const t of times) {
      const fresh = v.kind === 'max-age' && t - last < maxAge;
      if (!fresh) {
        hits++;
        last = t;
      }
    }
    return {
      prompt: `Сервер отвечает на GET /app.js заголовком «${v.header}» (есть ETag, повторная проверка отвечает 304). Один и тот же браузер запрашивает файл в секунды: ${times.join(', ')} (обычные переходы, не жёсткая перезагрузка). Сколько из этих запросов дойдёт до сервера, считая запросы на повторную проверку?`,
      answerHint: 'число',
      answerKey: String(hits),
      explanation:
        v.kind === 'max-age'
          ? `Пока возраст ответа меньше max-age=${maxAge}, браузер берёт файл из кэша без запроса; после истечения идёт запрос на повторную проверку (304), и отсчёт свежести начинается заново. Итого ${hits}.`
          : v.kind === 'no-store'
            ? 'no-store запрещает сохранять ответ: каждый запрос идёт на сервер.'
            : 'no-cache не запрещает хранить ответ, но требует повторной проверки на сервере перед каждым использованием: запрос уходит каждый раз (ответ может быть 304).',
      params: { header: v.header, times: times.join(',') },
    };
  },
};

// --- Middle: stale-while-revalidate ---------------------------------------------------

export const swrCache: TaskGenerator = {
  id: 'fe.swr-cache',
  subcategoryId: SUB,
  taskId: 'task:code-output',
  title: 'Запросы к серверу при stale-while-revalidate',
  specialization: 'frontend',
  grade: 'middle',
  catalogIds: ['fe.web-perf', 'fe.api-client'],
  format: 'number',
  a: 1.2,
  b: 0.6,
  paramSpace: 1e5,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const maxAge = rng.pick([20, 30, 60]);
    const swr = rng.pick([30, 60, 120]);
    const n = rng.int(5, 7);
    const times: number[] = [0];
    for (let i = 1; i < n; i++) times.push(times[i - 1]! + rng.int(5, maxAge + swr));
    let age0 = 0; // момент последнего ответа сервера
    let hits = 1; // первый запрос всегда на сервер
    for (const t of times.slice(1)) {
      const age = t - age0;
      if (age < maxAge) continue; // свежий, из кэша
      hits++; // устаревший: в окне swr - фоновая проверка, за окном - блокирующая; сервер получает запрос в обоих случаях
      age0 = t;
    }
    const nStale = hits - 1;
    return {
      prompt: `Ответ API: «Cache-Control: max-age=${maxAge}, stale-while-revalidate=${swr}». Браузер запрашивает ресурс в секунды: ${times.join(', ')}. Первый запрос идёт на сервер. Повторная проверка выполняется мгновенно, ответ 304 обновляет свежесть с момента этого запроса. Сколько всего запросов получит сервер (включая фоновые проверки)?`,
      answerHint: 'число',
      answerKey: String(hits),
      explanation: `Пока возраст меньше ${maxAge} с, ответ свежий - запроса нет. В окне stale-while-revalidate (${swr} с после истечения) кэш отдаёт устаревшее сразу, но запускает проверку в фоне, а за его пределами проверка блокирующая: в обоих случаях сервер получает запрос и свежесть обновляется. Повторных обращений ${nStale}, всего ${hits}.`,
      params: { maxAge, swr, times: times.join(',') },
    };
  },
};

// --- Junior: порядок выполнения скриптов -------------------------------------------------

export const scriptOrder: TaskGenerator = {
  id: 'fe.script-order',
  subcategoryId: SUB,
  taskId: 'task:code-output',
  title: 'Порядок выполнения скриптов',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.web-perf', 'fe.bundler'],
  format: 'text',
  a: 1.3,
  b: -0.5,
  paramSpace: 5e4,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const names = rng.shuffle(['a', 'b', 'c', 'd', 'e', 'f', 'g']).slice(0, rng.int(5, 6));
    type S = { name: string; tag: string; deferred: boolean };
    const kinds: ((n: string) => S)[] = [
      (n) => ({
        name: n,
        tag: `<script src="${n}.js"></script>`,
        deferred: false,
      }),
      (n) => ({
        name: n,
        tag: `<script defer src="${n}.js"></script>`,
        deferred: true,
      }),
      (n) => ({
        name: n,
        tag: `<script type="module" src="${n}.js"></script>`,
        deferred: true,
      }),
      (n) => ({
        name: n,
        tag: `<script>log('${n}')</script>`,
        deferred: false,
      }),
      (n) => ({
        name: n,
        tag: `<script type="module">log('${n}')</script>`,
        deferred: true,
      }),
    ];
    let scripts: S[];
    for (;;) {
      scripts = names.map((n) => rng.pick(kinds)(n));
      const d = scripts.filter((s) => s.deferred).length;
      if (d >= 1 && d < scripts.length) break;
    }
    const split = rng.int(1, scripts.length - 1);
    const head = scripts.slice(0, split);
    const body = scripts.slice(split);
    const code = ['<head>', ...head.map((s) => `  ${s.tag}`), '</head>', '<body>', '  <h1>Каталог</h1>', ...body.map((s) => `  ${s.tag}`), '</body>'].join('\n');
    const order = [...scripts.filter((s) => !s.deferred), ...scripts.filter((s) => s.deferred)].map((s) => s.name);
    return {
      prompt: 'Каждый скрипт при выполнении записывает своё имя (файл a.js вызывает log("a")). Все файлы загружаются мгновенно. В каком порядке имена появятся в журнале? Перечислите через запятую.',
      code,
      answerHint: 'имена через запятую',
      answerKey: order.join(','),
      explanation:
        'Обычный (не defer, не module) скрипт выполняется сразу при разборе документа и блокирует его. Скрипты с defer и type="module" (в том числе встроенные модули) откладываются до конца разбора и выполняются по порядку в документе - уже после всех обычных.',
      params: { tags: scripts.map((s) => s.tag.slice(0, 22)).join('|'), split },
    };
  },
};

// --- Junior: изображение без размеров (CLS) ---------------------------------------------

export const clsImageLine: TaskGenerator = {
  id: 'fe.cls-image-line',
  subcategoryId: SUB,
  taskId: 'task:web-vitals',
  title: 'Изображение, вызывающее сдвиг макета',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.web-perf', 'fe.responsive'],
  format: 'line',
  a: 1.3,
  b: -0.9,
  paramSpace: 5e4,
  timeLimitSec: 120,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const w = rng.pick([320, 400, 480, 640]);
    const h = rng.pick([200, 240, 300, 360]);
    const names = rng.shuffle(['hero', 'logo', 'cover', 'avatar', 'banner', 'photo']);
    const good = [
      (n: string) => `<img src="/${n}.jpg" width="${w}" height="${h}" alt="">`,
      (n: string) => `<img src="/${n}.jpg" width="${w}" height="${h}" loading="lazy" alt="">`,
      (n: string) => `<img src="/${n}.jpg" style="aspect-ratio: ${w} / ${h}; width: 100%" alt="">`,
    ];
    const bad = [(n: string) => `<img src="/${n}.jpg" alt="">`, (n: string) => `<img src="/${n}.jpg" style="width: 100%" alt="">`, (n: string) => `<img src="/${n}.jpg" loading="lazy" alt="">`];
    const count = rng.int(4, 5);
    const badIdx = rng.int(0, count - 1);
    const items = Array.from({ length: count }, (_, i) => (i === badIdx ? rng.pick(bad) : rng.pick(good))(names[i]!));
    const lines = [
      '<main>',
      ...items
        .map((t, i) => `  <p>Блок ${i + 1}</p>\n  ${t}`)
        .join('\n')
        .split('\n'),
      '</main>',
    ];
    const key = lines.findIndex((l) => l.trim() === items[badIdx]!) + 1;
    return {
      prompt: 'Страница дергается при загрузке картинок. Ровно у одного <img> браузер не знает размер или пропорции до загрузки файла, и он сдвигает контент (CLS). Укажите номер строки с этим <img>.',
      code: lines.join('\n'),
      answerHint: 'номер строки',
      answerKey: String(key),
      explanation: `Строка ${key}: нет ни width/height, ни aspect-ratio, поэтому место под картинку резервируется только после загрузки. Атрибуты width и height (или aspect-ratio) позволяют браузеру зарезервировать место заранее; loading="lazy" этого не заменяет.`,
      params: { w, h, badIdx, count },
    };
  },
};

// --- Junior: критический путь загрузки ---------------------------------------------------

export const criticalPath: TaskGenerator = {
  id: 'fe.critical-path',
  subcategoryId: SUB,
  taskId: 'task:web-vitals',
  title: 'Время загрузки цепочки ресурсов',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.web-perf', 'fe.bundler'],
  format: 'number',
  a: 1.3,
  b: -0.5,
  paramSpace: 1e5,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const files = rng.shuffle(['app.css', 'app.js', 'font.woff2', 'hero.jpg', 'data.json', 'chunk.js', 'icons.svg']);
    const n = rng.int(5, 6);
    const names = ['index.html', ...files.slice(0, n - 1)];
    const dur = names.map(() => rng.int(2, 12) * 50);
    const parent: number[] = [-1];
    for (let i = 1; i < n; i++) parent.push(rng.int(0, i - 1));
    // Ресурс начинает грузиться, когда полностью загружен тот, кто на него ссылается; параллельность без лимита.
    const finish: number[] = [];
    for (let i = 0; i < n; i++) finish.push((parent[i]! < 0 ? 0 : finish[parent[i]!]!) + dur[i]!);
    const answer = Math.max(...finish);
    const code = names.map((nm, i) => `${nm.padEnd(12)} ${String(dur[i]).padStart(4)} мс   ${parent[i]! < 0 ? 'открывается первым' : `подключён из ${names[parent[i]!]}`}`).join('\n');
    return {
      prompt:
        'Браузер начинает загружать ресурс, когда полностью получен файл, из которого он подключён; ресурсы, не зависящие друг от друга, грузятся параллельно без ограничений. Через сколько мс после начала загрузится последний ресурс?',
      code,
      answerHint: 'миллисекунды',
      answerKey: String(answer),
      explanation: `Время окончания ресурса = время окончания родителя + его собственное время. Самая длинная цепочка (критический путь) задаёт общее время: ${answer} мс. Ускорить можно только ресурсы на этой цепочке.`,
      params: { dur: dur.join(','), parent: parent.join(',') },
    };
  },
};

// --- Middle: React.memo и перерисовки -------------------------------------------------------

export const memoRenders: TaskGenerator = {
  id: 'fe.memo-renders',
  subcategoryId: SUB,
  taskId: 'task:code-output',
  title: 'Сколько раз перерисуется мемоизированный компонент',
  specialization: 'frontend',
  grade: 'middle',
  catalogIds: ['fe.render-perf', 'fe.render-lifecycle'],
  format: 'number',
  a: 1.2,
  b: 0.6,
  paramSpace: 1e5,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    // always - новая ссылка на каждом рендере; tick - меняется при изменении tick; never - стабильное значение.
    type P = { src: string; kind: 'always' | 'tick' | 'never' };
    const pool: P[] = [
      { src: `item={item}`, kind: 'never' },
      { src: `onSelect={() => select(item.id)}`, kind: 'always' },
      {
        src: `onSelect={handleSelect}  // useCallback(..., [])`,
        kind: 'never',
      },
      {
        src: `onSelect={handleSelect}  // useCallback(..., [tick])`,
        kind: 'tick',
      },
      { src: `style={{ color: 'gray' }}`, kind: 'always' },
      { src: `style={ROW_STYLE}  // константа вне компонента`, kind: 'never' },
      { src: `label={'Строка ' + tick}`, kind: 'tick' },
      { src: `tags={useMemo(() => item.tags.slice(), [item])}`, kind: 'never' },
      { src: `tags={item.tags.slice()}`, kind: 'always' },
    ];
    let props: P[];
    for (;;) {
      props = rng.sample(pool, 3);
      // не допускаем двух значений одного и того же пропа
      const names = props.map((p) => p.src.split('=')[0]);
      if (new Set(names).size === names.length) break;
    }
    const events = Array.from({ length: rng.int(4, 6) }, () => (rng.int(0, 1) === 0 ? 'tick' : 'other'));
    let renders = 1;
    for (const e of events) {
      const changed = props.some((p) => p.kind === 'always' || (p.kind === 'tick' && e === 'tick'));
      if (changed) renders++;
    }
    const code = [
      'const Row = React.memo(function Row(props) { /* ... */ });',
      '',
      'function List({ item }) {',
      '  const [tick, setTick] = useState(0);   // setTick(t => t + 1) меняет значение',
      '  const [other, setOther] = useState(0); // setOther(o => o + 1) на Row не влияет',
      '  return <Row',
      ...props.map((p) => `    ${p.src}`),
      '  />;',
      '}',
    ].join('\n');
    return {
      prompt: `Родитель List смонтирован (Row отрисована один раз), затем по порядку произошли обновления состояния: ${events.map((e) => (e === 'tick' ? 'setTick' : 'setOther')).join(', ')}. item не менялся. Сколько всего раз выполнится функция Row (с учётом первой отрисовки)?`,
      code,
      answerHint: 'число',
      answerKey: String(renders),
      explanation:
        'React.memo пропускает перерисовку, если все props равны по Object.is. Новый объект, функция или массив, созданные в теле родителя, равны только самим себе - Row перерисуется при каждом рендере List. useCallback/useMemo сохраняют ссылку, пока не изменились их зависимости; строка сравнивается по значению.',
      params: {
        props: props.map((p) => p.src.slice(0, 12)).join('|'),
        events: events.join(','),
      },
    };
  },
};

// --- Middle: размер начального бандла ---------------------------------------------------

export const bundleInitial: TaskGenerator = {
  id: 'fe.bundle-initial',
  subcategoryId: SUB,
  taskId: 'task:web-vitals',
  title: 'Размер начального бандла',
  specialization: 'frontend',
  grade: 'middle',
  catalogIds: ['fe.bundler', 'fe.web-perf'],
  format: 'number',
  a: 1.1,
  b: 0.4,
  paramSpace: 1e5,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const names = rng.shuffle(['header', 'cart', 'chart', 'utils', 'theme', 'api', 'editor', 'icons']).slice(0, 7);
    const size: Record<string, number> = {};
    for (const nm of names) size[nm] = rng.int(2, 30) * 2;
    // Рёбра: s - статический import (в начальном бандле), t - import type (стирается), d - динамический import() (отдельный чанк).
    type Edge = { from: string; to: string; kind: 's' | 't' | 'd' };
    const edges: Edge[] = [];
    const all = ['index', ...names];
    for (let i = 0; i < all.length; i++) {
      for (let j = Math.max(1, i + 1); j < all.length; j++) {
        if (i === 0 || rng.int(0, 99) < 25) {
          const r = rng.int(0, 9);
          if (i === 0 && j > 3 && r < 4) continue;
          edges.push({
            from: all[i]!,
            to: all[j]!,
            kind: r < 5 ? 's' : r < 7 ? 't' : 'd',
          });
        }
      }
    }
    // reach: достижимость от index только по статическим (не type) импортам.
    const reach = new Set<string>(['index']);
    const stack = ['index'];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const e of edges)
        if (e.from === cur && e.kind === 's' && !reach.has(e.to)) {
          reach.add(e.to);
          stack.push(e.to);
        }
    }
    const total = [...reach].filter((m) => m !== 'index').reduce((s, m) => s + size[m]!, 0);
    const code = all
      .map((m) => {
        const lines = edges
          .filter((e) => e.from === m)
          .map((e) => (e.kind === 's' ? `import { x } from './${e.to}';` : e.kind === 't' ? `import type { T } from './${e.to}';` : `const mod = () => import('./${e.to}');`));
        return `// ${m}.ts${m === 'index' ? ' (точка входа, размер не считать)' : ` - ${size[m]} кБ`}\n${lines.length ? lines.join('\n') : '// без импортов'}`;
      })
      .join('\n\n');
    return {
      prompt:
        'Сборщик не вырезает код внутри модулей: любой модуль, достижимый от точки входа, попадает в бандл целиком. Динамический import() выносит модуль в отдельный чанк, который грузится позже, а import type полностью стирается при компиляции. Какой суммарный размер (кБ) модулей начального бандла, без самой точки входа? Модуль, достижимый по нескольким путям, считается один раз.',
      code,
      answerHint: 'килобайты, число',
      answerKey: String(total),
      explanation: `В начальный бандл входят только модули, достижимые от index по статическим import (не type, не import()): ${[...reach].filter((m) => m !== 'index').join(', ') || 'ни одного'}. Сумма их размеров - ${total} кБ. Модули, доступные только через import() или import type, в начальный бандл не попадают, даже если они большие.`,
      params: {
        edges: edges.map((e) => `${e.from}>${e.to}${e.kind}`).join(','),
        sizes: names.map((n) => size[n]).join(','),
      },
    };
  },
};

export const WEB_PERF_NEW_GENERATORS: TaskGenerator[] = [cacheControl, swrCache, scriptOrder, clsImageLine, criticalPath, memoRenders, bundleInitial];
