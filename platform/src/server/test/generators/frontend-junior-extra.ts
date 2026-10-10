// Дополнительные Junior-семейства frontend (по 2 на подкатегорию): пул подкатегории ≥ 6 Junior
// (ADR 0003, дополнение 10.10 16:15). Ключ считает код генератора; тест сверяет независимым решением
// (исполнение кода, dom-accessibility-api, jsdom, отдельная модель). a, b — ПРЕДЛОЖЕНИЕ.
import { createRng } from '../rng';
import type { TaskGenerator, TaskInstance } from '../types';

// --- ui-app ----------------------------------------------------------------------------------------

export const controlledInput: TaskGenerator = {
  id: 'fe.controlled-input',
  subcategoryId: 'frontend.ui-app',
  taskId: 'task:code-output',
  title: 'Что окажется в управляемом поле',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.forms', 'fe.state-mgmt'],
  format: 'text',
  a: 1.3,
  b: -0.8,
  paramSpace: 1e5,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const n = rng.int(3, 5);
    const handlers: { src: string; fn: (v: string) => string }[] = [
      { src: `v.replace(/\\D/g, '')`, fn: (v) => v.replace(/\D/g, '') },
      { src: 'v.toUpperCase()', fn: (v) => v.toUpperCase() },
      { src: `v.slice(0, ${n})`, fn: (v) => v.slice(0, n) },
      {
        src: `v.replace(/\\D/g, '').slice(0, ${n})`,
        fn: (v) => v.replace(/\D/g, '').slice(0, n),
      },
      {
        src: `v.replace(/[aeiou]/g, '')`,
        fn: (v) => v.replace(/[aeiou]/g, ''),
      },
    ];
    const h = rng.pick(handlers);
    const alphabet = ['a', 'b', 'e', 'k', '7', '3', '0', '-', 'o', 'x'];
    const typed = Array.from({ length: rng.int(6, 9) }, () => rng.pick(alphabet));
    let value = '';
    for (const ch of typed) value = h.fn(value + ch);
    const code = [
      'function Field() {',
      `  const [value, setValue] = useState('');`,
      '  return (',
      '    <input',
      '      value={value}',
      `      onChange={(e) => setValue(((v) => ${h.src})(e.target.value))}`,
      '    />',
      '  );',
      '}',
    ].join('\n');
    return {
      prompt: `Пользователь по одному набирает символы: ${typed.map((c) => `«${c}»`).join(' ')} (после каждого символа срабатывает onChange с новым значением поля). Какой текст будет в поле в конце? Если поле пустое, напишите «(пусто)».`,
      code,
      answerHint: 'текст в поле',
      answerKey: value === '' ? '(пусто)' : value,
      explanation:
        'В управляемом поле значение определяется состоянием: после каждого символа обработчик получает «старое значение + новый символ» и сохраняет результат преобразования. Символы, отброшенные преобразованием, в поле не возвращаются.',
      params: { handler: h.src, typed: typed.join('') },
    };
  },
};

export const viewState: TaskGenerator = {
  id: 'fe.view-state',
  subcategoryId: 'frontend.ui-app',
  taskId: 'task:code-output',
  title: 'Что покажет экран по состоянию загрузки',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.server-state', 'fe.components'],
  format: 'text',
  a: 1.3,
  b: -0.7,
  paramSpace: 1e5,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const checks = rng.shuffle([
      { cond: 's.loading', out: 'Spinner' },
      { cond: rng.int(0, 1) ? 's.error' : 's.error !== null', out: 'Error' },
      { cond: 's.data.length === 0', out: 'Empty' },
    ]);
    const fn = ['function view(s) {', ...checks.map((c) => `  if (${c.cond}) return '${c.out}';`), `  return 'List';`, '}'].join('\n');
    type St = { loading: boolean; error: string | null; data: number[] };
    const states: St[] = Array.from({ length: rng.int(4, 5) }, () => ({
      loading: rng.int(0, 2) === 0,
      error: rng.int(0, 2) === 0 ? 'timeout' : null,
      data: rng.int(0, 1) ? [] : [1, 2],
    }));
    const src = (s: St) => `{ loading: ${s.loading}, error: ${s.error === null ? 'null' : `'${s.error}'`}, data: [${s.data.join(', ')}] }`;
    const code = `${fn}\n\nconst states = [\n${states.map((s) => `  ${src(s)},`).join('\n')}\n];\nconsole.log(states.map(view).join(','));`;
    const out = states.map((s) => {
      for (const c of checks) {
        const hit = c.out === 'Spinner' ? s.loading : c.out === 'Error' ? s.error !== null : s.data.length === 0;
        if (hit) return c.out;
      }
      return 'List';
    });
    return {
      prompt: 'Что выведет console.log - названия экранов для каждого состояния по порядку, через запятую? Проверки выполняются сверху вниз, первая сработавшая определяет экран.',
      code,
      answerHint: 'названия через запятую',
      answerKey: out.join(','),
      explanation: 'Экран определяется первой сработавшей проверкой, поэтому порядок проверок важен: например, при одновременных loading и error побеждает та, что написана выше.',
      params: {
        order: checks.map((c) => c.out).join(''),
        states: states.map(src).join(''),
      },
    };
  },
};

// --- design-system ----------------------------------------------------------------------------------

export const accessibleName: TaskGenerator = {
  id: 'fe.accessible-name',
  subcategoryId: 'frontend.design-system',
  taskId: 'task:html-semantics',
  title: 'Какое имя прочитает скринридер',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.a11y', 'fe.components'],
  format: 'text',
  a: 1.3,
  b: -0.6,
  paramSpace: 1e4,
  timeLimitSec: 120,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const words = rng.sample(['Закрыть', 'Сохранить', 'Отправить', 'Удалить', 'Скачать', 'Печать', 'Поиск', 'Назад'], 4);
    const [content, lbl, aria, title] = words as [string, string, string, string];
    const useLb = rng.int(0, 2) > 0;
    const useAria = rng.int(0, 2) > 0;
    const useTitle = rng.int(0, 1) === 1;
    const attrs = [useLb ? 'aria-labelledby="caption"' : '', useAria ? `aria-label="${aria}"` : '', useTitle ? `title="${title}"` : ''].filter(Boolean);
    const rows = [`<button id="b" ${attrs.join(' ')}>${content}</button>`, useLb ? `<span id="caption">${lbl}</span>` : ''].filter(Boolean);
    const name = useLb ? lbl : useAria ? aria : content;
    return {
      prompt: 'Какое доступное имя у кнопки #b будет озвучено скринридером?',
      code: rows.join('\n'),
      answerHint: 'текст имени',
      answerKey: name,
      explanation:
        'Порядок вычисления доступного имени: aria-labelledby, затем aria-label, затем содержимое/родной label элемента, и только в конце title. Более ранний источник полностью перекрывает остальные.',
      params: { useLb, useAria, useTitle, words: words.join(',') },
    };
  },
};

export const cssUnits: TaskGenerator = {
  id: 'fe.css-units',
  subcategoryId: 'frontend.design-system',
  taskId: 'task:css-layout',
  title: 'Итоговый размер в пикселях (rem и em)',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.css-layout', 'fe.responsive'],
  format: 'number',
  a: 1.3,
  b: -0.7,
  paramSpace: 1e5,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const root = rng.pick([16, 20, 10, 18]);
    const cardRem = rng.pick([1.25, 1.5, 2, 0.875]);
    const noteEm = rng.pick([0.8, 0.5, 1.5, 0.75]);
    const padEm = rng.pick([1, 2, 1.5, 3]);
    const marRem = rng.pick([0.5, 1, 1.5, 2]);
    const css = [`html { font-size: ${root}px; }`, `.card { font-size: ${cardRem}rem; }`, `.card .note { font-size: ${noteEm}em; padding: ${padEm}em; margin-left: ${marRem}rem; }`].join('\n');
    const html = '<div class="card">\n  <p class="note">Текст</p>\n</div>';
    const cardPx = cardRem * root;
    const notePx = noteEm * cardPx;
    const asks = [
      { q: 'font-size у .note', v: notePx },
      { q: 'padding у .note', v: padEm * notePx },
      { q: 'margin-left у .note', v: marRem * root },
    ];
    const ask = rng.pick(asks);
    return {
      prompt: `Чему равен ${ask.q} в пикселях? (Остальные стили по умолчанию.)`,
      code: `${css}\n\n${html}`,
      answerHint: 'пиксели, число',
      answerKey: String(Number(ask.v.toFixed(4))),
      explanation: `rem считается от font-size корня (${root}px), em - от font-size самого элемента (для font-size - от родителя). .card: ${cardRem} × ${root} = ${cardPx}px; .note: ${noteEm} × ${cardPx} = ${notePx}px; padding в em берёт уже вычисленный font-size .note.`,
      params: { root, cardRem, noteEm, padEm, marRem, ask: ask.q },
    };
  },
};

// --- web-perf ---------------------------------------------------------------------------------------

export const debounceCount: TaskGenerator = {
  id: 'fe.debounce-count',
  subcategoryId: 'frontend.web-perf',
  taskId: 'task:code-output',
  title: 'Сколько запросов уйдёт при вводе',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.web-perf', 'fe.api-client'],
  format: 'number',
  a: 1.3,
  b: -0.8,
  paramSpace: 1e5,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const wait = rng.pick([200, 300, 500]);
    const throttleMode = rng.int(0, 1) === 1;
    const n = rng.int(6, 9);
    const times: number[] = [rng.int(0, 100)];
    for (let i = 1; i < n; i++) {
      let gap = rng.int(2, 9) * 50;
      if (gap === wait) gap += 10; // совпадение зазора и ожидания неоднозначно по порядку таймеров
      times.push(times[i - 1]! + gap);
    }
    let calls = 0;
    if (throttleMode) {
      let last = -Infinity;
      for (const t of times) {
        if (t - last < wait) continue;
        last = t;
        calls++;
      }
    } else {
      for (let i = 0; i < times.length; i++) if (i === times.length - 1 || times[i + 1]! - times[i]! > wait) calls++;
    }
    const impl = throttleMode
      ? [
          `function throttle(fn, wait) {`,
          `  let last = -Infinity;`,
          `  return (...args) => {`,
          `    const now = Date.now();`,
          `    if (now - last >= wait) { last = now; fn(...args); }`,
          `  };`,
          `}`,
          `const onInput = throttle(search, ${wait});`,
        ]
      : [
          `function debounce(fn, wait) {`,
          `  let timer;`,
          `  return (...args) => {`,
          `    clearTimeout(timer);`,
          `    timer = setTimeout(() => fn(...args), wait);`,
          `  };`,
          `}`,
          `const onInput = debounce(search, ${wait});`,
        ];
    return {
      prompt: `onInput вызывается по нажатию клавиш в моменты (мс от начала): ${times.join(', ')}. После последнего вызова ждём достаточно долго. Сколько раз выполнится search?`,
      code: impl.join('\n'),
      answerHint: 'число',
      answerKey: String(calls),
      explanation: throttleMode
        ? `throttle пропускает вызов, если с прошлого выполненного прошло меньше ${wait} мс; выполненные вызовы - ${calls}.`
        : `debounce откладывает вызов на ${wait} мс и сбрасывает таймер при каждом новом вызове: search срабатывает один раз после каждой серии с паузой больше ${wait} мс, всего ${calls}.`,
      params: { wait, throttleMode, times: times.join(',') },
    };
  },
};

export const renderBlocking: TaskGenerator = {
  id: 'fe.render-blocking',
  subcategoryId: 'frontend.web-perf',
  taskId: 'task:web-vitals',
  title: 'Сколько ресурсов блокируют первую отрисовку',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.web-perf', 'fe.bundler'],
  format: 'number',
  a: 1.3,
  b: -0.7,
  paramSpace: 1e5,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const tags: { tag: string; blocks: boolean }[] = [
      { tag: '<link rel="stylesheet" href="/app.css">', blocks: true },
      { tag: '<link rel="stylesheet" href="/theme.css">', blocks: true },
      {
        tag: '<link rel="stylesheet" href="/print.css" media="print">',
        blocks: false,
      },
      {
        tag: '<link rel="preload" href="/font.woff2" as="font" crossorigin>',
        blocks: false,
      },
      { tag: '<script src="/vendor.js"></script>', blocks: true },
      { tag: '<script src="/analytics.js" async></script>', blocks: false },
      { tag: '<script src="/app.js" defer></script>', blocks: false },
      { tag: '<script type="module" src="/main.js"></script>', blocks: false },
      { tag: '<link rel="icon" href="/favicon.ico">', blocks: false },
      { tag: '<script src="/polyfills.js"></script>', blocks: true },
    ];
    const chosen = rng.sample(tags, rng.int(5, 7));
    const blocking = chosen.filter((t) => t.blocks).length;
    return {
      prompt: 'Все теги в <head>. Сколько из этих ресурсов блокируют первую отрисовку страницы (браузер не покажет содержимое, пока их не загрузит и не обработает)?',
      code: ['<head>', ...chosen.map((t) => `  ${t.tag}`), '</head>'].join('\n'),
      answerHint: 'число',
      answerKey: String(blocking),
      explanation:
        'Блокируют: таблицы стилей, подходящие под текущий тип носителя (media="print" на экране не блокирует), и обычные <script src> без async/defer/type="module". async, defer и module не блокируют разбор; preload и иконка - тоже.',
      params: { tags: chosen.map((t) => t.tag.slice(0, 30)).join('|') },
    };
  },
};

// --- realtime ---------------------------------------------------------------------------------------

export const wsSendDelivery: TaskGenerator = {
  id: 'fe.ws-send-delivery',
  subcategoryId: 'frontend.realtime',
  taskId: 'task:code-output',
  title: 'Какие сообщения дойдут до сервера',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.realtime-client'],
  format: 'text',
  a: 1.3,
  b: -0.6,
  paramSpace: 1e4,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const names = rng.shuffle(['A', 'B', 'C', 'D', 'E', 'F']);
    let k = 0;
    const next = () => names[k++]!;
    const lines: string[] = ["const ws = new WebSocket('wss://live.example/ws');"];
    const delivered: string[] = [];
    if (rng.int(0, 1) === 1) {
      const m = next();
      lines.push(`try { ws.send('${m}'); } catch (e) { /* ошибка */ }`);
    }
    const inOpen: string[] = [];
    const nOpen = rng.int(2, 4);
    const closeAt = rng.int(0, 2) === 0 ? -1 : rng.int(1, nOpen - 1);
    for (let i = 0; i < nOpen; i++) {
      if (i === closeAt) inOpen.push('ws.close();');
      const m = next();
      inOpen.push(`ws.send('${m}');`);
      if (closeAt < 0 || i < closeAt) delivered.push(m);
    }
    lines.push(`ws.onopen = () => { ${inOpen.join(' ')} };`);
    if (rng.int(0, 1) === 1) lines.push(`ws.onclose = () => { ws.send('${next()}'); };`);
    return {
      prompt:
        'Сервер доступен, соединение открывается успешно и нормально закрывается. Какие сообщения сервер получит и в каком порядке? Перечислите буквы через запятую; если ни одного - напишите «(пусто)».',
      code: lines.join('\n'),
      answerHint: 'буквы через запятую',
      answerKey: delivered.length ? delivered.join(',') : '(пусто)',
      explanation: 'send() в состоянии CONNECTING бросает InvalidStateError (сообщение не уходит), в OPEN - отправляет, после вызова close() (CLOSING) и в CLOSED сообщения молча отбрасываются.',
      params: { lines: lines.join('|').length, delivered: delivered.join('') },
    };
  },
};

export const chatDedupe: TaskGenerator = {
  id: 'fe.chat-dedupe',
  subcategoryId: 'frontend.realtime',
  taskId: 'task:code-output',
  title: 'Сколько сообщений покажет чат',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.realtime-client', 'fe.js-core'],
  format: 'number',
  a: 1.3,
  b: -0.8,
  paramSpace: 1e5,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const byId = rng.int(0, 1) === 0;
    const n = rng.int(6, 8);
    const ids: number[] = [];
    let id = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const r = rng.int(0, 4);
      if (r === 0 && ids.length) ids.push(rng.pick(ids));
      else if (r === 1 && id > 2) ids.push(id - 2);
      else ids.push(id++);
    }
    const impl = byId
      ? ['const messages = [];', 'function onMessage(m) {', '  if (messages.some((x) => x.id === m.id)) return;', '  messages.push(m);', '}']
      : ['const messages = [];', 'let lastId = 0;', 'function onMessage(m) {', '  if (m.id <= lastId) return;', '  lastId = m.id;', '  messages.push(m);', '}'];
    let count = 0;
    if (byId) count = new Set(ids).size;
    else {
      let last = 0;
      for (const x of ids) {
        if (x <= last) continue;
        last = x;
        count++;
      }
    }
    const code = [...impl, '', `for (const id of [${ids.join(', ')}]) onMessage({ id });`, 'console.log(messages.length);'].join('\n');
    return {
      prompt: 'Сообщения приходят по сети в указанном порядке (id повторяются при повторной доставке, а иногда приходят позже новых). Что выведет console.log - сколько сообщений окажется в списке?',
      code,
      answerHint: 'число',
      answerKey: String(count),
      explanation: byId
        ? 'Проверка по id отбрасывает только повторы: запоздавшее, но новое сообщение добавляется.'
        : 'Проверка «id не больше последнего» отбрасывает и повторы, и запоздавшие сообщения с меньшим id.',
      params: { byId, ids: ids.join(',') },
    };
  },
};

export const JUNIOR_EXTRA_GENERATORS: TaskGenerator[] = [controlledInput, viewState, accessibleName, cssUnits, debounceCount, renderBlocking, wsSendDelivery, chatDedupe];
