// Банк-2 backend.integrations: +3 Junior, +5 Middle, +4 Senior. Ответ считает код (R-T-02); a, b – ПРЕДЛОЖЕНИЕ.
import { createRng } from '../rng';
import type { TaskGenerator } from '../types';
import { fam } from './backend-bank2-util';

// ---------------------------------------------------------------------------
// Junior
// ---------------------------------------------------------------------------

export const intRetryAfter: TaskGenerator = fam(
  { slug: 'int-retry-after', title: 'Сколько ждать с учётом Retry-After', sub: 'integrations', grade: 'junior', catalogIds: ['be.retries-timeouts', 'common.http'], format: 'number', a: 1.2, b: -0.8, paramSpace: 5e4, timeLimitSec: 180 },
  (seed) => {
    const rng = createRng(seed);
    const fails = rng.int(3, 4);
    const rows = Array.from({ length: fails }, () => ({ code: rng.pick([429, 503]), after: rng.int(0, 2) === 0 ? null : rng.pick([3, 5, 10, 15]) }));
    let total = 0;
    const parts: string[] = [];
    rows.forEach((r, i) => {
      const w = r.after ?? 2 ** i;
      total += w;
      parts.push(`${w}`);
    });
    return {
      prompt: `Клиент повторяет запрос до успеха. После неудачной попытки с номером k (k = 1, 2, ...) он ждёт столько секунд, сколько указано в заголовке Retry-After; если заголовка нет - 2^(k-1) секунд. Попытки 1..${fails} закончились так, как показано ниже, попытка ${fails + 1} успешна. Сколько секунд клиент в сумме ждал между попытками?`,
      code: rows.map((r, i) => `попытка ${i + 1}: ${r.code}${r.after ? `, Retry-After: ${r.after}` : ', заголовка Retry-After нет'}`).join('\n'),
      answerHint: 'секунды',
      answerKey: String(total),
      explanation: `Паузы: ${parts.join(' + ')} = ${total} с.`,
      params: { fails, total },
    };
  },
);

export const intQueueDlq: TaskGenerator = fam(
  { slug: 'int-queue-dlq', title: 'Доставки и мёртвая очередь', sub: 'integrations', grade: 'junior', catalogIds: ['be.message-queue', 'be.retries-timeouts'], format: 'number', a: 1.2, b: -0.6, paramSpace: 1e5, timeLimitSec: 180 },
  (seed) => {
    const rng = createRng(seed);
    const maxD = rng.int(3, 4);
    const msgs = Array.from({ length: rng.int(5, 6) }, (_, i) => ({ id: `m${i + 1}`, fails: rng.pick([0, 0, 1, 2, 3, 5, 9]) }));
    const deliveries = msgs.map((m) => Math.min(m.fails + 1, maxD));
    const dead = msgs.filter((m) => m.fails >= maxD).length;
    const ask = rng.pick(['all', 'dead'] as const);
    return {
      prompt: `Потребитель получает сообщение из очереди; при ошибке обработки сообщение возвращается в очередь и доставляется снова. После ${maxD}-й неудачной доставки сообщение уходит в мёртвую очередь (DLQ) и больше не доставляется. Ниже указано, сколько первых доставок каждого сообщения завершится ошибкой (дальше обработка проходит успешно). ${ask === 'all' ? 'Сколько всего доставок будет сделано по всем сообщениям?' : 'Сколько сообщений окажется в DLQ?'}`,
      code: msgs.map((m) => `${m.id}: первых ошибок ${m.fails}`).join('\n'),
      answerHint: ask === 'all' ? 'число доставок' : 'число сообщений',
      answerKey: String(ask === 'all' ? deliveries.reduce((s, x) => s + x, 0) : dead),
      explanation: `Доставок на сообщение: min(ошибки + 1, ${maxD}) = ${deliveries.join(', ')}; в DLQ уходят сообщения с числом ошибок не меньше ${maxD}: ${dead}.`,
      params: { maxD, ask },
    };
  },
);

export const intIsoLatest: TaskGenerator = fam(
  { slug: 'int-iso-latest', title: 'Какое событие случилось позже всех', sub: 'integrations', grade: 'junior', catalogIds: ['be.external-integration', 'common.http'], format: 'line', a: 1.2, b: -0.7, paramSpace: 5e5, timeLimitSec: 180 },
  (seed) => {
    const rng = createRng(seed);
    const n = 9;
    const used = new Set<number>();
    const rows: { s: string; ms: number }[] = [];
    while (rows.length < n) {
      const base = Date.UTC(2026, 9, rng.int(1, 9), rng.int(6, 20), rng.pick([0, 15, 30, 45]));
      const off = rng.pick([-5, -3, 0, 2, 3, 5, 7, 9]);
      const ms = base; // момент в UTC, строка записывается в местном времени с offset
      if (used.has(ms)) continue;
      used.add(ms);
      const local = new Date(ms + off * 3600_000);
      const p = (x: number) => String(x).padStart(2, '0');
      const sign = off < 0 ? '-' : '+';
      const s = `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}T${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:00${off === 0 ? 'Z' : `${sign}${p(Math.abs(off))}:00`}`;
      rows.push({ s, ms: Date.parse(s) });
    }
    let best = 0;
    rows.forEach((r, i) => {
      if (r.ms > rows[best]!.ms) best = i;
    });
    return {
      prompt: 'Партнёрский API присылает время событий в формате ISO 8601 со смещением часового пояса. Какая строка списка соответствует самому позднему моменту времени? Укажите её номер.',
      code: rows.map((r, i) => `${i + 1}. ${r.s}`).join('\n'),
      answerHint: 'номер строки',
      answerKey: String(best + 1),
      explanation: `Приводим к UTC: ${rows.map((r) => new Date(r.ms).toISOString().slice(0, 16)).join('; ')}. Позже всех - строка ${best + 1}.`,
      params: { first: rows[0]!.s },
    };
  },
);

// ---------------------------------------------------------------------------
// Middle
// ---------------------------------------------------------------------------

export const intBackoffDeadline: TaskGenerator = fam(
  { slug: 'int-backoff-deadline', title: 'Сколько попыток успеет клиент до дедлайна', sub: 'integrations', grade: 'middle', catalogIds: ['be.retries-timeouts', 'be.external-integration'], format: 'number', a: 1.3, b: 0.45, paramSpace: 1e5, timeLimitSec: 240 },
  (seed) => {
    const rng = createRng(seed);
    const base = rng.pick([1, 2, 3]);
    const cap = rng.pick([8, 10, 16, 30]);
    const attemptT = rng.pick([1, 2, 3, 5]);
    const deadline = rng.int(20, 300);
    const maxA = rng.int(4, 18);
    let t = 0;
    let attempts = 0;
    const starts: number[] = [];
    while (attempts < maxA && t < deadline) {
      starts.push(t);
      attempts++;
      t += attemptT; // попытка всегда заканчивается таймаутом
      t += Math.min(cap, base * 2 ** (attempts - 1));
    }
    return {
      prompt: `Сервис недоступен, каждая попытка заканчивается таймаутом через ${attemptT} с. После k-й неудачной попытки клиент ждёт min(${cap}, ${base}·2^(k-1)) секунд. Новая попытка начинается только если с первого запроса прошло меньше ${deadline} с, и не больше ${maxA} попыток всего. Начатая попытка завершается полностью, даже если дедлайн истёк во время неё. Сколько попыток сделает клиент?`,
      answerHint: 'число попыток',
      answerKey: String(attempts),
      explanation: `Попытки стартуют в моменты ${starts.join(', ')} с; после последней дедлайн ${deadline} с или лимит ${maxA} исчерпан. Итого ${attempts}.`,
      params: { base, cap, attemptT, deadline, maxA },
    };
  },
);

export const intOutbox: TaskGenerator = fam(
  { slug: 'int-outbox', title: 'Потеряно или продублировано при сбоях', sub: 'integrations', grade: 'middle', catalogIds: ['be.message-queue', 'be.transactions', 'be.idempotency'], format: 'number', a: 1.3, b: 0.6, paramSpace: 1e5, timeLimitSec: 240 },
  (seed) => {
    const rng = createRng(seed);
    const outbox = rng.int(0, 1) === 1;
    const kinds = ['A', 'B', 'C', 'D'] as const;
    const w = [rng.int(1, 4), rng.int(1, 4), rng.int(1, 4), rng.int(1, 4)];
    const log = Array.from({ length: 14 }, () => {
      let r = rng.int(1, w[0]! + w[1]! + w[2]! + w[3]!);
      for (let i = 0; i < 4; i++) {
        r -= w[i]!;
        if (r <= 0) return kinds[i]!;
      }
      return kinds[3];
    });
    const text: Record<(typeof kinds)[number], string> = {
      A: 'процесс упал до коммита транзакции',
      B: outbox ? 'процесс упал после коммита, до того как ретранслятор забрал запись из outbox' : 'процесс упал после коммита, до публикации события',
      C: outbox ? 'ретранслятор опубликовал событие и упал до отметки «отправлено»' : 'процесс упал сразу после публикации события',
      D: 'сбоев не было',
    };
    let anomalies = 0;
    for (const k of log) {
      if (!outbox && k === 'B') anomalies++; // событие потеряно: заказ есть, события нет
      if (outbox && k === 'C') anomalies++; // повторная публикация
    }
    return {
      prompt: `Сервис создаёт заказ в БД и должен ровно один раз опубликовать событие «заказ создан» в брокер. ${
        outbox
          ? 'Реализация: заказ и запись события пишутся в одной транзакции (outbox); отдельный ретранслятор публикует записи и затем помечает их отправленными; неотмеченные записи публикуются повторно.'
          : 'Реализация: коммит транзакции с заказом, затем публикация события в брокер (без outbox и без повторов).'
      } Аномалия - заказ создан, а события нет, либо событие опубликовано дважды. Ниже журнал четырнадцати обработок с причиной сбоя. В скольких обработках возникла аномалия?`,
      code: log.map((k, i) => `${i + 1}. ${text[k]}`).join('\n'),
      answerHint: 'число обработок с аномалией',
      answerKey: String(anomalies),
      explanation: outbox ? 'С outbox событие не теряется, но сбой после публикации и до отметки даёт дубль (доставка at-least-once).' : 'Без outbox сбой между коммитом и публикацией теряет событие; сбой до коммита и после публикации аномалий не даёт.',
      params: { outbox, anomalies },
    };
  },
);

export const intTolerantReader: TaskGenerator = fam(
  { slug: 'int-tolerant-reader', title: 'Какие события потребитель обработает', sub: 'integrations', grade: 'middle', catalogIds: ['be.api-contract', 'be.message-queue', 'be.external-integration'], format: 'number', a: 1.2, b: 0.35, paramSpace: 1e6, timeLimitSec: 240 },
  (seed) => {
    const rng = createRng(seed);
    const required: [string, 'number' | 'string'][] = [['id', 'number'], ['type', 'string'], ['amount', 'number']];
    const maxV = rng.int(2, 3);
    const bad = rng.int(1, 4);
    const events = Array.from({ length: 12 }, () => {
      const e: Record<string, unknown> = { v: rng.int(1, 4), id: rng.int(1, 99), type: rng.pick(['paid', 'refund']), amount: rng.int(1, 9) * 10 };
      if (rng.int(0, 11) < bad) delete e.amount;
      if (rng.int(0, 11) < bad) e.id = String(e.id);
      if (rng.int(0, 3) === 0) e.currency = 'RUB';
      if (rng.int(0, 11) < bad) e.type = rng.pick([1, 2]);
      return e;
    });
    const ok = (e: Record<string, unknown>) => (e.v as number) <= maxV && required.every(([k, t]) => typeof e[k] === t);
    const n = events.filter(ok).length;
    return {
      prompt: `Потребитель принимает события версии не выше ${maxV} (поле v). Обязательные поля: id (число), type (строка), amount (число). Лишние поля он игнорирует (tolerant reader), но отсутствие обязательного поля или другой тип значения делают событие необрабатываемым. Сколько из событий потребитель обработает?`,
      code: events.map((e, i) => `${i + 1}. ${JSON.stringify(e)}`).join('\n'),
      answerHint: 'число обработанных событий',
      answerKey: String(n),
      explanation: `Проверяем версию, наличие и тип id, type, amount; лишние поля не мешают. Обработано ${n}.`,
      params: { maxV, n },
    };
  },
);

export const intPollingCount: TaskGenerator = fam(
  { slug: 'int-polling-count', title: 'Сколько раз клиент опросит статус задачи', sub: 'integrations', grade: 'middle', catalogIds: ['be.external-integration', 'be.background-jobs'], format: 'number', a: 1.2, b: 0.3, paramSpace: 5e4, timeLimitSec: 210 },
  (seed) => {
    const rng = createRng(seed);
    const first = rng.pick([1, 2, 3]);
    const cap = rng.pick([8, 10, 15]);
    const done = rng.int(20, 90);
    let t = 0;
    let polls = 0;
    let wait = first;
    for (;;) {
      polls++;
      if (t >= done) break;
      t += wait;
      wait = Math.min(cap, wait * 2);
    }
    return {
      prompt: `Клиент создал асинхронную задачу у партнёра в момент 0 и опрашивает статус. Первый опрос - сразу (в момент 0); затем пауза ${first} с, после каждого опроса пауза удваивается, но не больше ${cap} с. Задача завершается на ${done}-й секунде; опрос в момент завершения или позже видит результат. Сколько опросов сделает клиент, включая последний, увидевший результат?`,
      answerHint: 'число опросов',
      answerKey: String(polls),
      explanation: `Опросы идут в моменты 0, ${first}, ${first + first * 2}, ... с паузами ${first}, ${first * 2}, ... до ${cap}; первый опрос в момент ≥ ${done} - ${polls}-й.`,
      params: { first, cap, done },
    };
  },
);

export const intSyncDiff: TaskGenerator = fam(
  { slug: 'int-sync-diff', title: 'Сколько операций выполнит синхронизация', sub: 'integrations', grade: 'middle', catalogIds: ['be.external-integration', 'be.idempotency'], format: 'number', a: 1.2, b: 0.4, paramSpace: 1e6, timeLimitSec: 240 },
  (seed) => {
    const rng = createRng(seed);
    const ids = rng.sample([101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115], 14);
    const local = ids.slice(0, rng.int(6, 12)).map((id) => ({ id, ver: rng.int(1, 4) }));
    const ch = rng.int(0, 5);
    const remote: { id: number; ver: number; deleted: boolean }[] = [];
    for (const l of local) {
      if (rng.int(0, 9) < ch) continue; // у партнёра исчезла запись
      remote.push({ id: l.id, ver: rng.int(0, 9) < ch + 2 ? l.ver + 1 : l.ver, deleted: rng.int(0, 9) < ch });
    }
    for (const id of ids.slice(local.length, local.length + rng.int(2, 4))) remote.push({ id, ver: 1, deleted: rng.int(0, 3) === 0 });
    let create = 0;
    let update = 0;
    let del = 0;
    const lm = new Map(local.map((l) => [l.id, l.ver]));
    for (const r of remote) {
      const has = lm.has(r.id);
      if (r.deleted) {
        if (has) del++;
      } else if (!has) create++;
      else if (r.ver > lm.get(r.id)!) update++;
    }
    for (const l of local) if (!remote.some((r) => r.id === l.id)) del++;
    return {
      prompt: 'Локальная таблица зеркалит каталог партнёра, источник истины - партнёр. Синхронизация: запись есть у партнёра (не помечена удалённой), а локально нет - создать; версия у партнёра выше локальной - обновить; запись помечена удалённой или пропала из выдачи партнёра, но есть локально - удалить; помеченную удалённой запись, которой нет локально, пропустить. Сколько всего операций (создание, обновление, удаление) выполнит синхронизация?',
      code: `локально: ${local.map((l) => `${l.id}@v${l.ver}`).join(', ')}\nу партнёра: ${remote.map((r) => `${r.id}@v${r.ver}${r.deleted ? ' (удалена)' : ''}`).join(', ')}`,
      answerHint: 'число операций',
      answerKey: String(create + update + del),
      explanation: `Создать ${create}, обновить ${update}, удалить ${del}: всего ${create + update + del}.`,
      params: { create, update, del },
    };
  },
);

// ---------------------------------------------------------------------------
// Senior
// ---------------------------------------------------------------------------

export const intPartitionSkew: TaskGenerator = fam(
  { slug: 'int-partition-skew', title: 'Перекос партиций между потребителями', sub: 'integrations', grade: 'senior', catalogIds: ['be.message-queue', 'be.performance'], format: 'number', a: 1.1, b: 1.1, paramSpace: 1e6, timeLimitSec: 270 },
  (seed) => {
    const rng = createRng(seed);
    const P = rng.pick([4, 6, 8]);
    const C = rng.pick([2, 3]);
    const keys = rng.sample([11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22], 6).map((k) => ({ key: k, rate: rng.pick([50, 100, 200, 400]) }));
    const perPart = new Array(P).fill(0) as number[];
    for (const k of keys) perPart[k.key % P]! += k.rate;
    const perCons = new Array(C).fill(0) as number[];
    perPart.forEach((v, p) => (perCons[p % C]! += v));
    const worst = Math.max(...perCons);
    return {
      prompt: `Топик из ${P} партиций; сообщение попадает в партицию с номером (ключ mod ${P}). В группе ${C} потребителя(ей): партиция p обслуживается потребителем p mod ${C}. Ниже ключи и поток сообщений в секунду по каждому. Сколько сообщений в секунду придётся обработать самому загруженному потребителю?`,
      code: keys.map((k) => `ключ ${k.key}: ${k.rate} сообщ/с`).join('\n'),
      answerHint: 'сообщений в секунду',
      answerKey: String(worst),
      explanation: `Нагрузка по партициям: ${perPart.join(', ')}; по потребителям: ${perCons.join(', ')}. Максимум ${worst}. Порядок по ключу сохраняется, но потребителей поровну не загрузить - мешает перекос ключей.`,
      params: { P, C },
    };
  },
);

export const intDlqReplay: TaskGenerator = fam(
  { slug: 'int-dlq-replay', title: 'Нарушение порядка после повтора из DLQ', sub: 'integrations', grade: 'senior', catalogIds: ['be.message-queue', 'be.distributed-consistency'], format: 'number', a: 1.2, b: 1.25, paramSpace: 1e6, timeLimitSec: 270 },
  (seed) => {
    const rng = createRng(seed);
    const n = rng.int(8, 10);
    const msgs = Array.from({ length: n }, (_, i) => ({ i, key: rng.pick(['A', 'B', 'C']), fail: rng.int(0, 3) === 0 }));
    const processed = [...msgs.filter((m) => !m.fail), ...msgs.filter((m) => m.fail)];
    const pos = new Map(processed.map((m, p) => [m.i, p]));
    let inv = 0;
    for (const x of msgs)
      for (const y of msgs) if (x.i < y.i && x.key === y.key && pos.get(x.i)! > pos.get(y.i)!) inv++;
    return {
      prompt: 'Сообщения приходят в указанном порядке. Те, что помечены ✗, не обрабатываются с первого раза и уходят в DLQ; основной поток обрабатывает остальные по порядку; после этого DLQ целиком проигрывают в исходном порядке. Для одного ключа важен порядок. Сколько пар сообщений с одним ключом будет обработано в порядке, обратном исходному?',
      code: msgs.map((m) => `${m.i + 1}. ключ ${m.key}${m.fail ? ' ✗' : ''}`).join('\n'),
      answerHint: 'число пар',
      answerKey: String(inv),
      explanation: `Порядок обработки: ${processed.map((m) => m.i + 1).join(', ')}. Пара (x, y) с одним ключом, где x было раньше y, но обработано позже, считается инверсией: ${inv}.`,
      params: { n, inv },
    };
  },
);

export const intTokenRefresh: TaskGenerator = fam(
  { slug: 'int-token-refresh', title: 'Лавина обновлений токена', sub: 'integrations', grade: 'senior', catalogIds: ['be.external-integration', 'be.concurrency', 'be.authn-impl'], format: 'number', a: 1.2, b: 1.15, paramSpace: 1e6, timeLimitSec: 270 },
  (seed) => {
    const rng = createRng(seed);
    const ttl = rng.pick([60, 100, 120]);
    const dur = rng.pick([8, 12, 15, 20]);
    const times = Array.from({ length: 40 }, () => rng.int(1, ttl * 3 + 10)).sort((a, b) => a - b);
    const run = (lock: boolean): number => {
      let exp = ttl;
      let doneAt: number | null = null;
      let calls = 0;
      for (const t of times) {
        if (doneAt !== null && t >= doneAt) {
          exp = doneAt + ttl;
          doneAt = null;
        }
        if (t < exp) continue;
        if (doneAt === null) {
          calls++;
          doneAt = t + dur;
        } else if (!lock) calls++;
      }
      return calls;
    };
    const free = run(false);
    const locked = run(true);
    return {
      prompt: `Клиент партнёрского API получает токен в момент 0, токен живёт ${ttl} с. Запрос, увидевший просроченный токен, вызывает обновление; обновление длится ${dur} с, новый токен живёт ${ttl} с с момента готовности. Пока обновление идёт, токена нет: каждый пришедший запрос без синхронизации вызывает своё обновление, а с блокировкой (single-flight) ждёт уже запущенное. Запросы приходят в моменты (с), перечисленные ниже. На сколько вызовов обновления больше сделает клиент без блокировки, чем с ней?`,
      code: `моменты запросов: ${times.join(', ')}`,
      answerHint: 'разница в числе вызовов обновления',
      answerKey: String(free - locked),
      explanation: `Без блокировки ${free} вызовов, с блокировкой ${locked}; разница ${free - locked}. Лишние вызовы - запросы внутри окна обновления.`,
      params: { ttl, dur },
    };
  },
);

export const intTokenBucket: TaskGenerator = fam(
  { slug: 'int-token-bucket', title: 'Два ведра токенов: клиентское и общее', sub: 'integrations', grade: 'senior', catalogIds: ['be.rate-limit', 'be.external-integration'], format: 'number', a: 1.1, b: 1.3, paramSpace: 1e6, timeLimitSec: 300 },
  (seed) => {
    const rng = createRng(seed);
    const cap = rng.pick([3, 4, 5]);
    const rate = rng.pick([1, 2]);
    const globalLimit = rng.pick([4, 5, 6]);
    const secs = 5;
    const load = Array.from({ length: secs }, () => [rng.int(0, 6), rng.int(0, 6)]);
    const tok = [cap, cap];
    let rejected = 0;
    const per: number[] = [];
    load.forEach((row, s) => {
      if (s > 0) for (let c = 0; c < 2; c++) tok[c] = Math.min(cap, tok[c]! + rate);
      let used = 0;
      let rej = 0;
      for (let c = 0; c < 2; c++) {
        for (let k = 0; k < row[c]!; k++) {
          if (tok[c]! <= 0) {
            rej++;
            continue;
          }
          tok[c]!--;
          if (used >= globalLimit) rej++;
          else used++;
        }
      }
      rejected += rej;
      per.push(rej);
    });
    return {
      prompt: `У каждого из двух клиентов (A и B) своё ведро токенов: ёмкость ${cap}, в начале полное, пополняется на ${rate} токен(а) в начале каждой секунды (кроме нулевой), но не выше ёмкости. Запрос тратит токен клиента; если токенов нет - отказ. Кроме того, общий лимит: не больше ${globalLimit} принятых запросов в секунду на обоих клиентов; запрос, прошедший клиентское ведро, но не прошедший общий лимит, отклоняется, а токен клиента уже потрачен. Внутри секунды сначала обрабатываются все запросы A, затем B. Сколько запросов будет отклонено за ${secs} секунд?`,
      code: load.map((r, s) => `секунда ${s}: A - ${r[0]}, B - ${r[1]}`).join('\n'),
      answerHint: 'число отклонённых запросов',
      answerKey: String(rejected),
      explanation: `Отказы по секундам: ${per.join(', ')}; итого ${rejected}.`,
      params: { cap, rate, globalLimit },
    };
  },
);

export const INTEGRATIONS_BANK2: TaskGenerator[] = [
  intRetryAfter,
  intQueueDlq,
  intIsoLatest,
  intBackoffDeadline,
  intOutbox,
  intTolerantReader,
  intPollingCount,
  intSyncDiff,
  intPartitionSkew,
  intDlqReplay,
  intTokenRefresh,
  intTokenBucket,
];
