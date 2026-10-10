// Расширенный банк frontend.realtime: +3 Junior, +5 Middle, +4 Senior (решение владельца 11.10).
// Ключ считает код генератора по модели из условия; a, b — ПРЕДЛОЖЕНИЕ.
import { createRng } from '../rng';
import type { TaskInstance } from '../types';
import { fam, RT } from './frontend-bank2-util';

// --- Junior ---------------------------------------------------------------------------

export const emptyPolls = fam({
  id: 'fe.b2-empty-polls',
  sub: RT,
  grade: 'junior',
  title: 'Пустые ответы при опросе сервера',
  catalogIds: ['fe.realtime-client', 'fe.api-client'],
  a: 1.2,
  b: -1.0,
  space: 1e6,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const p = rng.pick([5, 10, 15, 20]);
    const T = p * rng.int(6, 12);
    const events = Array.from({ length: rng.int(2, 5) }, () => rng.int(1, T - 1)).filter((t) => t % p !== 0).sort((x, y) => x - y);
    if (!events.length) events.push(1);
    let empty = 0;
    for (let q = p; q <= T; q += p) if (!events.some((e) => e > q - p && e < q)) empty++;
    return {
      prompt: `Клиент опрашивает сервер раз в ${p} с (запросы в секунды ${p}, ${2 * p}, … до ${T}); ответ содержит события, произошедшие с прошлого запроса. События случились в секунды: ${events.join(', ')}. Сколько запросов вернут пустой ответ?`,
      answerHint: 'число',
      answerKey: String(empty),
      explanation: `Запрос в момент q видит события в интервале (q − ${p}, q). Всего запросов ${T / p}, с событиями — ${T / p - empty}, пустых — ${empty}. При SSE пустых запросов нет: соединение одно, события приходят по мере появления.`,
      params: { p, T, events: events.join(',') },
    };
  },
});

export const jsonMessages = fam({
  id: 'fe.b2-json-messages',
  sub: RT,
  grade: 'junior',
  title: 'Разбор входящих сообщений WebSocket',
  catalogIds: ['fe.realtime-client', 'fe.js-core'],
  a: 1.2,
  b: -0.8,
  space: 1e6,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const words = ['hi', 'ok', 'go', 'yes', 'no'];
    const make = (): string => {
      const w = rng.pick(words);
      return rng.pick([
        `{"type":"chat","text":"${w}"}`,
        `{"type":"chat","text":"${w}"}`,
        `{"type":"ping"}`,
        `{"type":"Chat","text":"${w}"}`,
        `{'type':'chat','text':'${w}'}`,
        `{"type":"chat","text":"${w}",}`,
        `{"type":"chat","text":"${w}"`,
        `{"text":"${w}"}`,
        `"chat"`,
        `{"type":"join","user":"${w}"}`,
      ]);
    };
    const msgs = Array.from({ length: rng.int(6, 9) }, make);
    let n = 0;
    for (const m of msgs) {
      try {
        const o = JSON.parse(m) as { type?: string };
        if (o && o.type === 'chat') n++;
      } catch {
        /* битое сообщение */
      }
    }
    return {
      prompt: 'По сокету пришли сообщения (каждая строка — содержимое e.data). Сколько раз будет вызван addMessage?',
      code: ['ws.onmessage = (e) => {', '  try {', '    const m = JSON.parse(e.data);', "    if (m.type === 'chat') addMessage(m.text);", '  } catch { /* игнорируем */ }', '};', '', ...msgs.map((m, i) => `${i + 1}. ${m}`)].join('\n'),
      answerHint: 'число',
      answerKey: String(n),
      explanation: 'JSON.parse отвергает одинарные кавычки, висящую запятую и незакрытый объект; регистр значения type важен. Остаются только корректные сообщения с type ровно «chat».',
      params: { msgs: msgs.join('|') },
    };
  },
});

export const unreadCounter = fam({
  id: 'fe.b2-unread-counter',
  sub: RT,
  grade: 'junior',
  title: 'Счётчик непрочитанных в чатах',
  catalogIds: ['fe.realtime-client', 'fe.state-mgmt'],
  a: 1.1,
  b: -0.9,
  space: 1e6,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const rooms = ['A', 'B', 'C'];
    let open = rng.pick(rooms);
    const unread: Record<string, number> = { A: 0, B: 0, C: 0 };
    const start = open;
    const evs: string[] = [];
    for (let i = 0; i < rng.int(8, 12); i++) {
      if (rng.int(0, 4) === 0) {
        open = rng.pick(rooms);
        unread[open] = 0;
        evs.push(`открыт чат ${open}`);
      } else {
        const r = rng.pick(rooms);
        if (r !== open) unread[r] = unread[r]! + 1;
        evs.push(`сообщение в ${r}`);
      }
    }
    const sum = unread.A! + unread.B! + unread.C!;
    return {
      prompt: `Вначале открыт чат ${start}, непрочитанных нет. Сообщение в открытый чат читается сразу; сообщение в закрытый увеличивает его счётчик; при открытии чата его счётчик обнуляется. Сколько непрочитанных сообщений суммарно будет в конце?`,
      code: evs.map((e, i) => `${i + 1}. ${e}`).join('\n'),
      answerHint: 'число',
      answerKey: String(sum),
      explanation: `Итоговые счётчики: A=${unread.A}, B=${unread.B}, C=${unread.C}; сумма ${sum}.`,
      params: { start, evs: evs.join(',') },
    };
  },
});

// --- Middle ---------------------------------------------------------------------------

export const throttleFlushes = fam({
  id: 'fe.b2-throttle-flushes',
  sub: RT,
  grade: 'middle',
  title: 'Сколько перерисовок при троттлинге потока',
  catalogIds: ['fe.realtime-client', 'fe.render-perf'],
  a: 1.2,
  b: 0.3,
  space: 1e7,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const W = rng.pick([200, 250, 300, 500]);
    const ts: number[] = [];
    let t = rng.int(0, 100);
    for (let i = 0; i < rng.int(8, 12); i++) {
      ts.push(t);
      t += rng.pick([20, 50, 80, 120, 200, 350, 700]);
    }
    let renders = 0;
    let i = 0;
    while (i < ts.length) {
      const end = ts[i]! + W;
      renders++;
      while (i < ts.length && ts[i]! < end) i++;
    }
    return {
      prompt: `Сообщения приходят по сокету в моменты (мс): ${ts.join(', ')}. Клиент копит их и перерисовывает список не чаще раза за окно ${W} мс: первое сообщение после простоя открывает окно, в его конце происходит одна перерисовка со всеми накопленными. Сообщение, пришедшее ровно в момент конца окна, относится уже к следующему окну. Сколько будет перерисовок?`,
      answerHint: 'число',
      answerKey: String(renders),
      explanation: `Окно открывается первым необработанным сообщением и закрывается через ${W} мс; все сообщения внутри входят в одну перерисовку. Итого ${renders}.`,
      params: { W, ts: ts.join(',') },
    };
  },
});

export const lwwClocks = fam({
  id: 'fe.b2-lww-clocks',
  sub: RT,
  grade: 'middle',
  title: 'Last-write-wins при разных часах клиентов',
  catalogIds: ['fe.realtime-client', 'fe.state-mgmt'],
  format: 'text',
  a: 1.3,
  b: 0.7,
  space: 1e6,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const clients = ['A', 'B', 'C'];
    const skew: Record<string, number> = {};
    clients.forEach((c, i) => (skew[c] = rng.int(-4, 4) * 100 + i));
    const times = rng.sample([100, 200, 300, 400, 500, 600, 700, 800], rng.int(4, 5)).sort((x, y) => x - y);
    const writes = times.map((t, i) => ({ real: t, c: rng.pick(clients), v: `v${i + 1}` }));
    let win = writes[0]!;
    for (const w of writes) if (w.real + skew[w.c]! > win.real + skew[win.c]!) win = w;
    return {
      prompt: 'Клиенты пишут в одну запись; каждое значение отправляется с отметкой времени по часам клиента, сервер сохраняет значение с наибольшей отметкой (last-write-wins). Реальные моменты записи и сдвиги часов клиентов относительно реального времени заданы ниже. Какое значение останется в записи?',
      code: [`сдвиги часов, мс: ${clients.map((c) => `${c}${skew[c]! >= 0 ? '+' : ''}${skew[c]}`).join(', ')}`, ...writes.map((w) => `t=${w.real} мс: клиент ${w.c} пишет ${w.v}`)].join('\n'),
      answerHint: 'значение, например v2',
      answerKey: win.v,
      explanation: `Отметка = реальный момент + сдвиг часов клиента. Наибольшая у ${win.v} (клиент ${win.c}, ${win.real + skew[win.c]!}). Часы клиентов не согласованы, поэтому LWW может отбросить фактически более позднюю запись.`,
      params: { skew: clients.map((c) => skew[c]).join(','), writes: writes.map((w) => `${w.real}${w.c}`).join(',') },
    };
  },
});

export const presenceCount = fam({
  id: 'fe.b2-presence-count',
  sub: RT,
  grade: 'middle',
  title: 'Кто онлайн по heartbeat',
  catalogIds: ['fe.realtime-client'],
  a: 1.1,
  b: 0.2,
  space: 1e6,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const ttl = rng.pick([15, 20, 30]);
    const users = rng.sample(['anna', 'boris', 'vera', 'gleb', 'dasha', 'egor', 'liza'], rng.int(5, 7));
    const q = rng.int(60, 120);
    const beats = users.map(() => Array.from({ length: rng.int(1, 4) }, () => rng.int(0, 140)).sort((x, y) => x - y));
    const online = users.filter((_, i) => beats[i]!.some((h) => h <= q && q - h < ttl)).length;
    return {
      prompt: `Пользователь считается онлайн, если его последний heartbeat был не раньше ${ttl} секунд назад (строго меньше ${ttl} с). Запрос списка в секунде ${q}; heartbeat позже этого момента ещё не пришёл. Сколько пользователей онлайн?`,
      code: users.map((u, i) => `${u}: ${beats[i]!.join(', ')}`).join('\n'),
      answerHint: 'число',
      answerKey: String(online),
      explanation: 'Для каждого берём heartbeat не позже секунды запроса и сравниваем разницу с TTL; будущие отметки не считаются.',
      params: { ttl, q, beats: beats.map((b) => b.join('/')).join(',') },
    };
  },
});

export const tokenBucket = fam({
  id: 'fe.b2-token-bucket',
  sub: RT,
  grade: 'middle',
  title: 'Ограничение частоты отправки (token bucket)',
  catalogIds: ['fe.realtime-client', 'fe.api-client'],
  a: 1.2,
  b: 0.8,
  space: 1e7,
  time: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const cap = rng.int(2, 4);
    const interval = rng.pick([200, 250, 500]); // мс на один токен
    const n = rng.int(5, 8);
    const arr: number[] = [];
    let t = rng.int(0, 200);
    for (let i = 0; i < n; i++) {
      arr.push(t);
      t += rng.pick([0, 50, 100, 150, 300]);
    }
    let credit = cap * interval; // накопленное «время» токенов, в мс
    let last = 0;
    let sent = 0;
    for (const a of arr) {
      let now = Math.max(a, sent);
      credit = Math.min(cap * interval, credit + (now - last));
      last = now;
      if (credit < interval) {
        now += interval - credit;
        credit = interval;
        last = now;
      }
      credit -= interval;
      sent = now;
    }
    return {
      prompt: `Клиент отправляет сообщения по очереди (FIFO), каждое тратит один токен. Ведро вместимостью ${cap} токена вначале полное (момент 0), новый токен добавляется каждые ${interval} мс. Сообщение отправляется в момент, когда оно готово и есть токен. Сообщения готовы в моменты (мс): ${arr.join(', ')}. В какой момент уйдёт последнее?`,
      answerHint: 'миллисекунды',
      answerKey: String(sent),
      explanation: 'Пока токены есть, сообщения уходят сразу (пачкой); когда ведро пусто, каждое следующее ждёт своего токена с интервалом. Моделируем по очереди, накапливая токены не выше вместимости.',
      params: { cap, interval, arr: arr.join(',') },
    };
  },
});

export const subscriptionRefs = fam({
  id: 'fe.b2-subscription-refs',
  sub: RT,
  grade: 'middle',
  title: 'Подписки на каналы и подсчёт ссылок',
  catalogIds: ['fe.realtime-client', 'fe.components'],
  a: 1.2,
  b: 0.5,
  space: 1e7,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const chans = ['prices', 'chat', 'alerts'];
    const comps = ['A', 'B', 'C', 'D'];
    const subs = new Map<string, Set<string>>();
    chans.forEach((c) => subs.set(c, new Set()));
    const ops: string[] = [];
    let msgs = 0;
    for (let i = 0; i < rng.int(8, 12); i++) {
      const ch = rng.pick(chans);
      const co = rng.pick(comps);
      const set = subs.get(ch)!;
      if (set.has(co)) {
        set.delete(co);
        if (set.size === 0) msgs++; // последний ушёл: UNSUBSCRIBE
        ops.push(`${co} отписывается от ${ch}`);
      } else {
        if (set.size === 0) msgs++; // первый пришёл: SUBSCRIBE
        set.add(co);
        ops.push(`${co} подписывается на ${ch}`);
      }
    }
    return {
      prompt: 'Менеджер подключения общий. Сообщение SUBSCRIBE уходит на сервер, только когда у канала появляется первый подписчик-компонент; UNSUBSCRIBE — когда уходит последний. Остальные подписки и отписки обрабатываются локально. Сколько всего сообщений SUBSCRIBE/UNSUBSCRIBE будет отправлено?',
      code: ops.map((o, i) => `${i + 1}. ${o}`).join('\n'),
      answerHint: 'число',
      answerKey: String(msgs),
      explanation: 'Для каждого канала ведём множество компонентов-подписчиков и считаем переходы пусто → непусто и непусто → пусто.',
      params: { ops: ops.join('|') },
    };
  },
});

// --- Senior ---------------------------------------------------------------------------

export const srVectorConcurrent = fam({
  id: 'fe.b2-sr-vector-concurrent',
  sub: RT,
  grade: 'senior',
  title: 'Конкурентные правки по векторным часам',
  catalogIds: ['fe.realtime-client', 'fe.state-mgmt', 'fe.architecture'],
  taskId: 'task:find-bug',
  a: 1.2,
  b: 1.3,
  space: 1e8,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const n = rng.int(5, 6);
    const vs = Array.from({ length: n }, () => [rng.int(0, 3), rng.int(0, 3), rng.int(0, 3)]);
    const le = (x: number[], y: number[]) => x.every((v, i) => v <= y[i]!);
    let conc = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (!le(vs[i]!, vs[j]!) && !le(vs[j]!, vs[i]!)) conc++;
    return {
      prompt: 'Правки трёх клиентов помечены векторными часами [A, B, C]. Правка X предшествует Y, если во всех компонентах X ≤ Y (и векторы не равны); если ни одна не предшествует другой, правки конкурентны и требуют разрешения конфликта. Сколько неупорядоченных пар правок конкурентны?',
      code: vs.map((v, i) => `e${i + 1}: [${v.join(', ')}]`).join('\n'),
      answerHint: 'число',
      answerKey: String(conc),
      explanation: `Из ${(n * (n - 1)) / 2} пар конкурентны ${conc}: у них часть компонент больше, а часть меньше. Для таких пар одной отметки времени мало, нужно правило слияния (CRDT, ручной выбор).`,
      params: { vs: vs.map((v) => v.join('')).join(',') },
    };
  },
});

export const srFanoutBandwidth = fam({
  id: 'fe.b2-sr-fanout-bandwidth',
  sub: RT,
  grade: 'senior',
  title: 'Исходящий трафик при рассылке в комнаты',
  catalogIds: ['fe.realtime-client', 'fe.architecture', 'fe.web-perf'],
  taskId: 'task:complexity',
  a: 1.1,
  b: 1.2,
  space: 1e8,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const R = rng.int(4, 20);
    const n = rng.pick([100, 200, 250, 400, 500]);
    const m = rng.pick([10, 20, 40, 50]);
    const p = rng.pick([100, 200, 300, 500]);
    const h = rng.pick([20, 40]);
    const w = rng.pick([0, 100, 250, 500]);
    const frames = w === 0 ? m : Math.min(m, 1000 / w);
    const perClient = frames * h + m * p;
    const kb = Math.floor((R * n * perClient) / 1000);
    return {
      prompt: `Сервер рассылает каждое сообщение всем клиентам своей комнаты. Комнат ${R}, в каждой ${n} клиентов, ${m} сообщений в секунду, полезная нагрузка ${p} байт, накладные расходы на кадр WebSocket — ${h} байт. ${w === 0 ? 'Каждое сообщение отправляется отдельным кадром.' : `Сообщения за окно ${w} мс склеиваются в один кадр (кадров в секунду на клиента: не более ${1000 / w} и не более числа сообщений).`} Сколько килобайт в секунду (1 КБ = 1000 байт, округлить вниз) уходит с сервера всего?`,
      answerHint: 'КБ/с, целое число',
      answerKey: String(kb),
      explanation: `На клиента: ${frames} кадров × ${h} + ${m} × ${p} = ${perClient} байт/с. Всего ${R} × ${n} × ${perClient} / 1000, вниз — ${kb}. Склейка уменьшает накладные расходы, но добавляет до ${w} мс задержки.`,
      params: { R, n, m, p, h, w },
    };
  },
});

export const srBackpressure = fam({
  id: 'fe.b2-sr-backpressure',
  sub: RT,
  grade: 'senior',
  title: 'Буфер сообщений при медленном потребителе',
  catalogIds: ['fe.realtime-client', 'fe.render-perf', 'fe.architecture'],
  taskId: 'task:web-vitals',
  a: 1.2,
  b: 1.1,
  space: 1e7,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const lam = rng.pick([300, 400, 500]);
    const mu = rng.pick([100, 200, 250]);
    const B = rng.pick([1000, 2000, 2500]);
    const T = rng.pick([10, 20, 30]);
    const ask = rng.pick(['dropped', 'latency'] as const);
    const dropped = Math.max(0, (lam - mu) * T - B);
    const latency = (B / mu) * 1000;
    return {
      prompt: `Сокет доставляет ${lam} сообщений в секунду, интерфейс успевает обработать ${mu} в секунду. Между ними буфер на ${B} сообщений; при переполнении отбрасывается самое старое. Буфер вначале пуст, поток идёт ${T} секунд без остановки. ${ask === 'dropped' ? 'Сколько сообщений будет отброшено за это время?' : 'Через какое число мс (целое) после полного заполнения буфера будет обработано самое новое сообщение из тех, что в нём лежат (задержка от постановки в очередь)?'}`,
      answerHint: ask === 'dropped' ? 'сообщения' : 'миллисекунды',
      answerKey: String(ask === 'dropped' ? dropped : latency),
      explanation: ask === 'dropped' ? `Очередь растёт на ${lam - mu} сообщений в секунду; за ${T} с прибавится ${(lam - mu) * T}, из них ${B} помещаются, остальное отброшено: ${dropped}.` : `Новое сообщение встаёт за ${B} уже лежащими, а обрабатывается ${mu} в секунду: ${B}/${mu} с = ${latency} мс. Растёт и устаревание данных — поэтому нужна политика (слияние по ключу, выборка), а не только размер буфера.`,
      params: { lam, mu, B, T, ask },
    };
  },
});

export const srOfflineCoalesce = fam({
  id: 'fe.b2-sr-offline-coalesce',
  sub: RT,
  grade: 'senior',
  title: 'Очередь офлайн-операций со склейкой',
  catalogIds: ['fe.realtime-client', 'fe.browser-storage', 'fe.api-client', 'fe.architecture'],
  taskId: 'task:find-bug',
  a: 1.2,
  b: 1.4,
  space: 1e8,
  time: 280,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const existing = ['t1', 't2', 't3'];
    const fresh = ['n1', 'n2'];
    type Ent = { isNew: boolean; sets: number; incs: number; del: boolean };
    const ents = new Map<string, Ent>();
    existing.forEach((e) => ents.set(e, { isNew: false, sets: 0, incs: 0, del: false }));
    const ops: string[] = [];
    const created: string[] = [];
    for (let i = 0; i < rng.int(9, 13); i++) {
      const kind = rng.pick(['create', 'set', 'set', 'inc', 'inc', 'del'] as const);
      const alive = [...ents.entries()].filter(([, v]) => !v.del).map(([k]) => k);
      if (kind === 'create' && created.length < fresh.length) {
        const id = fresh[created.length]!;
        created.push(id);
        ents.set(id, { isNew: true, sets: 0, incs: 0, del: false });
        ops.push(`create ${id}`);
      } else if (alive.length) {
        const id = rng.pick(alive);
        const e = ents.get(id)!;
        if (kind === 'del') e.del = true;
        else if (kind === 'inc') e.incs++;
        else e.sets++;
        ops.push(`${kind === 'del' ? 'delete' : kind === 'inc' ? 'increment' : 'update'} ${id}`);
      }
    }
    let reqs = 0;
    for (const e of ents.values()) {
      if (e.isNew) reqs += e.del ? 0 : 1;
      else if (e.del) reqs += 1;
      else reqs += (e.sets > 0 ? 1 : 0) + (e.incs > 0 ? 1 : 0);
    }
    return {
      prompt: 'Клиент накопил операции офлайн и при подключении отправляет очередь с оптимизацией. Правила: все update одной записи склеиваются в один запрос; все increment одной записи — в один; для записи, созданной офлайн, все её операции вливаются в один запрос create; если запись создана офлайн и затем удалена, не отправляется ничего; удаление существующей записи отменяет остальные её операции и уходит одним запросом. Сколько запросов уйдёт?',
      code: ops.map((o, i) => `${i + 1}. ${o}`).join('\n'),
      answerHint: 'число',
      answerKey: String(reqs),
      explanation: `Считаем по записям: ${[...ents.entries()].map(([k, v]) => `${k}: ${v.isNew ? 'новая' : 'старая'}${v.del ? ', удалена' : ''}, обновлений ${v.sets}, инкрементов ${v.incs}`).join('; ')}. Итого ${reqs}. Склейка требует идемпотентных запросов и учёта порядка при конфликтах с сервером.`,
      params: { ops: ops.join('|') },
    };
  },
});

export const RT_BANK2_GENERATORS = [
  emptyPolls, jsonMessages, unreadCounter,
  throttleFlushes, lwwClocks, presenceCount, tokenBucket, subscriptionRefs,
  srVectorConcurrent, srFanoutBandwidth, srBackpressure, srOfflineCoalesce,
];
