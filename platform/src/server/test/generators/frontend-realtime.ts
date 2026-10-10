// Генераторы frontend.realtime (WebSocket/SSE, переподключение, порядок сообщений, оптимистичные
// обновления, конфликты). Ключ считает код генератора, не LLM (R-T-02); юнит-тест сверяет его
// независимым решением (tests/unit/test/frontend-subcategories.test.ts). a, b — ПРЕДЛОЖЕНИЕ.
// readyState и send() сверены с MDN через Context7 10.10; поведение close() до открытия и семантика
// Last-Event-ID (id применяется на dispatch, события без id его не сбрасывают) - по спецификации WHATWG
// HTML (SSE) по знанию агента; MDN подтверждает только назначение поля id. Помечено в validation-results.md.
import { createRng } from '../rng';
import type { TaskGenerator, TaskInstance } from '../types';

const SUB = 'frontend.realtime';

// --- Junior: readyState WebSocket ---------------------------------------------------------

export const wsReadystate: TaskGenerator = {
  id: 'fe.ws-readystate',
  subcategoryId: SUB,
  taskId: 'task:code-output',
  title: 'Состояния WebSocket в журнале',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.realtime-client', 'fe.event-loop'],
  format: 'text',
  a: 1.3,
  b: -0.9,
  paramSpace: 5e3,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const v = rng.pick(['ws', 'socket', 'conn', 'client']);
    const host = rng.pick(['chat', 'feed', 'live', 'rates']);
    const variant = rng.int(0, 3);
    let lines: string[];
    let out: number[];
    let why: string;
    if (variant === 0) {
      lines = [
        `const ${v} = new WebSocket('wss://${host}.example/ws');`,
        `log(${v}.readyState);`,
        `${v}.onopen = () => { log(${v}.readyState); ${v}.close(); log(${v}.readyState); };`,
        `${v}.onclose = () => log(${v}.readyState);`,
      ];
      out = [0, 1, 2, 3];
      why = 'сразу после new - CONNECTING (0); в onopen - OPEN (1); сразу после close() - CLOSING (2); в onclose - CLOSED (3)';
    } else if (variant === 1) {
      lines = [
        `const ${v} = new WebSocket('wss://${host}.example/ws');`,
        `${v}.onopen = () => { log(${v}.readyState); };`,
        `${v}.onmessage = (e) => { log(${v}.readyState); ${v}.close(); };`,
        `${v}.onclose = () => { log(${v}.readyState); };`,
        '// сервер после подключения отправляет одно сообщение',
      ];
      out = [1, 1, 3];
      why = 'onopen - OPEN (1); при получении сообщения соединение ещё открыто (1); close() в обработчике только начинает закрытие, а в onclose состояние уже CLOSED (3)';
    } else if (variant === 2) {
      lines = [`const ${v} = new WebSocket('wss://${host}.example/ws');`, `${v}.onopen = () => log('open');`, `${v}.close();`, `log(${v}.readyState);`, `${v}.onclose = () => log(${v}.readyState);`];
      out = [2, 3];
      why = 'close() до установления соединения переводит сокет в CLOSING (2) и отменяет подключение, поэтому onopen не вызывается; потом onclose с CLOSED (3)';
    } else {
      lines = [
        `const ${v} = new WebSocket('wss://${host}.example/ws');`,
        `${v}.addEventListener('open', () => { log(${v}.readyState); });`,
        `${v}.addEventListener('close', () => { log(${v}.readyState); });`,
        `log(${v}.readyState);`,
        `setTimeout(() => ${v}.close(), 1000); // к этому моменту соединение открыто`,
      ];
      out = [0, 1, 3];
      why = 'сначала синхронный log сразу после new - CONNECTING (0); потом open с OPEN (1); через секунду close() и событие close с CLOSED (3)';
    }
    return {
      prompt:
        'Сервер доступен и принимает соединение. log печатает аргумент в журнал. Какие числа окажутся в журнале и в каком порядке? Константы: CONNECTING = 0, OPEN = 1, CLOSING = 2, CLOSED = 3. Перечислите через запятую.',
      code: lines.join('\n'),
      answerHint: 'числа через запятую',
      answerKey: out.join(','),
      explanation: `${why}.`,
      params: { v, host, variant },
    };
  },
};

// --- Junior: экспоненциальная задержка переподключения -------------------------------------------

export const backoffTotal: TaskGenerator = {
  id: 'fe.backoff-total',
  subcategoryId: SUB,
  taskId: 'task:code-output',
  title: 'Суммарное ожидание при переподключении',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.realtime-client', 'fe.api-client'],
  format: 'number',
  a: 1.3,
  b: -0.5,
  paramSpace: 1e5,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const base = rng.pick([250, 500, 1000]);
    const factor = rng.pick([2, 3]);
    const cap = base * rng.pick([4, 6, 9, 12]);
    const n = rng.int(5, 7);
    const outcomes: ('успех' | 'сбой')[] = [];
    for (let i = 0; i < n; i++) outcomes.push(rng.int(0, 3) === 0 ? 'успех' : 'сбой');
    if (!outcomes.includes('сбой')) outcomes[0] = 'сбой';
    let delay = base;
    let total = 0;
    for (let i = 0; i < n - 1; i++) {
      if (outcomes[i] === 'успех') delay = base; // onopen
      total += delay; // onclose -> scheduleReconnect
      delay = Math.min(delay * factor, cap);
    }
    const code = [
      `const BASE = ${base};`,
      `let delay = BASE;`,
      'function scheduleReconnect() {',
      '  setTimeout(connect, delay);',
      `  delay = Math.min(delay * ${factor}, ${cap});`,
      '}',
      'function connect() {',
      '  ws = new WebSocket(URL);',
      '  ws.onopen = () => { delay = BASE; };',
      '  ws.onclose = scheduleReconnect;',
      '}',
    ].join('\n');
    return {
      prompt: `Первая попытка connect() выполняется сразу. Результаты попыток по порядку: ${outcomes.map((o, i) => `${i + 1} - ${o}`).join(', ')}. «Сбой» - сокет закрывается, не открывшись; «успех» - сокет открывается (onopen), затем сервер разрывает соединение (onclose). После каждого закрытия вызывается scheduleReconnect. Сколько миллисекунд суммарно пройдёт от начала первой попытки до начала попытки ${n} (время самих попыток не считать)?`,
      code,
      answerHint: 'миллисекунды',
      answerKey: String(total),
      explanation: `Перед каждой следующей попыткой ждут текущую delay; она растёт в ${factor} раза до потолка ${cap}, а успешное открытие (onopen) сбрасывает её на ${base}. Сумма ожиданий перед попытками 2…${n}: ${total} мс.`,
      params: {
        base,
        factor,
        cap,
        outcomes: outcomes.map((o) => o[0]).join(''),
      },
    };
  },
};

// --- Junior: подписки и отписки (шина событий) --------------------------------------------------

export const pubsubLog: TaskGenerator = {
  id: 'fe.pubsub-log',
  subcategoryId: SUB,
  taskId: 'task:code-output',
  title: 'Что выведут подписчики',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.realtime-client', 'fe.js-core'],
  format: 'text',
  a: 1.3,
  b: -0.7,
  paramSpace: 1e5,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const topics = rng.sample(['price', 'chat', 'alert'], 2) as [string, string];
    const tags = rng.sample(['A', 'B', 'C', 'D'], 3);
    type Sub = { var: string; tag: string; topic: string; once: boolean };
    const subs: Sub[] = tags.map((tag, i) => ({
      var: `off${tag}`,
      tag,
      topic: topics[i === 2 ? 1 : rng.int(0, 1)]!,
      once: i === 1 && rng.int(0, 1) === 1,
    }));
    type Step = { kind: 'emit'; topic: string; v: number } | { kind: 'off'; sub: Sub };
    const steps: Step[] = [];
    const active = new Set(subs);
    let val = rng.int(1, 5);
    const nSteps = rng.int(5, 7);
    for (let i = 0; i < nSteps; i++) {
      const canOff = [...active].filter((s) => !s.once);
      if (i > 1 && canOff.length > 1 && rng.int(0, 2) === 0) {
        const s = rng.pick(canOff);
        active.delete(s);
        steps.push({ kind: 'off', sub: s });
      } else {
        steps.push({ kind: 'emit', topic: rng.pick(topics), v: val++ });
      }
    }
    const bus = [
      'function createBus() {',
      '  const handlers = {};',
      '  return {',
      '    on(topic, fn) {',
      '      (handlers[topic] ||= []).push(fn);',
      '      return () => { handlers[topic] = handlers[topic].filter((h) => h !== fn); };',
      '    },',
      '    once(topic, fn) {',
      '      const off = this.on(topic, (d) => { off(); fn(d); });',
      '    },',
      '    emit(topic, data) {',
      '      (handlers[topic] || []).forEach((fn) => fn(data));',
      '    },',
      '  };',
      '}',
    ];
    const script = [
      'const bus = createBus();',
      ...subs.map((s) => (s.once ? `bus.once('${s.topic}', (d) => log('${s.tag}:' + d));` : `const ${s.var} = bus.on('${s.topic}', (d) => log('${s.tag}:' + d));`)),
      ...steps.map((st) => (st.kind === 'emit' ? `bus.emit('${st.topic}', ${st.v});` : `${st.sub.var}();`)),
    ];
    // Решение: прямая модель подписок.
    const live = subs.map((s) => ({ ...s, on: true }));
    const out: string[] = [];
    for (const st of steps) {
      if (st.kind === 'off') live.find((l) => l.tag === st.sub.tag)!.on = false;
      else
        for (const l of live) {
          if (l.on && l.topic === st.topic) {
            out.push(`${l.tag}:${st.v}`);
            if (l.once) l.on = false;
          }
        }
    }
    if (out.length === 0) out.push('(пусто)');
    return {
      prompt: 'Что окажется в журнале (log печатает строку)? Перечислите записи по порядку через запятую; если журнал пуст, напишите «(пусто)».',
      code: `${bus.join('\n')}\n\n${script.join('\n')}`,
      answerHint: 'записи через запятую',
      answerKey: out.join(','),
      explanation:
        'emit вызывает подписчиков своей темы в порядке подписки; вызов функции, которую вернул on, отписывает подписчика, а once отписывается после первого вызова. Подписчики другой темы не вызываются.',
      params: {
        topics: topics.join(','),
        subs: subs.map((s) => `${s.tag}${s.topic[0]}${+s.once}`).join(''),
        steps: steps.map((s) => (s.kind === 'emit' ? `e${s.topic[0]}` : `o${s.sub.tag}`)).join(''),
      },
    };
  },
};

// --- Middle: Last-Event-ID в SSE ---------------------------------------------------------------

export const sseResume: TaskGenerator = {
  id: 'fe.sse-resume',
  subcategoryId: SUB,
  taskId: 'task:code-output',
  title: 'Last-Event-ID при переподключении SSE',
  specialization: 'frontend',
  grade: 'middle',
  catalogIds: ['fe.realtime-client', 'fe.api-client'],
  format: 'number',
  a: 1.2,
  b: 0.3,
  paramSpace: 1e5,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const nEvents = rng.int(4, 6);
    let id = rng.int(10, 90);
    type Ev = { lines: string[]; id: number | null };
    const events: Ev[] = [];
    for (let i = 0; i < nEvents; i++) {
      const lines: string[] = [];
      let evId: number | null = null;
      if (i === 0 || rng.int(0, 2) > 0) {
        id += rng.int(1, 3);
        evId = id;
        lines.push(`id: ${id}`);
      }
      if (rng.int(0, 3) === 0) lines.push('retry: 3000');
      if (rng.int(0, 3) === 0) lines.push('event: update');
      lines.push(`data: {"n":${i + 1}}`);
      events.push({ lines, id: evId });
    }
    const flat: string[] = [];
    const blankAfter: number[] = []; // индексы пустых строк
    for (const e of events) {
      flat.push(...e.lines);
      blankAfter.push(flat.length);
      flat.push('');
    }
    // обрыв после строки cut (1-based): не раньше конца первого события
    const cut = rng.int(blankAfter[0]! + 1, flat.length);
    let last: number | null = null;
    let buffer: number | null = null;
    for (let i = 0; i < cut; i++) {
      const line = flat[i]!;
      if (line.startsWith('id: ')) buffer = Number(line.slice(4));
      else if (line === '') last = buffer; // dispatch (в этом потоке у каждого события есть data)
    }
    const shown = [...flat.slice(0, cut), '--- соединение оборвалось ---', ...flat.slice(cut)];
    return {
      prompt:
        'Сервер отправляет поток text/event-stream. Строка «--- соединение оборвалось ---» показывает место разрыва: строки ниже клиент уже не получил. EventSource переподключается автоматически. Какое число будет в заголовке Last-Event-ID в запросе на переподключение? Событие считается принятым, когда клиент получил завершающую пустую строку.',
      code: shown.join('\n'),
      answerHint: 'число',
      answerKey: String(last),
      explanation: `Последний идентификатор запоминается, когда событие доставлено (по пустой строке). Строка id в оборванном событии не учитывается, а событие без id оставляет прежнее значение. Итог: ${last}.`,
      params: {
        events: events.map((e) => e.lines.length).join(','),
        cut,
        id0: events[0]!.id,
      },
    };
  },
};

// --- Middle: порядок и дубликаты сообщений ------------------------------------------------------

export const seqReorder: TaskGenerator = {
  id: 'fe.seq-reorder',
  subcategoryId: SUB,
  taskId: 'task:code-output',
  title: 'Упорядочивание сообщений по seq',
  specialization: 'frontend',
  grade: 'middle',
  catalogIds: ['fe.realtime-client', 'fe.state-mgmt'],
  format: 'number',
  a: 1.2,
  b: 0.5,
  paramSpace: 1e5,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const n = rng.int(7, 9);
    const start = rng.int(1, 5);
    const seqs = Array.from({ length: n }, (_, i) => start + i);
    let arrival = rng.shuffle(seqs);
    // пропуск: одно сообщение теряется
    const lost = rng.int(0, 1) === 1 ? rng.int(2, n - 2) : -1;
    if (lost >= 0) arrival = arrival.filter((s) => s !== start + lost);
    // дубликаты
    for (let i = 0; i < rng.int(1, 2); i++) arrival.splice(rng.int(1, arrival.length), 0, rng.pick(arrival));
    const kind = rng.int(0, 2);
    const m = rng.int(3, arrival.length - 1);
    let expected = start;
    const buffer = new Set<number>();
    const appliedAfter: number[] = [];
    let applied = 0;
    for (const s of arrival) {
      if (s >= expected && !buffer.has(s)) buffer.add(s);
      while (buffer.has(expected)) {
        buffer.delete(expected);
        expected++;
        applied++;
      }
      appliedAfter.push(applied);
    }
    let answer: number;
    let ask: string;
    if (kind === 0) {
      answer = buffer.size;
      ask = 'Сколько сообщений останется в буфере (получены, но не применены) после прихода всех пакетов?';
    } else if (kind === 1) {
      answer = appliedAfter[m - 1]!;
      ask = `Сколько сообщений будет применено сразу после прихода пакета № ${m} (считая с 1, дубликаты тоже пакеты)?`;
    } else {
      answer = expected - 1;
      ask = 'Seq какого сообщения применено последним к концу (наибольший применённый seq)?';
    }
    const code = [
      `let expected = ${start}; const buffer = new Map();`,
      'function onMessage(msg) {',
      '  if (msg.seq < expected || buffer.has(msg.seq)) return; // старое или дубликат',
      '  buffer.set(msg.seq, msg);',
      '  while (buffer.has(expected)) {',
      '    apply(buffer.get(expected));',
      '    buffer.delete(expected);',
      '    expected++;',
      '  }',
      '}',
      '',
      `// пакеты пришли в таком порядке seq: ${arrival.join(', ')}`,
    ].join('\n');
    return {
      prompt: `${ask}`,
      code,
      answerHint: 'число',
      answerKey: String(answer),
      explanation:
        'Сообщение применяется, только когда применены все предыдущие: пакеты с seq больше ожидаемого ждут в буфере, дубликаты и устаревшие игнорируются. Если какого-то seq так и не пришло, все последующие остаются в буфере.',
      params: { start, n, lost, kind, arrival: arrival.join(',') },
    };
  },
};

// --- Middle: оптимистичное обновление и откат ---------------------------------------------------------

export const optimisticQueue: TaskGenerator = {
  id: 'fe.optimistic-queue',
  subcategoryId: SUB,
  taskId: 'task:code-output',
  title: 'Значение на экране при откате операций',
  specialization: 'frontend',
  grade: 'middle',
  catalogIds: ['fe.state-mgmt', 'fe.server-state', 'fe.realtime-client'],
  format: 'number',
  a: 1.3,
  b: 0.7,
  paramSpace: 1e5,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const start = rng.int(1, 9);
    const n = rng.int(4, 5);
    type Op = { id: string; kind: '+' | '*'; k: number };
    const ops: Op[] = Array.from({ length: n }, (_, i) => {
      const kind = rng.int(0, 2) === 0 ? '*' : '+';
      return {
        id: String.fromCharCode(65 + i),
        kind,
        k: kind === '*' ? rng.int(2, 3) : rng.int(1, 9),
      };
    });
    const fail = new Set(
      rng.sample(
        ops.map((o) => o.id),
        rng.int(1, 2),
      ),
    );
    const responseOrder = rng.shuffle(ops.map((o) => o.id));
    const k = rng.int(2, n);
    const failedSoFar = new Set(responseOrder.slice(0, k).filter((id) => fail.has(id)));
    let value = start;
    for (const o of ops) {
      if (failedSoFar.has(o.id)) continue;
      value = o.kind === '+' ? value + o.k : value * o.k;
    }
    const fmt = (o: Op) => `${o.id}: ${o.kind === '+' ? `+${o.k}` : `×${o.k}`}`;
    const code = [
      `// Значение на сервере и на экране: ${start}`,
      '// Операции отправлены подряд в таком порядке (оптимистично применены на экране):',
      ...ops.map(fmt),
      '// Ответы сервера пришли в порядке: ' + responseOrder.map((id) => `${id} - ${fail.has(id) ? 'ошибка' : 'успех'}`).join(', '),
    ].join('\n');
    return {
      prompt: `Правило клиента: на экране всегда исходное значение, к которому по порядку отправки применены все операции, кроме отклонённых сервером (отклонённая операция убирается, остальные остаются). Какое значение на экране сразу после ответа № ${k} (считая с 1), когда ответы не получены ещё на остальные операции?`,
      code,
      answerHint: 'число',
      answerKey: String(value),
      explanation: `К этому моменту отклонены: ${failedSoFar.size ? [...failedSoFar].sort().join(', ') : 'ничего'}. Остальные операции (и подтверждённые, и ожидающие ответа) применяются по порядку отправки к ${start}. Откат обратной операцией («вычесть») при ${ops.some((o) => o.kind === '*') ? 'умножении' : 'смешанном порядке'} дал бы другой результат, поэтому состояние пересчитывают с начала.`,
      params: {
        start,
        ops: ops.map(fmt).join(';'),
        resp: responseOrder.join(''),
        fail: [...fail].sort().join(''),
        k,
      },
    };
  },
};

// --- Middle: слияние конфликтующих правок ----------------------------------------------------------

export const conflictMerge: TaskGenerator = {
  id: 'fe.conflict-merge',
  subcategoryId: SUB,
  taskId: 'task:code-output',
  title: 'Слияние правок двух клиентов',
  specialization: 'frontend',
  grade: 'middle',
  catalogIds: ['fe.realtime-client', 'fe.architecture'],
  format: 'number',
  a: 1.2,
  b: 0.8,
  paramSpace: 1e5,
  timeLimitSec: 200,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const fields = rng.sample(['title', 'status', 'owner', 'deadline', 'priority'], rng.int(4, 5));
    const nEdits = rng.int(6, 8);
    const times = rng.shuffle(Array.from({ length: nEdits }, (_, i) => 100 + i * 7 + rng.int(0, 5)));
    type Edit = { client: 'A' | 'B'; field: string; ts: number };
    const edits: Edit[] = times.map((ts) => ({
      client: rng.int(0, 1) === 0 ? 'A' : 'B',
      field: rng.pick(fields),
      ts,
    }));
    // порядок прихода на сервер не совпадает с порядком времени
    const arrival = rng.shuffle(edits);
    const win = new Map<string, Edit>();
    for (const e of edits) {
      const cur = win.get(e.field);
      if (!cur || e.ts > cur.ts) win.set(e.field, e);
    }
    const fromB = [...win.values()].filter((e) => e.client === 'B').length;
    return {
      prompt: `Документ из полей ${fields.join(', ')} правят два клиента; сервер получил правки в порядке, указанном в списке (он отличается от порядка по времени из-за сети). Правила слияния: для каждого поля побеждает правка с наибольшей меткой времени ts (last-writer-wins по полю, порядок прихода не важен); правки разных полей не конфликтуют. Значения в итоговом документе, которые записал клиент B, - у скольких полей? Поля без правок не считать.`,
      code: arrival.map((e) => `клиент ${e.client}  поле ${e.field.padEnd(8)} ts=${e.ts}`).join('\n'),
      answerHint: 'число',
      answerKey: String(fromB),
      explanation: `Для каждого поля берётся правка с наибольшим ts: ${[...win.entries()].map(([f, e]) => `${f} - ${e.client}`).join(', ')}. От клиента B: ${fromB}. Если бы побеждала последняя пришедшая на сервер правка, ответ мог бы быть другим.`,
      params: {
        fields: fields.join(','),
        edits: edits.map((e) => `${e.client}${e.field[0]}${e.ts}`).join(','),
      },
    };
  },
};

export const REALTIME_NEW_GENERATORS: TaskGenerator[] = [wsReadystate, backoffTotal, pubsubLog, sseResume, seqReorder, optimisticQueue, conflictMerge];
