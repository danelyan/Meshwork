// Senior-семейства frontend, по 4 на подкатегорию (ADR 0003, дополнение 10.10 16:15): проектные решения,
// компромиссы, диагностика по неполным данным, границы применимости. b 1,0-1,7, a 1,0-1,4 - ПРЕДЛОЖЕНИЕ,
// калибруется персонами (eval/test/personas-subcategory.ts). Ключ считает код генератора; тест сверяет
// независимым решением: реальный React (StrictMode, context, key), компилятор TypeScript, исполнение кода,
// отдельные модели. Сверено через Context7 10.10: повтор эффектов в StrictMode (setup, cleanup, setup),
// перерисовка потребителей контекста, webpack sideEffects/tree-shaking. По знанию агента (доками не
// подтверждено): пороги WCAG (3:1 и 4.5:1; крупный текст - от 24px или 18,66px жирного), каскад
// @container и @media в одном правиле, поведение идемпотентных ключей, окно воспроизведения SSE.
import { createRng } from '../rng';
import type { TaskGenerator, TaskInstance } from '../types';

const UI = 'frontend.ui-app';
const DS = 'frontend.design-system';
const WP = 'frontend.web-perf';
const RT = 'frontend.realtime';

// ===========================================================================
// ui-app
// ===========================================================================

export const srEffectLifecycle: TaskGenerator = {
  id: 'fe.sr-effect-lifecycle',
  subcategoryId: UI,
  taskId: 'task:code-output',
  title: 'Порядок подключений и отключений эффектов',
  specialization: 'frontend',
  grade: 'senior',
  catalogIds: ['fe.render-lifecycle', 'fe.architecture'],
  format: 'text',
  a: 1.3,
  b: 1.3,
  paramSpace: 1e5,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    type Eff = { tag: string; deps: 'id' | 'mode' | 'none' };
    const tags = rng.shuffle(['a', 'b', 'c']);
    const effs: Eff[] = rng.sample(['id', 'mode', 'none'] as const, rng.int(2, 3)).map((deps, i) => ({ tag: tags[i]!, deps }));
    const ids = ['x', 'y', 'z'];
    const modes = ['p', 'q'];
    const nRender = rng.int(2, 3);
    const props: { id: string; mode: string }[] = [{ id: ids[0]!, mode: modes[0]! }];
    for (let i = 1; i < nRender; i++) {
      const prev = props[i - 1]!;
      const c = rng.int(1, 3);
      props.push({
        id: c & 1 ? rng.pick(ids.filter((x) => x !== prev.id)) : prev.id,
        mode: c & 2 ? rng.pick(modes.filter((x) => x !== prev.mode)) : prev.mode,
      });
    }
    const depsOf = (e: Eff, p: { id: string; mode: string }) => (e.deps === 'id' ? [p.id] : e.deps === 'mode' ? [p.mode] : []);
    const logs: string[] = [];
    // StrictMode (dev): при монтировании все setup, затем все cleanup, затем все setup снова.
    const setupAll = (p: { id: string; mode: string }) => effs.forEach((e) => logs.push(`+${e.tag}${depsOf(e, p).join('')}`));
    const cleanupAll = (p: { id: string; mode: string }) => effs.forEach((e) => logs.push(`-${e.tag}${depsOf(e, p).join('')}`));
    setupAll(props[0]!);
    cleanupAll(props[0]!);
    setupAll(props[0]!);
    for (let i = 1; i < props.length; i++) {
      const prev = props[i - 1]!;
      const cur = props[i]!;
      const changed = effs.filter((e) => e.deps === 'none' || depsOf(e, prev).join() !== depsOf(e, cur).join());
      for (const e of changed) logs.push(`-${e.tag}${depsOf(e, prev).join('')}`);
      for (const e of changed) logs.push(`+${e.tag}${depsOf(e, cur).join('')}`);
    }
    cleanupAll(props[props.length - 1]!);
    const dep = (e: Eff) => (e.deps === 'id' ? '[id]' : e.deps === 'mode' ? '[mode]' : null);
    const code = [
      'function Widget({ id, mode }) {',
      ...effs.flatMap((e) => {
        const d = dep(e);
        const val = e.deps === 'id' ? 'id' : e.deps === 'mode' ? 'mode' : "''";
        return [`  useEffect(() => {`, `    log('+${e.tag}' + ${val});`, `    return () => log('-${e.tag}' + ${val});`, `  }${d ? `, ${d}` : ''});`];
      }),
      '  return null;',
      '}',
      '',
      '// Всё приложение обёрнуто в <StrictMode> (режим разработки), root.render вызывается по порядку:',
      ...props.map((p, i) => `// рендер ${i + 1}: id='${p.id}', mode='${p.mode}'`),
      '// в конце root.unmount()',
    ].join('\n');
    return {
      prompt:
        'log печатает строку. Какие записи окажутся в журнале по порядку - от первого рендера до unmount включительно? Перечислите через запятую. Эффекты без массива зависимостей срабатывают после каждого рендера.',
      code,
      answerHint: 'записи через запятую',
      answerKey: logs.join(','),
      explanation:
        'В StrictMode при монтировании React один раз прогоняет лишний цикл setup → cleanup → setup для всех эффектов. При следующем рендере сначала выполняются очистки всех эффектов, у которых изменились зависимости (с прежними значениями), потом их новые setup; эффект без массива зависимостей считается изменившимся всегда. При unmount выполняются все очистки.',
      params: {
        effs: effs.map((e) => `${e.tag}${e.deps}`).join(','),
        props: props.map((p) => p.id + p.mode).join(','),
      },
    };
  },
};

export const srContextRenders: TaskGenerator = {
  id: 'fe.sr-context-renders',
  subcategoryId: UI,
  taskId: 'task:code-output',
  title: 'Перерисовки при состоянии в контексте',
  specialization: 'frontend',
  grade: 'senior',
  catalogIds: ['fe.render-perf', 'fe.state-mgmt', 'fe.architecture'],
  format: 'number',
  a: 1.3,
  b: 1.4,
  paramSpace: 1e5,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    type Kind = 'plain' | 'memo' | 'consumer' | 'memoConsumer';
    const kinds: Kind[] = ['plain', 'memo', 'consumer', 'memoConsumer'];
    const names = ['Header', 'Sidebar', 'Content', 'Footer'];
    const assigned = names.map(() => rng.pick(kinds));
    const memoValue = rng.int(0, 1) === 1;
    const events = Array.from({ length: rng.int(4, 6) }, () => (rng.int(0, 1) === 0 ? 'inc' : 'other'));
    let total = names.length; // монтирование
    for (const e of events) {
      const valueChanged = !memoValue || e === 'inc';
      for (const k of assigned) {
        if (k === 'plain' || k === 'consumer') total++;
        else if (k === 'memoConsumer' && valueChanged) total++;
      }
    }
    const comp = (name: string, k: Kind) => {
      const consumes = k === 'consumer' || k === 'memoConsumer';
      const body = [consumes ? '  const v = useContext(Ctx);' : '', `  log('${name}');`, consumes ? `  return <p>{v.count}</p>;` : '  return <p />;'].filter(Boolean);
      if (k === 'memo' || k === 'memoConsumer') return [`const ${name} = memo(function ${name}() {`, ...body, '});'];
      return [`function ${name}() {`, ...body, '}'];
    };
    const code = [
      ...names.flatMap((n, i) => [...comp(n, assigned[i]!), '']),
      'function App() {',
      '  const [count, setCount] = useState(0);',
      '  const [other, setOther] = useState(0);',
      memoValue ? '  const value = useMemo(() => ({ count }), [count]);' : '  const value = { count };',
      '  return (',
      '    <Ctx.Provider value={value}>',
      `      <button id="inc" onClick={() => setCount((c) => c + 1)} />`,
      `      <button id="other" onClick={() => setOther((o) => o + 1)} />`,
      ...names.map((n) => `      <${n} />`),
      '    </Ctx.Provider>',
      '  );',
      '}',
    ].join('\n');
    return {
      prompt: `Приложение смонтировано (App выполнено, четыре компонента выполнены по разу). Затем по порядку нажаты кнопки: ${events.join(', ')} («inc» меняет count, «other» - другое состояние App, на контекст не влияющее). Сколько раз всего была выполнена функция четырёх компонентов Header, Sidebar, Content, Footer, считая монтирование (App не считать)?`,
      code,
      answerHint: 'число',
      answerKey: String(total),
      explanation:
        'Любое изменение состояния App перерисовывает App, а вместе с ним все дочерние компоненты без memo. Компонент в memo пропускает перерисовку, пока его props равны, но потребитель контекста всё равно перерисуется, если значение контекста сменилось по Object.is. Объект { count }, созданный в теле App, новый на каждом рендере; в useMemo он меняется только вместе с count.',
      params: {
        assigned: assigned.join(','),
        memoValue,
        events: events.join(','),
      },
    };
  },
};

export const srQueryCache: TaskGenerator = {
  id: 'fe.sr-query-cache',
  subcategoryId: UI,
  taskId: 'task:code-output',
  title: 'Число запросов при кэше серверного состояния',
  specialization: 'frontend',
  grade: 'senior',
  catalogIds: ['fe.server-state', 'fe.architecture'],
  format: 'number',
  a: 1.2,
  b: 1.2,
  paramSpace: 1e5,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const stale = rng.pick([10, 30, 60]);
    const gc = rng.pick([20, 60, 120]);
    // События: монтирование/размонтирование подписчиков одного ключа запроса; число подписчиков не уходит ниже 0.
    const ev: { t: number; kind: 'mount' | 'unmount' }[] = [];
    let t = 0;
    let subs = 0;
    const n = rng.int(7, 9);
    for (let i = 0; i < n; i++) {
      t += rng.int(3, 70);
      const mount = subs === 0 || rng.int(0, 2) === 0;
      ev.push({ t, kind: mount ? 'mount' : 'unmount' });
      subs += mount ? 1 : -1;
    }
    // Модель: очередь событий, таймеры сборки мусора.
    let fetches = 0;
    let fetchedAt: number | null = null;
    let active = 0;
    let gcAt: number | null = null;
    for (const e of ev) {
      if (gcAt !== null && gcAt <= e.t) {
        fetchedAt = null; // запись удалена по таймеру
        gcAt = null;
      }
      if (e.kind === 'mount') {
        active++;
        gcAt = null;
        if (fetchedAt === null || e.t - fetchedAt >= stale) {
          fetches++;
          fetchedAt = e.t;
        }
      } else {
        active--;
        if (active === 0) gcAt = e.t + gc;
      }
    }
    return {
      prompt: `Кэш запросов работает так. Данные считаются свежими ${stale} с после загрузки. Хук при монтировании запрашивает данные, если их нет в кэше или они устарели (свежие берёт из кэша без запроса); запрос выполняется мгновенно. Когда у запроса не остаётся подписчиков, запись удаляется из кэша через ${gc} с (новая подписка до этого срока отменяет удаление). Подписчики одного и того же запроса монтируются и размонтируются в такие моменты (с): ${ev.map((e) => `${e.t} ${e.kind === 'mount' ? 'монтирование' : 'размонтирование'}`).join('; ')}. Сколько запросов к серверу выполнится?`,
      answerHint: 'число',
      answerKey: String(fetches),
      explanation: `Запрос нужен при монтировании, если записи нет (первый раз или её удалили после ${gc} с без подписчиков) или данные старше ${stale} с. Размонтирование запросов не вызывает, а активная запись не обновляется сама.`,
      params: { stale, gc, ev: ev.map((e) => `${e.t}${e.kind[0]}`).join(',') },
    };
  },
};

export const srKeyReconcile: TaskGenerator = {
  id: 'fe.sr-key-reconcile',
  subcategoryId: UI,
  taskId: 'task:code-output',
  title: 'Состояние строк списка при разных key',
  specialization: 'frontend',
  grade: 'senior',
  catalogIds: ['fe.render-lifecycle', 'fe.components'],
  format: 'text',
  a: 1.2,
  b: 1.2,
  paramSpace: 1e5,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const keyKind = rng.pick(['index', 'name', 'random', 'none'] as const);
    const all = rng.shuffle(['Анна', 'Борис', 'Вера', 'Глеб', 'Дарья', 'Егор']);
    const n = rng.int(4, 5);
    const before = all.slice(0, n);
    const typed = before.map((_, i) => `t${i + 1}`);
    const op = rng.pick(['remove', 'prepend'] as const);
    let after: string[];
    if (op === 'remove') {
      const r = rng.int(0, n - 2);
      after = before.filter((_, i) => i !== r);
    } else {
      after = [all[n]!, ...before];
    }
    // value[name] после операции: узлы DOM привязаны к ключу.
    const value = new Map<string, string>();
    after.forEach((name, i) => {
      if (keyKind === 'name') value.set(name, typed[before.indexOf(name)] ?? '');
      else if (keyKind === 'random') value.set(name, '');
      else value.set(name, typed[i] ?? ''); // index / none: узел i сохраняет текст позиции i
    });
    const ask = rng.pick(after);
    const answer = value.get(ask)!;
    const keyAttr = keyKind === 'index' ? ' key={i}' : keyKind === 'name' ? ' key={name}' : keyKind === 'random' ? ' key={Math.random()}' : '';
    const code = [
      'function Row({ name }) {',
      '  return <li><span>{name}</span><input /></li>;',
      '}',
      '',
      'function List({ items }) {',
      `  return <ul>{items.map((name, i) => <Row${keyAttr} name={name} />)}</ul>;`,
      '}',
    ].join('\n');
    return {
      prompt: `Список показан с items = [${before.map((x) => `'${x}'`).join(', ')}]. Пользователь вписал в поля строк (по порядку сверху вниз) значения ${typed.join(', ')}. После этого items стал [${after.map((x) => `'${x}'`).join(', ')}] (${op === 'remove' ? 'одну строку убрали' : 'строку добавили в начало'}). Какой текст окажется в поле строки «${ask}»? Если поле пустое, напишите «(пусто)».`,
      code,
      answerHint: 'текст в поле',
      answerKey: answer === '' ? '(пусто)' : answer,
      explanation:
        keyKind === 'name'
          ? 'key по имени привязывает состояние (введённый текст) к самой строке: оно переезжает вместе с ней, у новой строки поле пустое.'
          : keyKind === 'random'
            ? 'key, меняющийся на каждом рендере, заставляет React размонтировать и создать все строки заново - введённый текст теряется.'
            : 'При key по индексу (или без key) React сопоставляет строки по позиции: введённый текст остаётся в поле той же позиции, а имя в строке сдвигается, поэтому тексты «съезжают» относительно имён.',
      params: { keyKind, op, before: before.join(','), after: after.join(',') },
    };
  },
};

// ===========================================================================
// design-system
// ===========================================================================

export const srTsProps: TaskGenerator = {
  id: 'fe.sr-ts-props',
  subcategoryId: DS,
  taskId: 'task:ts-typecheck',
  title: 'Строка, не проходящая типы составного API компонента',
  specialization: 'frontend',
  grade: 'senior',
  catalogIds: ['fe.ts-typing', 'fe.components'],
  format: 'line',
  a: 1.3,
  b: 1.3,
  paramSpace: 1e5,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    type M = {
      kind: string;
      decl: string;
      ok: string;
      extra: string[];
      wrong: string;
    };
    const pool: M[] = [
      {
        kind: 'link',
        decl: 'href: string',
        ok: "href: '/home'",
        extra: ['href'],
        wrong: 'href: 42',
      },
      {
        kind: 'button',
        decl: 'onClick: () => void',
        ok: 'onClick: () => {}',
        extra: ['onClick'],
        wrong: "onClick: 'go'",
      },
      {
        kind: 'toggle',
        decl: 'checked: boolean',
        ok: 'checked: true',
        extra: ['checked'],
        wrong: "checked: 'yes'",
      },
      {
        kind: 'menu',
        decl: 'items: string[]',
        ok: "items: ['a', 'b']",
        extra: ['items'],
        wrong: 'items: 3',
      },
    ];
    const members = rng.sample(pool, 3);
    const decl = ['type Props = { label: string } & (', ...members.map((m, i) => `  ${i ? '| ' : '  '}{ kind: '${m.kind}'; ${m.decl} }`), ');'];
    const nLines = 5;
    const bad = rng.int(0, nLines - 1);
    const badKind = rng.int(0, 3);
    const lines: string[] = [];
    for (let i = 0; i < nLines; i++) {
      const m = members[i % members.length]!;
      const parts = [`kind: '${m.kind}'`, "label: 'x'", m.ok];
      if (i === bad) {
        if (badKind === 0)
          parts.pop(); // нет обязательного свойства варианта
        else if (badKind === 1)
          parts.push(rng.pick(members.filter((o) => o !== m)).ok); // свойство другого варианта
        else if (badKind === 2)
          parts[2] = m.wrong; // неверный тип
        else parts[0] = "kind: 'tab'"; // kind вне объединения
      }
      lines.push(`const p${i + 1}: Props = { ${rng.shuffle(parts).join(', ')} };`);
    }
    const code = [...decl, '', ...lines].join('\n');
    return {
      prompt: 'Включён strict. Ровно одна из строк с const не проходит проверку типов. Укажите её номер.',
      code,
      answerHint: 'номер строки',
      answerKey: String(decl.length + 1 + bad + 1),
      explanation:
        'Объединение различается по kind: литерал выбирает вариант, после чего объект проверяется по нему целиком - не хватает обязательного свойства, лишнее свойство соседнего варианта и неверный тип значения дают ошибку, как и kind вне объединения.',
      params: { members: members.map((m) => m.kind).join(','), bad, badKind },
    };
  },
};

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

export const srContrastAudit: TaskGenerator = {
  id: 'fe.sr-contrast-audit',
  subcategoryId: DS,
  taskId: 'task:html-semantics',
  title: 'Аудит контраста токенов темы',
  specialization: 'frontend',
  grade: 'senior',
  catalogIds: ['fe.a11y', 'fe.design-handoff'],
  format: 'number',
  a: 1.2,
  b: 1.2,
  paramSpace: 1e6,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const hex = () => `#${[0, 1, 2].map(() => rng.int(0, 255).toString(16).padStart(2, '0')).join('')}`;
    const sizes: { label: string; large: boolean }[] = [
      { label: '16px', large: false },
      { label: '14px', large: false },
      { label: '14px жирный', large: false },
      { label: '19px жирный', large: true },
      { label: '24px', large: true },
      { label: '28px', large: true },
      { label: '18px', large: false },
    ];
    const rows: {
      fg: string;
      bg: string;
      s: (typeof sizes)[number];
      fail: boolean;
    }[] = [];
    const nRows = rng.int(5, 7);
    while (rows.length < nRows) {
      const fg = hex();
      const bg = hex();
      const s = rng.pick(sizes);
      const r = ratio(fg, bg);
      const thr = s.large ? 3 : 4.5;
      if (Math.abs(r - thr) < 0.2) continue; // не берём пограничные пары
      rows.push({ fg, bg, s, fail: r < thr });
    }
    const failing = rows.filter((r) => r.fail).length;
    return {
      prompt:
        'Аудит по WCAG 2.x, уровень AA: для обычного текста контраст не ниже 4,5:1, для крупного (от 24px либо от 18,66px жирного) - не ниже 3:1. Сколько из пар «цвет текста - фон» не проходят?',
      code: rows.map((r, i) => `${i + 1}. текст ${r.fg} на фоне ${r.bg}, размер ${r.s.label}`).join('\n'),
      answerHint: 'число',
      answerKey: String(failing),
      explanation:
        'Контраст = (L1 + 0,05) / (L2 + 0,05), где L - относительная яркость (линеаризованные sRGB-каналы с весами 0,2126, 0,7152, 0,0722), L1 - светлее. Порог зависит от размера: 14px жирный ещё считается обычным текстом (крупный жирный - от 14pt ≈ 18,66px).',
      params: { rows: rows.map((r) => `${r.fg}${r.bg}${r.s.label}`).join('|') },
    };
  },
};

export const srContainerQuery: TaskGenerator = {
  id: 'fe.sr-container-query',
  subcategoryId: DS,
  taskId: 'task:css-layout',
  title: 'Колонки компонента: media против container',
  specialization: 'frontend',
  grade: 'senior',
  catalogIds: ['fe.css-architecture', 'fe.responsive'],
  format: 'number',
  a: 1.1,
  b: 1.1,
  paramSpace: 1e5,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const cw = rng.pick([320, 360, 400, 480]);
    const mw = rng.pick([768, 900, 1024]);
    const cCols = rng.pick([2, 3]);
    const mCols = rng.pick([2, 4]);
    const containerLast = rng.int(0, 1) === 1;
    const containerRule = `@container (min-width: ${cw}px) { .cards { grid-template-columns: repeat(${cCols}, 1fr); } }`;
    const mediaRule = `@media (min-width: ${mw}px) { .cards { grid-template-columns: repeat(${mCols}, 1fr); } }`;
    const css = ['.panel { container-type: inline-size; }', '.cards { display: grid; grid-template-columns: 1fr; }', ...(containerLast ? [mediaRule, containerRule] : [containerRule, mediaRule])].join(
      '\n',
    );
    const places = Array.from({ length: 4 }, () => ({
      vw: rng.int(5, 16) * 100 - 20,
      panel: rng.int(6, 22) * 40,
    }));
    const cols = places.map((p) => {
      let c = 1;
      const m = p.vw >= mw ? mCols : 0;
      const k = p.panel >= cw ? cCols : 0;
      if (containerLast) c = k || m || 1;
      else c = m || k || 1;
      return c;
    });
    const total = cols.reduce((s, c) => s + c, 0);
    return {
      prompt:
        'Компонент .cards лежит внутри .panel. Правила одинаковой специфичности: при совпадении нескольких побеждает написанное ниже. @container сравнивает ширину ближайшего предка-контейнера (.panel), @media - ширину окна. В четырёх местах заданы ширина окна и ширина .panel. Сколько колонок получится суммарно во всех четырёх местах?',
      code: `${css}\n\n${places.map((p, i) => `место ${i + 1}: окно ${p.vw}px, .panel ${p.panel}px`).join('\n')}`,
      answerHint: 'сумма колонок',
      answerKey: String(total),
      explanation: `Для каждого места проверяем оба условия независимо: окно ≥ ${mw}px даёт ${mCols} колонки, ширина панели ≥ ${cw}px даёт ${cCols}. Если выполнены оба, выигрывает правило, написанное ниже (${containerLast ? '@container' : '@media'}). Колонки: ${cols.join(' + ')} = ${total}.`,
      params: {
        cw,
        mw,
        cCols,
        mCols,
        containerLast,
        places: places.map((p) => `${p.vw}/${p.panel}`).join(','),
      },
    };
  },
};

export const srBarrelCost: TaskGenerator = {
  id: 'fe.sr-barrel-cost',
  subcategoryId: DS,
  taskId: 'task:web-vitals',
  title: 'Цена импорта из barrel-файла библиотеки',
  specialization: 'frontend',
  grade: 'senior',
  catalogIds: ['fe.bundler', 'fe.components'],
  format: 'number',
  a: 1.1,
  b: 1.3,
  paramSpace: 1e5,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const names = rng.shuffle(['Button', 'Modal', 'Select', 'Tabs', 'Tooltip', 'Table']).slice(0, 5);
    const size: Record<string, number> = {};
    for (const nm of names) size[nm] = rng.int(2, 24) * 2;
    const deps: Record<string, string[]> = {};
    names.forEach((nm, i) => {
      deps[nm] = names
        .slice(0, i)
        .filter(() => rng.int(0, 3) === 0)
        .slice(0, 2);
    });
    const effectful = new Set(rng.sample(names, rng.int(1, 2)));
    const mode = rng.pick(['false', 'array', 'true'] as const);
    const used = rng.sample(names, rng.int(1, 2));
    const closure = new Set<string>();
    const walk = (m: string) => {
      if (closure.has(m)) return;
      closure.add(m);
      deps[m]!.forEach(walk);
    };
    used.forEach(walk);
    const included = new Set(closure);
    if (mode === 'true') names.forEach((m) => included.add(m));
    if (mode === 'array') effectful.forEach((m) => included.add(m));
    // Побочные эффекты включённых модулей тянут их зависимости.
    const addDeps = (m: string) => {
      for (const d of deps[m]!) {
        if (included.has(d)) continue;
        included.add(d);
        addDeps(d);
      }
    };
    [...included].forEach(addDeps);
    const total = [...included].reduce((s, m) => s + size[m]!, 0);
    const sideEffects = mode === 'false' ? 'false' : mode === 'true' ? 'true' : `[${[...effectful].map((m) => `"./src/${m}.js"`).join(', ')}]`;
    const code = [
      `// package.json библиотеки: "sideEffects": ${sideEffects}`,
      '// src/index.js (barrel):',
      ...names.map((m) => `export { ${m} } from './${m}.js';`),
      '',
      ...names.map(
        (m) => `// ${m}.js - ${size[m]} кБ${effectful.has(m) ? ', при загрузке регистрирует глобальные стили (побочный эффект)' : ''}${deps[m]!.length ? `, импортирует ${deps[m]!.join(', ')}` : ''}`,
      ),
      '',
      `// приложение: import { ${used.join(', ')} } from 'ui-lib';`,
    ].join('\n');
    return {
      prompt:
        'Сборка в production, сборщик умеет tree-shaking (webpack 5). Правила: модуль входит в бандл, если используется его экспорт (прямо или через зависимость), либо если он помечен как имеющий побочные эффекты (sideEffects: true - все модули пакета; список файлов - только они; false - никто). Побочный эффект включённого модуля тянет и его зависимости. Какой размер (кБ) библиотеки попадёт в бандл? Размер barrel-файла не считать.',
      code,
      answerHint: 'килобайты, число',
      answerKey: String(total),
      explanation: `Используются ${used.join(', ')} и их зависимости; к ним добавляются модули с побочными эффектами по правилу sideEffects: ${sideEffects}. Итого ${[...included].sort().join(', ')} - ${total} кБ. Поэтому "sideEffects": false при модулях с побочными эффектами теряет стили, а true сводит tree-shaking на нет.`,
      params: { mode, used: used.join(','), eff: [...effectful].join(',') },
    };
  },
};

// ===========================================================================
// web-perf
// ===========================================================================

export const srRenderStrategy: TaskGenerator = {
  id: 'fe.sr-render-strategy',
  subcategoryId: WP,
  taskId: 'task:web-vitals',
  title: 'Время до интерактивности при разных способах рендера',
  specialization: 'frontend',
  grade: 'senior',
  catalogIds: ['fe.ssr', 'fe.web-perf', 'fe.architecture'],
  format: 'number',
  a: 1.2,
  b: 1.6,
  paramSpace: 1e5,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const js = rng.int(4, 12) * 100; // загрузка и выполнение JS
    const hydr = rng.int(1, 5) * 100;
    const main = rng.int(2, 8) * 100; // данные основного блока
    const slow = rng.int(2, 10) * 200; // данные медленного виджета
    const strategy = rng.pick(['csr', 'ssr', 'stream'] as const);
    const done = Math.max(main, slow);
    let tti: number;
    if (strategy === 'csr') tti = js + main;
    else if (strategy === 'ssr') tti = done + js + hydr;
    else tti = Math.max(js, main) + hydr;
    const label = strategy === 'csr' ? 'клиентский рендер (CSR)' : strategy === 'ssr' ? 'SSR с ожиданием всех данных' : 'потоковый SSR (Suspense вокруг медленного виджета)';
    return {
      prompt: `Модель (все времена в мс от начала запроса, сеть мгновенна): данные основного блока готовы за ${main}, медленного виджета - за ${slow}; загрузка и выполнение JS занимают ${js} и начинаются, как только браузер получил первый байт HTML (предзагрузка в <head>); гидратация занимает ${hydr}. CSR: HTML-оболочка приходит сразу, данные запрашиваются после выполнения JS (основной блок и виджет параллельно), страница интерактивна, когда JS выполнен и основной блок отрисован. SSR с ожиданием: сервер отправляет HTML только когда готовы все данные. Потоковый SSR: оболочка уходит сразу, основной блок вставляется в HTML, когда готов, виджет - позже; гидратация основного блока начинается, когда есть и код, и его HTML. Через сколько мс интерактивен основной блок при: ${label}?`,
      answerHint: 'миллисекунды',
      answerKey: String(tti),
      explanation:
        strategy === 'csr'
          ? `Сначала ждём JS (${js}), затем данные (${main}): ${tti}.`
          : strategy === 'ssr'
            ? `HTML выходит после самых медленных данных (${done}), потом JS (${js}) и гидратация (${hydr}): ${tti}.`
            : `JS грузится параллельно со сборкой основного блока: max(${js}, ${main}) и затем гидратация ${hydr}: ${tti}. Медленный виджет интерактивность основного блока не задерживает.`,
      params: { js, hydr, main, slow, strategy },
    };
  },
};

export const srLcpPhases: TaskGenerator = {
  id: 'fe.sr-lcp-phases',
  subcategoryId: WP,
  taskId: 'task:web-vitals',
  title: 'LCP по фазам после оптимизаций',
  specialization: 'frontend',
  grade: 'senior',
  catalogIds: ['fe.web-perf', 'fe.render-perf'],
  format: 'number',
  a: 1.1,
  b: 1.3,
  paramSpace: 1e6,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const ttfb = rng.int(3, 9) * 100;
    const delay = rng.int(2, 9) * 100;
    const dur = rng.int(3, 12) * 100;
    const render = rng.int(1, 6) * 50;
    const lcp = ttfb + delay + dur + render;
    const fixes = rng.sample(['preload', 'compress', 'cdn'] as const, rng.int(1, 3));
    const q = rng.pick([50, 60, 70]);
    const x = rng.pick([100, 150, 200]);
    let nd = delay;
    let nu = dur;
    let nt = ttfb;
    if (fixes.includes('preload')) nd = 0;
    if (fixes.includes('compress')) nu = Math.round((dur * q) / 100);
    if (fixes.includes('cdn')) nt = Math.max(100, ttfb - x);
    const answer = nt + nd + nu + render;
    const f: Record<string, string> = {
      preload: 'добавили <link rel="preload"> для изображения: запрос стартует сразу после получения HTML (задержка загрузки становится 0)',
      compress: `сжали изображение: время загрузки ресурса стало ${q} % от прежнего (округлить до целых)`,
      cdn: `включили CDN: TTFB уменьшился на ${x} мс (но не ниже 100)`,
    };
    return {
      prompt: `Метки навигации (мс): ответ HTML получен (TTFB) на ${ttfb}; запрос LCP-изображения начался на ${ttfb + delay}; изображение загружено на ${ttfb + delay + dur}; элемент отрисован на ${lcp}. LCP = момент отрисовки. Фазы: TTFB, задержка начала загрузки, длительность загрузки, задержка отрисовки. Применили: ${fixes.map((x2) => f[x2]).join('; ')}. Остальные фазы не изменились. Каким станет LCP, мс?`,
      answerHint: 'миллисекунды',
      answerKey: String(answer),
      explanation: `Фазы до: TTFB ${ttfb}, задержка ${delay}, загрузка ${dur}, отрисовка ${render} (сумма ${lcp}). После правок: ${nt} + ${nd} + ${nu} + ${render} = ${answer}.`,
      params: { ttfb, delay, dur, render, fixes: fixes.join(',') },
    };
  },
};

export const srCacheStale: TaskGenerator = {
  id: 'fe.sr-cache-stale',
  subcategoryId: WP,
  taskId: 'task:web-vitals',
  title: 'Устаревшие ресурсы после выкладки',
  specialization: 'frontend',
  grade: 'senior',
  catalogIds: ['fe.web-perf', 'fe.bundler'],
  format: 'number',
  a: 1.1,
  b: 1.5,
  paramSpace: 1e5,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    type A = {
      name: string;
      strategy: 'hashed' | 'maxage' | 'nocache';
      maxAge: number;
      changed: boolean;
    };
    const names = rng.shuffle(['app.js', 'vendor.js', 'main.css', 'logo.svg', 'fonts.css', 'data.json', 'sw.js']);
    const assets: A[] = names.slice(0, rng.int(5, 7)).map((name) => ({
      name,
      strategy: rng.pick(['hashed', 'maxage', 'nocache'] as const),
      maxAge: rng.pick([3600, 86400, 604800]),
      changed: rng.int(0, 2) > 0,
    }));
    const visit = rng.pick([1800, 43200, 259200]); // секунд между визитами
    // Устаревшим пользователь увидит: изменённый ресурс без хеша в имени, закэшированный с max-age, пока тот не истёк.
    const stale = assets.filter((a) => a.strategy === 'maxage' && a.changed && visit < a.maxAge).length;
    const label = (s: string) =>
      s === 'hashed' ? 'имя с хешем содержимого, Cache-Control: max-age=31536000, immutable' : s === 'maxage' ? 'имя без хеша' : 'имя без хеша, Cache-Control: no-cache (ETag)';
    return {
      prompt: `Пользователь открыл сайт, затем между визитами сайт выкатили заново (HTML не кэшируется и всегда свежий и ссылается на актуальные имена), и пользователь вернулся через ${visit} с после первого визита. Для «имя без хеша» указан max-age ресурса. Сколько ресурсов пользователь на втором визите получит из кэша в устаревшей версии, хотя на сервере файл уже изменился?`,
      code: assets.map((a) => `${a.name.padEnd(10)} ${a.changed ? 'изменён' : 'не менялся'}; ${label(a.strategy)}${a.strategy === 'maxage' ? `; max-age=${a.maxAge}` : ''}`).join('\n'),
      answerHint: 'число',
      answerKey: String(stale),
      explanation:
        'С хешем в имени новая версия получает новый URL, и кэш старого не мешает; no-cache требует повторной проверки при каждом использовании. Устареть могут только файлы без хеша с max-age, пока их срок не вышел и сервер файл уже изменил.',
      params: {
        visit,
        assets: assets.map((a) => `${a.name}${a.strategy[0]}${+a.changed}${a.maxAge}`).join(','),
      },
    };
  },
};

export const srMemoCost: TaskGenerator = {
  id: 'fe.sr-memo-cost',
  subcategoryId: WP,
  taskId: 'task:web-vitals',
  title: 'Выигрыш или проигрыш от мемоизации',
  specialization: 'frontend',
  grade: 'senior',
  catalogIds: ['fe.render-perf', 'fe.architecture'],
  format: 'number',
  a: 1.0,
  b: 1.4,
  paramSpace: 1e5,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const renders = rng.int(8, 14);
    const K = rng.pick([1, 2, 3]); // стоимость сравнения props, мс
    type C = { name: string; R: number; stable: boolean; changes: number };
    const names = rng.shuffle(['Chart', 'Table', 'Card', 'Menu', 'Badge']).slice(0, 3);
    const comps: C[] = names.map((name) => {
      const stable = rng.int(0, 2) > 0;
      const R = rng.pick([2, 5, 8, 12, 20]);
      return {
        name,
        R,
        stable,
        changes: stable ? rng.int(0, Math.floor(renders / 2)) : renders,
      };
    });
    // С memo: сравнение K при каждом рендере родителя + настоящая перерисовка только при изменении props.
    const gain = (c: C) => renders * c.R - (renders * K + c.changes * c.R);
    const total = comps.reduce((s, c) => s + gain(c), 0);
    return {
      prompt: `Родитель перерисовался ${renders} раз. Сравнение props у React.memo стоит ${K} мс на каждый рендер родителя (для каждого компонента). Каждый компонент ниже можно обернуть в memo. Без memo он перерисовывается на каждый рендер родителя и тратит R мс. Сколько мс суммарно выиграют (отрицательное число - проиграют), если обернуть в memo все три компонента?`,
      code: comps
        .map(
          (c) =>
            `${c.name.padEnd(6)} R = ${String(c.R).padStart(2)} мс; ${c.stable ? `props стабильны, реально меняются в ${c.changes} из ${renders} рендеров` : 'в props передаётся новый объект/функция на каждом рендере'}`,
        )
        .join('\n'),
      answerHint: 'миллисекунды (может быть отрицательным)',
      answerKey: String(total),
      explanation:
        'С memo: родитель платит за сравнение props каждый раз, а компонент перерисовывается только когда props изменились; если в props каждый раз новая ссылка, мемоизация не срабатывает вовсе и остаётся только цена сравнения. Выигрыш компонента = renders·R − (renders·K + изменения·R).',
      params: {
        renders,
        K,
        comps: comps.map((c) => `${c.R}${+c.stable}${c.changes}`).join(','),
      },
    };
  },
};

// ===========================================================================
// realtime
// ===========================================================================

export const srHeartbeat: TaskGenerator = {
  id: 'fe.sr-heartbeat',
  subcategoryId: RT,
  taskId: 'task:code-output',
  title: 'Когда клиент решит, что соединение мертво',
  specialization: 'frontend',
  grade: 'senior',
  catalogIds: ['fe.realtime-client', 'fe.architecture'],
  format: 'number',
  a: 1.2,
  b: 1.2,
  paramSpace: 1e5,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const P = rng.pick([2000, 3000, 5000]);
    const T = rng.pick([4000, 6000, 8000, 11000]);
    const n = rng.int(5, 8);
    const rtts: (number | null)[] = Array.from({ length: n }, () => (rng.int(0, 3) === 0 ? null : rng.int(2, 40) * 50));
    // Моменты прихода pong: ping k отправлен в k·P.
    const arrivals = rtts
      .map((r, i) => (r === null ? null : (i + 1) * P + r))
      .filter((x): x is number => x !== null)
      .sort((x, y) => x - y);
    let prev = 0;
    let close = -1;
    for (const a of arrivals) {
      if (a - prev > T) {
        close = prev + T;
        break;
      }
      prev = a;
    }
    if (close < 0) close = prev + T;
    return {
      prompt: `Клиент отправляет ping каждые ${P} мс (первый - на ${P}-й мс от открытия соединения). Сервер отвечает pong; ответ на k-й ping приходит через указанное время (прочерк - ответ потерян). Правило: если с момента открытия или с прихода последнего pong прошло более ${T} мс, клиент закрывает соединение ровно на ${T}-й мс после этого момента. После последнего перечисленного ping новых ping и pong нет. На какой мс от открытия соединения клиент его закроет?`,
      code: rtts.map((r, i) => `ping ${i + 1} (на ${(i + 1) * P} мс): ${r === null ? 'ответ потерян' : `pong через ${r} мс`}`).join('\n'),
      answerHint: 'миллисекунды',
      answerKey: String(close),
      explanation: `Отсчёт идёт от последнего пришедшего pong, а не от последнего отправленного ping: потерянные ответы сами по себе ничего не закрывают, пока не наберётся пауза больше ${T} мс. Моменты прихода: ${arrivals.join(', ')}. Закрытие на ${close}.`,
      params: { P, T, rtts: rtts.map((r) => r ?? 'x').join(',') },
    };
  },
};

export const srOtInsert: TaskGenerator = {
  id: 'fe.sr-ot-insert',
  subcategoryId: RT,
  taskId: 'task:code-output',
  title: 'Итог слияния одновременных вставок',
  specialization: 'frontend',
  grade: 'senior',
  catalogIds: ['fe.realtime-client', 'fe.architecture'],
  format: 'text',
  a: 1.2,
  b: 1.5,
  paramSpace: 1e6,
  timeLimitSec: 270,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const base = rng.pick(['HELLO', 'WORLD', 'DESIGN', 'SERVER', 'CLIENT']);
    const clients = ['A', 'B', 'C'];
    const texts = rng.shuffle(['x', 'yy', 'z', 'ww', 'qq', 'k']);
    const ops = clients.map((c, i) => ({
      c,
      pos: rng.int(0, base.length),
      text: texts[i]!,
    }));
    const order = rng.shuffle(ops); // порядок принятия сервером
    // Алгоритм: каждая следующая операция преобразуется относительно уже принятых.
    const applied: { pos: number; text: string }[] = [];
    let doc = base;
    for (const op of order) {
      let pos = op.pos;
      for (const a of applied) if (a.pos <= pos) pos += a.text.length;
      applied.push({ pos, text: op.text });
      doc = doc.slice(0, pos) + op.text + doc.slice(pos);
    }
    return {
      prompt: `Три клиента одновременно (от одной и той же версии документа «${base}») вставили текст: позиция - индекс символа в исходном документе, куда вставляется текст (0 - перед первым). Сервер принял операции в порядке: ${order.map((o) => o.c).join(', ')}. Каждую следующую операцию он преобразует относительно уже принятых: если принятая вставка стоит в исходной позиции не правее, текущая сдвигается на длину её текста (при равных позициях раньше принятая стоит левее). Какой документ получится в конце?`,
      code: ops.map((o) => `клиент ${o.c}: вставить «${o.text}» в позицию ${o.pos}`).join('\n'),
      answerHint: 'итоговый текст',
      answerKey: doc,
      explanation: `Итоговый документ не зависит от того, чьи правки преобразуются: для каждой исходной позиции вставки идут слева направо в порядке принятия сервером. Результат: ${doc}.`,
      params: {
        base,
        ops: ops.map((o) => `${o.c}${o.pos}${o.text}`).join(','),
        order: order.map((o) => o.c).join(''),
      },
    };
  },
};

export const srIdempotentRetry: TaskGenerator = {
  id: 'fe.sr-idempotent-retry',
  subcategoryId: RT,
  taskId: 'task:code-output',
  title: 'Повторы запросов и итоговое значение на сервере',
  specialization: 'frontend',
  grade: 'senior',
  catalogIds: ['fe.api-client', 'fe.server-state', 'fe.architecture'],
  format: 'number',
  a: 1.2,
  b: 1.3,
  paramSpace: 1e5,
  timeLimitSec: 270,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const T = rng.pick([1000, 2000, 3000]);
    const R = rng.int(2, 4);
    const withKey = rng.int(0, 1) === 1;
    const start = rng.int(1, 9) * 100;
    const nOps = rng.int(2, 3);
    type Op = { amount: number; tries: (number | null)[] };
    const ops: Op[] = Array.from({ length: nOps }, () => ({
      amount: rng.int(1, 9) * 10,
      tries: Array.from({ length: R }, () => (rng.int(0, 5) === 0 ? null : rng.pick([T / 2, T * 0.8, T * 1.5, T * 2.5]))),
    }));
    let balance = start;
    for (const op of ops) {
      let reached = 0;
      for (const t of op.tries) {
        if (t !== null) reached++; // запрос дошёл до сервера (даже если ответ опоздал)
        if (t !== null && t <= T) break; // успех в срок - повторов больше нет
      }
      balance += op.amount * (withKey ? Math.min(1, reached) : reached);
    }
    const fmt = (t: number | null) => (t === null ? 'потерян по пути' : `сервер отвечает через ${t} мс`);
    return {
      prompt: `Клиент платит запросом POST /pay (сумма в строках ниже). Таймаут запроса - ${T} мс: если ответа нет в срок, клиент отправляет тот же запрос повторно, всего не больше ${R} попыток на операцию; пришёл ответ в срок - повторов нет. Запрос, который дошёл до сервера, выполняется всегда, даже если клиент уже не ждёт. ${withKey ? 'Каждая операция отправляется с одним и тем же ключом идемпотентности: сервер выполняет её не больше одного раза.' : 'Ключа идемпотентности нет: каждый дошедший запрос выполняется.'} Исходный баланс - ${start}. Какой баланс на сервере в конце? (Операции идут по очереди.)`,
      code: ops.map((o, i) => `операция ${i + 1}: +${o.amount}; попытки: ${o.tries.map((t, j) => `${j + 1}) ${fmt(t)}`).join('; ')}`).join('\n'),
      answerHint: 'число',
      answerKey: String(balance),
      explanation:
        'Повторы после таймаута создают дубликаты на сервере, если он принял исходный запрос: клиент не знает, потерян запрос или ответ. Ключ идемпотентности делает повтор безопасным - сумма применяется один раз, если хоть одна попытка дошла.',
      params: {
        T,
        R,
        withKey,
        ops: ops.map((o) => `${o.amount}:${o.tries.join('/')}`).join(','),
      },
    };
  },
};

export const srReplayWindow: TaskGenerator = {
  id: 'fe.sr-replay-window',
  subcategoryId: RT,
  taskId: 'task:code-output',
  title: 'Воспроизведение пропущенных событий после обрыва',
  specialization: 'frontend',
  grade: 'senior',
  catalogIds: ['fe.realtime-client', 'fe.architecture'],
  format: 'number',
  a: 1.1,
  b: 1.4,
  paramSpace: 1e5,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const rate = rng.int(2, 6); // событий в секунду
    const T = rng.pick([30, 60, 120]); // сколько секунд сервер хранит события
    const B = rng.pick([100, 200, 400]); // и не больше стольких событий
    const gaps = Array.from({ length: rng.int(4, 6) }, () => rng.pick([5, 20, 45, 90, 150, 300]));
    let replayed = 0;
    let resyncs = 0;
    for (const d of gaps) {
      const missed = rate * d;
      if (d <= T && missed <= B) replayed += missed;
      else resyncs++;
    }
    return {
      prompt: `Сервер публикует ${rate} событий в секунду с возрастающими id. Он хранит буфер: события не старше ${T} с и не больше ${B} штук (самые новые). Клиент после обрыва переподключается с Last-Event-ID: если все пропущенные события ещё в буфере, сервер присылает их по порядку (воспроизведение), иначе присылает команду «сбросить состояние» и клиент заново загружает всё целиком (событий воспроизведения нет). Обрывы длились (с): ${gaps.join(', ')}. Сколько событий всего будет получено через воспроизведение?`,
      answerHint: 'число',
      answerKey: String(replayed),
      explanation: `Для обрыва длиной d пропущено ${rate}·d событий. Воспроизведение возможно только если d ≤ ${T} с и пропущено не больше ${B} событий; иначе - полная перезагрузка (${resyncs} раз, события не считаются). Итого воспроизведено ${replayed}.`,
      params: { rate, T, B, gaps: gaps.join(',') },
    };
  },
};

export const SENIOR_GENERATORS: TaskGenerator[] = [
  srEffectLifecycle,
  srContextRenders,
  srQueryCache,
  srKeyReconcile,
  srTsProps,
  srContrastAudit,
  srContainerQuery,
  srBarrelCost,
  srRenderStrategy,
  srLcpPhases,
  srCacheStale,
  srMemoCost,
  srHeartbeat,
  srOtInsert,
  srIdempotentRetry,
  srReplayWindow,
];
