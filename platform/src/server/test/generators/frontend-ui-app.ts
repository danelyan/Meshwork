// Генераторы frontend.ui-app (SPA из макета: состояние, формы, роутинг, серверное состояние).
// Ключ считает код генератора, не LLM (R-T-02); юнит-тест сверяет его независимым решением
// (tests/unit/test/frontend-subcategories.test.ts). a, b — ПРЕДЛОЖЕНИЕ, калибруются персонами.
// Поведение React (батчинг setState, сравнение зависимостей эффекта через Object.is) и ранжирование
// маршрутов React Router v6 сверено с документацией через Context7 10.10.
import { createRng } from '../rng';
import type { TaskGenerator, TaskInstance } from '../types';

const SUB = 'frontend.ui-app';

// --- Junior: валидация формы -------------------------------------------------

export const formValidation: TaskGenerator = {
  id: 'fe.form-validation',
  subcategoryId: SUB,
  taskId: 'task:code-output',
  title: 'Какие поля формы не прошли валидацию',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.forms', 'fe.js-core'],
  format: 'list',
  a: 1.3,
  b: -0.9,
  paramSpace: 1e5,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const minAge = rng.pick([16, 18, 21]);
    const maxAge = rng.pick([60, 65, 70]);
    const minLen = rng.pick([6, 8, 10]);
    type Field = {
      name: string;
      rule: string;
      valid: string[];
      invalid: string[];
    };
    const fields: Field[] = [
      {
        name: 'name',
        rule: `f.name.trim() === ''`,
        valid: [`'Анна'`, `'Борис'`, `' Вера '`],
        invalid: [`''`, `'   '`],
      },
      {
        name: 'email',
        rule: `!/^\\S+@\\S+\\.\\S+$/.test(f.email)`,
        valid: [`'anna@mail.ru'`, `'b.k@corp.io'`],
        invalid: [`'anna@mail'`, `'anna.mail.ru'`, `'anna@ mail.ru'`],
      },
      {
        name: 'age',
        rule: `f.age < ${minAge} || f.age > ${maxAge}`,
        valid: [String(minAge), String(maxAge), String(minAge + 7)],
        invalid: [String(minAge - 1), String(maxAge + 1)],
      },
      {
        name: 'password',
        rule: `f.password.length < ${minLen}`,
        valid: [`'${'x'.repeat(minLen)}'`, `'${'k7'.repeat(minLen)}'`],
        invalid: [`'${'x'.repeat(minLen - 1)}'`, `'abc'`],
      },
      { name: 'agree', rule: `!f.agree`, valid: ['true'], invalid: ['false'] },
    ];
    const chosen = rng.sample(fields, 4);
    const nBad = rng.int(1, 3);
    const badSet = new Set(
      rng.sample(
        chosen.map((c) => c.name),
        nBad,
      ),
    );
    const values = chosen.map((c) => (badSet.has(c.name) ? rng.pick(c.invalid) : rng.pick(c.valid)));
    const code = [
      'function validate(f) {',
      '  const errors = [];',
      ...chosen.map((c) => `  if (${c.rule}) errors.push('${c.name}');`),
      '  return errors;',
      '}',
      '',
      `const form = { ${chosen.map((c, i) => `${c.name}: ${values[i]}`).join(', ')} };`,
      'console.log(validate(form));',
    ].join('\n');
    const key = [...badSet].sort().join(',');
    return {
      prompt: 'Какие поля вернёт validate(form) - то есть не прошли проверку? Перечислите имена полей через запятую (порядок не важен).',
      code,
      answerHint: 'имена полей через запятую',
      answerKey: key,
      explanation: `Условие в if описывает ошибку: границы считаются нестрого там, где написано < и >, так что значения ровно на границе допустимы. Ошибочные поля: ${key}.`,
      params: {
        minAge,
        maxAge,
        minLen,
        fields: chosen.map((c) => c.name).join(','),
        bad: key,
      },
    };
  },
};

// --- Junior: роутинг -----------------------------------------------------------

/** Очки сегментов как в React Router v6: статический 10, динамический 3, splat -2, плюс число сегментов. */
function routeScore(path: string): number {
  const segs = path.split('/').filter(Boolean);
  if (segs.length === 0) return 4; // индекс «/»
  let s = segs.length;
  for (const seg of segs) s += seg === '*' ? -2 : seg.startsWith(':') ? 3 : 10;
  return s;
}

function routeMatches(pattern: string, url: string): boolean {
  const ps = pattern.split('/').filter(Boolean);
  const us = url.split('/').filter(Boolean);
  for (let i = 0; i < ps.length; i++) {
    if (ps[i] === '*') return true;
    if (i >= us.length) return false;
    if (!ps[i]!.startsWith(':') && ps[i] !== us[i]) return false;
  }
  return ps.length === us.length;
}

export const routeMatch: TaskGenerator = {
  id: 'fe.route-match',
  subcategoryId: SUB,
  taskId: 'task:code-output',
  title: 'Какой маршрут отрисуется',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.routing'],
  format: 'text',
  a: 1.3,
  b: -0.6,
  paramSpace: 5e3,
  timeLimitSec: 120,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const base = rng.pick(['users', 'orders', 'teams', 'projects']);
    const other = rng.pick(['docs', 'help', 'blog']);
    const pool = [`/${base}`, `/${base}/:id`, `/${base}/new`, `/${base}/:id/edit`, `/${other}/*`, `/${other}/api`, '*'];
    const routes = rng.shuffle([...rng.sample(pool.slice(0, 6), rng.int(4, 5)), '*']);
    if (!routes.includes(`/${base}/:id`) && !routes.includes(`/${other}/*`)) routes.push(`/${base}/:id`);
    const urls = [
      `/${base}/new`,
      `/${base}/${rng.int(2, 99)}`,
      `/${base}/${rng.int(2, 99)}/edit`,
      `/${other}/api`,
      `/${other}/guide/${rng.int(1, 9)}`,
      `/${rng.pick(['pricing', 'about', 'contact'])}`,
      `/${base}`,
    ];
    const candidates = urls.filter((u) => routes.some((r) => routeMatches(r, u)));
    const url = rng.pick(candidates);
    const matched = routes.filter((r) => routeMatches(r, url));
    const best = matched.reduce((x, y) => (routeScore(y) > routeScore(x) ? y : x));
    const code = ['<Routes>', ...routes.map((r, i) => `  <Route path="${r}" element={<Page${i + 1} />} />`), '</Routes>'].join('\n');
    return {
      prompt: `React Router v6: порядок <Route> в списке не задаёт приоритет. Пользователь открыл адрес ${url}. Какой path у маршрута, чей элемент отрисуется?`,
      code,
      answerHint: 'path маршрута, например /users/:id',
      answerKey: best,
      explanation: `Подходящих маршрутов: ${matched.join(', ')}. Роутер ранжирует по специфичности: статический сегмент важнее динамического (:id), динамический - важнее * (splat), порядок в списке не важен. Побеждает ${best}.`,
      params: { url, routes: routes.join('|') },
    };
  },
};

// --- Middle: батчинг setState --------------------------------------------------

export const setstateBatching: TaskGenerator = {
  id: 'fe.setstate-batching',
  subcategoryId: SUB,
  taskId: 'task:code-output',
  title: 'Значение счётчика после клика',
  specialization: 'frontend',
  grade: 'middle',
  catalogIds: ['fe.state-mgmt', 'fe.render-lifecycle'],
  format: 'number',
  a: 1.2,
  b: 0.3,
  paramSpace: 1e5,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const start = rng.int(1, 9);
    type Op = {
      src: string;
      apply: (state: number, snapshot: number) => number;
    };
    const makeOp = (): Op => {
      const k = rng.int(1, 5);
      switch (rng.int(0, 3)) {
        case 0:
          return {
            src: `setCount(count + ${k});`,
            apply: (_s, snap) => snap + k,
          };
        case 1:
          return { src: `setCount((c) => c + ${k});`, apply: (s) => s + k };
        case 2:
          return {
            src: `setCount((c) => c * ${Math.max(2, k % 4)});`,
            apply: (s) => s * Math.max(2, k % 4),
          };
        default:
          return {
            src: `setCount(count * ${Math.max(2, k % 4)});`,
            apply: (_s, snap) => snap * Math.max(2, k % 4),
          };
      }
    };
    const ops = Array.from({ length: rng.int(3, 5) }, makeOp);
    let state = start;
    for (const op of ops) state = op.apply(state, start);
    const code = [
      'function Counter() {',
      `  const [count, setCount] = useState(${start});`,
      '  function onClick() {',
      ...ops.map((o) => `    ${o.src}`),
      '  }',
      '  return <button onClick={onClick}>{count}</button>;',
      '}',
    ].join('\n');
    return {
      prompt: 'Один клик по кнопке. Какое число покажет кнопка после обработки клика и перерисовки? (StrictMode выключен.)',
      code,
      answerHint: 'число',
      answerKey: String(state),
      explanation: `Обработчик видит снимок count = ${start} и не меняет его между вызовами. Значение (count + k) заменяет очередь целиком, функция (c) => … применяется к результату предыдущего шага. Очередь React выполняется по порядку и даёт ${state}.`,
      params: { start, ops: ops.map((o) => o.src).join(' ') },
    };
  },
};

// --- Middle: зависимости эффекта -------------------------------------------------

export const effectDeps: TaskGenerator = {
  id: 'fe.effect-deps',
  subcategoryId: SUB,
  taskId: 'task:code-output',
  title: 'Сколько раз сработают эффекты',
  specialization: 'frontend',
  grade: 'middle',
  catalogIds: ['fe.render-lifecycle', 'fe.server-state'],
  format: 'number',
  a: 1.3,
  b: 0.7,
  paramSpace: 2e5,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    type Eff = {
      decl: string;
      runs: (props: { userId: number; filter: string }[]) => number;
    };
    const changes = (props: { userId: number; filter: string }[], key: 'userId' | 'filter') => props.slice(1).filter((p, i) => !Object.is(p[key], props[i]![key])).length;
    const effects: Eff[] = [
      { decl: `useEffect(() => { log('once'); }, []);`, runs: () => 1 },
      {
        decl: `useEffect(() => { log('user', userId); }, [userId]);`,
        runs: (p) => 1 + changes(p, 'userId'),
      },
      {
        decl: `useEffect(() => { log('filter', filter); }, [filter]);`,
        runs: (p) => 1 + changes(p, 'filter'),
      },
      {
        decl: `useEffect(() => { log('options', options); }, [options]);`,
        runs: (p) => p.length,
      },
      { decl: `useEffect(() => { log('every'); });`, runs: (p) => p.length },
      {
        decl: `useEffect(() => { log('id', query.id); }, [query.id]);`,
        runs: (p) => 1 + changes(p, 'userId'),
      },
    ];
    const picked = rng.sample(effects, 3);
    const nRenders = rng.int(4, 6);
    const filters = ['all', 'new', 'done'];
    const props: { userId: number; filter: string }[] = [{ userId: rng.int(1, 5), filter: rng.pick(filters) }];
    for (let i = 1; i < nRenders; i++) {
      const prev = props[i - 1]!;
      const c = rng.int(0, 3);
      props.push({
        userId: c === 1 || c === 3 ? prev.userId + 1 : prev.userId,
        filter: c === 2 || c === 3 ? rng.pick(filters.filter((f) => f !== prev.filter)) : prev.filter,
      });
    }
    const total = picked.reduce((s, e) => s + e.runs(props), 0);
    const code = [
      'function Panel({ userId, filter }) {',
      '  const options = { filter };',
      '  const query = { id: userId };',
      ...picked.map((e) => `  ${e.decl}`),
      '  return null;',
      '}',
      '',
      '// Родитель рисует <Panel/> со свойствами по порядку:',
      ...props.map((p, i) => `// рендер ${i + 1}: userId=${p.userId}, filter='${p.filter}'`),
    ].join('\n');
    return {
      prompt: 'Родитель перерисовывает Panel с указанными свойствами (первый рендер - монтирование; StrictMode выключен). Сколько всего раз сработают все три эффекта вместе за все рендеры?',
      code,
      answerHint: 'число',
      answerKey: String(total),
      explanation:
        'Эффект срабатывает при монтировании и затем, когда хотя бы один элемент массива зависимостей изменился по Object.is. Пустой массив - только монтирование; без массива - после каждого рендера; объект, созданный в теле компонента ([options]), новый на каждом рендере, поэтому такой эффект срабатывает каждый раз; примитив query.id меняется только вместе с userId.',
      params: {
        effects: picked.map((e) => e.decl.slice(0, 40)).join('|'),
        props: props.map((p) => `${p.userId}${p.filter}`).join(','),
      },
    };
  },
};

export const UI_APP_NEW_GENERATORS: TaskGenerator[] = [formValidation, routeMatch, setstateBatching, effectDeps];
