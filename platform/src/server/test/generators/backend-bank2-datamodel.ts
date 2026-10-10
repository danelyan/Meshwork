// Банк-2 backend.data-model: +3 Junior, +5 Middle, +4 Senior. Пробел: миграции ниже Senior.
// Ответ считает код (R-T-02); a, b — ПРЕДЛОЖЕНИЕ (экспертные).
import { createRng } from '../rng';
import type { TaskGenerator } from '../types';
import { fam, until } from './backend-bank2-util';

// ---------------------------------------------------------------------------
// Junior
// ---------------------------------------------------------------------------

export const dmMigrationsPending: TaskGenerator = fam(
  { slug: 'dm-migrations-pending', title: 'Сколько миграций применится', sub: 'data-model', grade: 'junior', catalogIds: ['be.migrations'], format: 'number', a: 1.2, b: -0.8, paramSpace: 1e5, timeLimitSec: 180 },
  (seed) => {
    const rng = createRng(seed);
    const names = ['create_users', 'add_email_index', 'create_orders', 'add_order_status', 'create_payments', 'add_user_phone', 'drop_legacy_table', 'add_payment_ref', 'create_items', 'add_item_sku', 'create_audit_log', 'add_user_locale'];
    const n = rng.int(9, 12);
    const files = rng.sample(names, n).map((name, i) => `202609${String(i + 1).padStart(2, '0')}_${name}`);
    const appliedCount = rng.int(2, n - 2);
    const applied = new Set(files.slice(0, appliedCount));
    // одна из старых миграций почему-то не применена (например, ветка влита позже)
    const skipped = files[rng.int(0, appliedCount - 1)]!;
    applied.delete(skipped);
    const pending = files.filter((f) => !applied.has(f));
    const bad = rng.pick(pending);
    const idx = pending.indexOf(bad);
    return {
      prompt: 'Инструмент миграций применяет по порядку имён файлов все миграции, которых нет в таблице schema_migrations, и останавливается на первой, которая завершилась ошибкой (ошибочная миграция откатывается и не записывается; последующие не запускаются). Сколько миграций будет успешно применено при запуске?',
      code: `файлы в каталоге:\n${files.join('\n')}\n\nв schema_migrations: ${[...applied].join(', ')}\nс ошибкой при применении: ${bad}`,
      answerHint: 'число миграций',
      answerKey: String(idx),
      explanation: `К применению ${pending.length} файла(ов) по порядку: ${pending.join(', ')}. До ошибочной ${bad} успешно проходят ${idx}.`,
      params: { n, appliedCount, bad },
    };
  },
);

export const dmJunctionRows: TaskGenerator = fam(
  { slug: 'dm-junction-rows', title: 'Сколько строк в связующей таблице', sub: 'data-model', grade: 'junior', catalogIds: ['be.sql-schema', 'common.sql-queries'], format: 'number', a: 1.2, b: -0.65, paramSpace: 1e6, timeLimitSec: 180 },
  (seed) => {
    const rng = createRng(seed);
    const pairs = new Set<string>();
    const students = new Set([1, 2, 3, 4, 5, 6]);
    const mk = (s: number, c: number) => `${s}:${c}`;
    for (let i = 0; i < rng.int(4, 8); i++) pairs.add(mk(rng.int(1, 6), rng.int(1, 4)));
    const start = [...pairs];
    const ops: string[] = [];
    for (let i = 0; i < 10; i++) {
      const kind = rng.int(0, 3);
      const s = rng.int(1, 6);
      const c = rng.int(1, 4);
      if (kind <= 1) {
        ops.push(`INSERT INTO enrollments VALUES (${s}, ${c}) ON CONFLICT DO NOTHING;`);
        if (students.has(s)) pairs.add(mk(s, c));
      } else if (kind === 2) {
        ops.push(`DELETE FROM enrollments WHERE student_id = ${s} AND course_id = ${c};`);
        pairs.delete(mk(s, c));
      } else {
        ops.push(`DELETE FROM students WHERE id = ${s};`);
        students.delete(s);
        for (const p of [...pairs]) if (p.startsWith(`${s}:`)) pairs.delete(p);
      }
    }
    return {
      prompt: 'Таблица enrollments(student_id, course_id) связывает студентов и курсы: первичный ключ - пара (student_id, course_id), внешний ключ на students объявлен с ON DELETE CASCADE. В начале существуют студенты 1-6. Вставка записи для несуществующего студента завершается ошибкой, и строка не появляется (ON CONFLICT DO NOTHING ошибку внешнего ключа не скрывает - выполнение продолжается со следующей команды). Сколько строк будет в enrollments после всех команд?',
      code: `в начале (student_id:course_id): ${start.join(', ') || 'пусто'}\n${ops.map((o, i) => `${i + 1}. ${o}`).join('\n')}`,
      answerHint: 'число строк',
      answerKey: String(pairs.size),
      explanation: `Повторная вставка той же пары ничего не меняет; удаление студента каскадом убирает его записи. Итог: ${[...pairs].join(', ') || 'пусто'} - ${pairs.size} строк.`,
      params: { start: start.join(','), ops: ops.length },
    };
  },
);

type Stmt = { sql: string; run: (s: TState) => boolean };
interface TState {
  phoneNulls: boolean;
  emailDup: boolean;
  phone: boolean;
  status: boolean;
  age: boolean;
}

const ALTER_POOL: Stmt[] = [
  { sql: 'ALTER TABLE users ADD COLUMN age int;', run: (s) => (s.age ? false : (s.age = true)) },
  { sql: 'ALTER TABLE users ADD COLUMN status text NOT NULL;', run: () => false },
  { sql: "ALTER TABLE users ADD COLUMN status text NOT NULL DEFAULT 'new';", run: (s) => (s.status ? false : (s.status = true)) },
  { sql: 'ALTER TABLE users ALTER COLUMN phone SET NOT NULL;', run: (s) => s.phone && !s.phoneNulls },
  { sql: 'ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);', run: (s) => !s.emailDup },
  { sql: "UPDATE users SET phone = '-' WHERE phone IS NULL;", run: (s) => (s.phone ? ((s.phoneNulls = false), true) : false) },
  { sql: 'ALTER TABLE users DROP COLUMN phone;', run: (s) => (s.phone ? ((s.phone = false), true) : false) },
  { sql: 'ALTER TABLE users ADD COLUMN phone text;', run: (s) => (s.phone ? false : ((s.phone = true), (s.phoneNulls = true), true)) },
];

export const dmAlterFails: TaskGenerator = fam(
  { slug: 'dm-alter-fails', title: 'Какие команды миграции упадут', sub: 'data-model', grade: 'junior', catalogIds: ['be.migrations', 'be.sql-schema'], format: 'list', a: 1.2, b: -0.5, paramSpace: 5e5, timeLimitSec: 210 },
  (seed) => {
    const rng = createRng(seed);
    const r = until(
      () => {
        const state: TState = { phoneNulls: rng.int(0, 1) === 1, emailDup: rng.int(0, 1) === 1, phone: true, status: false, age: rng.int(0, 3) === 0 };
        const init = { ...state };
        const picked = rng.sample(ALTER_POOL, 5);
        const failed: number[] = [];
        picked.forEach((st, i) => {
          if (!st.run(state)) failed.push(i + 1);
        });
        return { init, picked, failed };
      },
      (x) => x.failed.length >= 1 && x.failed.length <= 3,
    );
    const rows = [
      `(1, 'a@x.ru', ${r.init.phoneNulls ? 'NULL' : "'111'"})`,
      `(2, '${r.init.emailDup ? 'a@x.ru' : 'b@x.ru'}', '222')`,
      `(3, 'c@x.ru', '333')`,
    ];
    const info = `users(id, email, phone) - три строки: ${rows.join(', ')}${r.init.age ? '; колонка age уже есть' : ''}.`;
    return {
      prompt: 'Команды выполняются по очереди на PostgreSQL, каждая по отдельности (упавшая команда ничего не меняет, следующие всё равно запускаются). В таблице уже есть данные. Укажите номера команд, которые завершатся ошибкой.',
      code: `${info}\n${r.picked.map((s, i) => `${i + 1}. ${s.sql}`).join('\n')}`,
      answerHint: 'номера через запятую',
      answerKey: r.failed.join(','),
      explanation: 'Ошибки: NOT NULL без DEFAULT на непустой таблице, SET NOT NULL при NULL в данных, UNIQUE при дубликатах, повторное добавление существующей колонки, операции над удалённой колонкой. Предыдущие команды меняют состояние: UPDATE убирает NULL, DROP COLUMN убирает колонку.',
      params: { picked: r.picked.map((s) => s.sql.length).join(','), init: JSON.stringify(r.init) },
    };
  },
);

// ---------------------------------------------------------------------------
// Middle
// ---------------------------------------------------------------------------

const PLANS: { name: string; steps: string[]; decoys: string[] }[] = [
  {
    name: 'переименовать колонку phone в contact_phone без простоя',
    steps: ['добавить колонку contact_phone (NULL разрешён)', 'выкатить код, который пишет в обе колонки', 'скопировать старые значения порциями в contact_phone', 'выкатить код, который читает contact_phone', 'выкатить код, который перестал писать в phone', 'удалить колонку phone'],
    decoys: ['выполнить ALTER TABLE ... RENAME COLUMN одной командой в час пик', 'удалить phone до выкатки нового кода'],
  },
  {
    name: 'разбить колонку full_name на first_name и last_name без простоя',
    steps: ['добавить first_name и last_name (NULL разрешён)', 'выкатить код, который пишет и full_name, и новые колонки', 'заполнить новые колонки для старых строк порциями', 'выкатить код, который читает новые колонки', 'выкатить код, который перестал писать full_name', 'удалить full_name'],
    decoys: ['сначала удалить full_name, затем добавить новые колонки', 'добавить first_name как NOT NULL без значения по умолчанию'],
  },
  {
    name: 'сделать колонку email обязательной (NOT NULL) на живой таблице',
    steps: ['выкатить код, который всегда записывает email', 'заполнить email для старых строк порциями', 'добавить ограничение CHECK (email IS NOT NULL) как NOT VALID', 'проверить ограничение командой VALIDATE CONSTRAINT', 'установить SET NOT NULL'],
    decoys: ['выполнить SET NOT NULL сразу, пока в таблице есть NULL', 'заблокировать таблицу на время всей миграции'],
  },
  {
    name: 'перенести статус заказа из текстовой колонки в справочник order_statuses',
    steps: ['создать таблицу order_statuses и заполнить её', 'добавить в orders колонку status_id (NULL разрешён)', 'выкатить код, который пишет и status, и status_id', 'заполнить status_id для старых строк порциями', 'добавить внешний ключ как NOT VALID и проверить его', 'выкатить код, который читает status_id и перестал писать status'],
    decoys: ['добавить внешний ключ на status_id до заполнения справочника', 'удалить status до переключения чтения'],
  },
];

// Подстановки по сценариям: сначала длинные имена, чтобы «contact_phone» не ломался заменой «phone».
const RENAMES: [string, string][][][] = [
  [[['contact_phone', 'contact_phone'], ['phone', 'phone']], [['contact_phone', 'work_phone'], ['phone', 'tel']], [['contact_phone', 'postal_address'], ['phone', 'address']], [['contact_phone', 'display_name'], ['phone', 'nick']], [['contact_phone', 'home_city'], ['phone', 'city']]],
  [[['first_name', 'first_name'], ['last_name', 'last_name'], ['full_name', 'full_name']], [['first_name', 'street'], ['last_name', 'house'], ['full_name', 'address_line']], [['first_name', 'title_ru'], ['last_name', 'title_en'], ['full_name', 'title']]],
  [[['email', 'email']], [['email', 'phone']], [['email', 'passport_no']], [['email', 'inn']], [['email', 'country']]],
  [[['order_statuses', 'order_statuses'], ['status_id', 'status_id'], ['orders', 'orders'], ['status', 'status']], [['order_statuses', 'ticket_priorities'], ['status_id', 'priority_id'], ['orders', 'tickets'], ['status', 'priority']], [['order_statuses', 'delivery_types'], ['status_id', 'delivery_type_id'], ['orders', 'shipments'], ['status', 'delivery_type']]],
];

export const dmRenameOrder: TaskGenerator = fam(
  { slug: 'dm-expand-contract-order', title: 'Порядок шагов безопасной миграции', sub: 'data-model', grade: 'middle', catalogIds: ['be.migrations', 'be.sql-schema'], format: 'text', a: 1.3, b: 0.45, paramSpace: 5e4, timeLimitSec: 270 },
  (seed) => {
    const rng = createRng(seed);
    const pi = rng.int(0, PLANS.length - 1);
    const base = PLANS[pi]!;
    // Имена колонок и таблиц подставляются от seed: тексты шагов не повторяются между экземплярами.
    const names = RENAMES[pi]![rng.int(0, RENAMES[pi]!.length - 1)]!;
    const sw = (t: string) => {
      let out = t;
      names.forEach(([from], i) => (out = out.split(from).join(`\u0001${i}\u0001`)));
      names.forEach(([, to], i) => (out = out.split(`\u0001${i}\u0001`).join(to)));
      return out;
    };
    const plan = { name: sw(base.name), steps: base.steps.map(sw), decoys: base.decoys.map(sw) };
    const items = rng.shuffle([...plan.steps.map((text, order) => ({ text, order })), ...rng.sample(plan.decoys, rng.int(1, 2)).map((text) => ({ text, order: -1 }))]);
    const key = items
      .map((it, i) => ({ n: i + 1, order: it.order }))
      .filter((x) => x.order >= 0)
      .sort((p, q) => p.order - q.order)
      .map((x) => x.n);
    return {
      prompt: `Нужно ${plan.name}: приложение работает в несколько экземпляров, остановка недопустима, во время выкатки старый и новый код живут одновременно. Ниже шаги в произвольном порядке, среди них есть небезопасные (лишние). Укажите через запятую номера безопасных шагов в порядке выполнения; небезопасные не включайте.`,
      code: items.map((it, i) => `${i + 1}. ${it.text}`).join('\n'),
      answerHint: 'номера шагов через запятую',
      answerKey: key.join(','),
      explanation: 'Схема «расширить - перевести - сжать»: сначала добавляется новое (совместимое со старым кодом), код пишет в оба места, данные переносятся порциями, чтение переключается, старое перестаёт писаться и только потом удаляется. Небезопасные шаги ломают старый код или блокируют таблицу.',
      params: { plan: pi, names: names.map((n) => n[1]).join(','), key: key.join(',') },
    };
  },
);

export const dmBackfillTime: TaskGenerator = fam(
  { slug: 'dm-backfill-time', title: 'Сколько займёт перенос данных порциями', sub: 'data-model', grade: 'middle', catalogIds: ['be.migrations', 'be.performance'], format: 'number', a: 1.2, b: 0.35, paramSpace: 5e3, timeLimitSec: 210 },
  (seed) => {
    const rng = createRng(seed);
    const rows = rng.pick([500_000, 1_000_000, 2_000_000, 5_000_000]);
    const batch = rng.pick([5000, 10_000, 20_000, 50_000]);
    const tb = rng.pick([200, 400, 800]);
    const pause = rng.pick([50, 100, 200]);
    const done = rng.pick([0, 0, 100_000, 400_000]);
    const left = rows - done;
    const batches = Math.ceil(left / batch);
    const ms = batches * tb + (batches - 1) * pause;
    const sec = Math.ceil(ms / 1000);
    return {
      prompt: `В таблице ${rows.toLocaleString('ru-RU')} строк. Скрипт заполняет новую колонку порциями по ${batch.toLocaleString('ru-RU')} строк: каждая порция выполняется ${tb} мс, между порциями пауза ${pause} мс (после последней паузы нет). ${done ? `Скрипт уже обработал ${done.toLocaleString('ru-RU')} строк и перезапущен с места остановки.` : 'Скрипт запускается с начала.'} Сколько секунд он проработает до конца? Округлите вверх до целого.`,
      answerHint: 'секунды, округлить вверх',
      answerKey: String(sec),
      explanation: `Осталось ${left.toLocaleString('ru-RU')} строк = ${batches} порций; ${batches} × ${tb} + ${batches - 1} × ${pause} = ${ms} мс, ${sec} с.`,
      params: { rows, batch, tb, pause, done },
    };
  },
);

export const dmRowLockQueue: TaskGenerator = fam(
  { slug: 'dm-row-lock-queue', title: 'Ожидание блокировки строки', sub: 'data-model', grade: 'middle', catalogIds: ['be.transactions', 'be.concurrency'], format: 'number', a: 1.3, b: 0.5, paramSpace: 1e6, timeLimitSec: 240 },
  (seed) => {
    const rng = createRng(seed);
    const n = rng.int(4, 5);
    const txs = Array.from({ length: n }, () => ({ start: rng.int(0, 12) * 50, hold: rng.pick([100, 150, 200, 300]) })).sort((a, b) => a.start - b.start);
    let free = 0;
    const waits: number[] = [];
    const ends: number[] = [];
    for (const t of txs) {
      const got = Math.max(t.start, free);
      waits.push(got - t.start);
      free = got + t.hold;
      ends.push(free);
    }
    const target = rng.int(1, n - 1);
    return {
      prompt: `${n} транзакции обновляют одну и ту же строку (SELECT ... FOR UPDATE, затем работа, затем COMMIT). Транзакция берёт блокировку в момент старта, если строка свободна; иначе встаёт в очередь, блокировки (по упрощённой модели задачи) выдаются в порядке старта. Блокировка удерживается до коммита, то есть на указанное время работы с момента получения. Сколько миллисекунд ждёт блокировку транзакция №${target + 1}? Моменты и длительности даны в миллисекундах от начала.`,
      code: txs.map((t, i) => `T${i + 1}: старт ${t.start} мс, работа под блокировкой ${t.hold} мс`).join('\n'),
      answerHint: 'миллисекунды',
      answerKey: String(waits[target]),
      explanation: `Транзакции по порядку старта получают блокировку в моменты ${txs.map((t, i) => t.start + waits[i]!).join(', ')} мс; T${target + 1} ждёт ${waits[target]} мс.`,
      params: { n, target },
    };
  },
);

interface URow {
  email: string;
  deleted: boolean;
}

export const dmSoftDeleteUnique: TaskGenerator = fam(
  { slug: 'dm-soft-delete-unique', title: 'Мягкое удаление и уникальный индекс', sub: 'data-model', grade: 'middle', catalogIds: ['be.sql-schema', 'be.sql-indexes'], format: 'number', a: 1.2, b: 0.55, paramSpace: 1e6, timeLimitSec: 240 },
  (seed) => {
    const rng = createRng(seed);
    const partial = rng.int(0, 1) === 1;
    const emails = ['a@x.ru', 'b@x.ru', 'c@x.ru'];
    const rows: URow[] = [];
    const ops: string[] = [];
    let failed = 0;
    const violates = (e: string): boolean => (partial ? rows.some((r) => !r.deleted && r.email === e) : rows.some((r) => r.email === e));
    const kindsPool = rng.pick([['ins', 'ins', 'del', 'restore'], ['ins', 'del', 'del', 'restore'], ['ins', 'ins', 'ins', 'restore', 'del'], ['ins', 'del', 'restore', 'restore']]);
    for (let i = 0; i < 18; i++) {
      const e = rng.pick(emails);
      const kind = rng.pick(kindsPool);
      if (kind === 'ins') {
        ops.push(`INSERT INTO users (email) VALUES ('${e}');`);
        if (violates(e)) failed++;
        else rows.push({ email: e, deleted: false });
      } else if (kind === 'del') {
        ops.push(`UPDATE users SET deleted_at = now() WHERE email = '${e}' AND deleted_at IS NULL;`);
        for (const r of rows) if (r.email === e) r.deleted = true;
      } else {
        ops.push(`UPDATE users SET deleted_at = NULL WHERE email = '${e}' AND deleted_at IS NOT NULL;`);
        const deletedRows = rows.filter((r) => r.email === e && r.deleted);
        const hasActive = rows.some((r) => r.email === e && !r.deleted);
        // Восстановление нескольких удалённых строк с одним email или при наличии активной - нарушение (в частичном индексе);
        // в полном индексе дубликатов быть не может вовсе.
        if (partial && deletedRows.length > 0) {
          if (hasActive || deletedRows.length > 1) failed++;
          else deletedRows[0]!.deleted = false;
        } else if (!partial) {
          for (const r of deletedRows) r.deleted = false;
        }
      }
    }
    return {
      prompt: `Таблица users(email, deleted_at) с «мягким удалением». ${
        partial ? 'Уникальность обеспечивает частичный индекс: CREATE UNIQUE INDEX ON users (email) WHERE deleted_at IS NULL.' : 'Уникальность обеспечивает обычный индекс: CREATE UNIQUE INDEX ON users (email).'
      } Команды выполняются по порядку над пустой таблицей; команда, нарушившая уникальность, завершается ошибкой и ничего не меняет. Сколько команд завершится ошибкой?`,
      code: ops.map((o, i) => `${i + 1}. ${o}`).join('\n'),
      answerHint: 'число команд с ошибкой',
      answerKey: String(failed),
      explanation: partial ? 'Частичный индекс учитывает только активные строки: повторный email допустим, пока прежняя запись удалена; но восстановление при наличии активной записи с таким же email нарушает индекс.' : 'Обычный индекс учитывает и удалённые строки: повторный INSERT того же email падает независимо от deleted_at.',
      params: { partial, failed },
    };
  },
);

type Act = 'CASCADE' | 'SET NULL' | 'RESTRICT';

export const dmCascadeChain: TaskGenerator = fam(
  { slug: 'dm-cascade-chain', title: 'Цепочка внешних ключей при удалении', sub: 'data-model', grade: 'middle', catalogIds: ['be.sql-schema', 'be.transactions'], format: 'number', a: 1.2, b: 0.5, paramSpace: 1e5, timeLimitSec: 240 },
  (seed) => {
    const rng = createRng(seed);
    const actB = rng.pick<Act>(['CASCADE', 'CASCADE', 'SET NULL', 'RESTRICT']);
    const actC = rng.pick<Act>(['CASCADE', 'SET NULL', 'RESTRICT']);
    const aRows = 3;
    const b = Array.from({ length: rng.int(4, 9) }, (_, i) => ({ id: i + 1, a: rng.int(1, aRows) as number | null }));
    const c = Array.from({ length: rng.int(4, 10) }, (_, i) => ({ id: i + 1, b: rng.int(1, b.length) as number | null }));
    // Удаляем A с id=1
    const bAffected = b.filter((x) => x.a === 1);
    let fail = false;
    let bAfter = b.map((x) => ({ ...x }));
    let cAfter = c.map((x) => ({ ...x }));
    if (bAffected.length) {
      if (actB === 'RESTRICT') fail = true;
      else if (actB === 'SET NULL') bAfter = bAfter.map((x) => (x.a === 1 ? { ...x, a: null } : x));
      else {
        const gone = new Set(bAffected.map((x) => x.id));
        const children = c.filter((x) => x.b !== null && gone.has(x.b));
        if (children.length) {
          if (actC === 'RESTRICT') fail = true;
          else if (actC === 'SET NULL') cAfter = cAfter.map((x) => (x.b !== null && gone.has(x.b) ? { ...x, b: null } : x));
          else cAfter = cAfter.filter((x) => !(x.b !== null && gone.has(x.b)));
        }
        bAfter = bAfter.filter((x) => !gone.has(x.id));
      }
    }
    const total = fail ? aRows + b.length + c.length : aRows - 1 + bAfter.length + cAfter.length;
    return {
      prompt: `Три таблицы: a (строки 1-${aRows}), b с внешним ключом a_id -> a ON DELETE ${actB}, c с внешним ключом b_id -> b ON DELETE ${actC}. Выполняется DELETE FROM a WHERE id = 1; (одна команда: если любое правило RESTRICT сработало, вся команда отменяется и ничего не меняется). Сколько строк останется во всех трёх таблицах вместе?`,
      code: `b (id:a_id): ${b.map((x) => `${x.id}:${x.a}`).join(', ')}\nc (id:b_id): ${c.map((x) => `${x.id}:${x.b}`).join(', ')}`,
      answerHint: 'число строк во всех таблицах',
      answerKey: String(total),
      explanation: fail ? `Сработал RESTRICT: команда отменена, остаётся все ${total} строк.` : `Строка a удалена; в b осталось ${bAfter.length}, в c - ${cAfter.length}; всего ${total}.`,
      params: { actB, actC, nb: b.length, nc: c.length },
    };
  },
);

// ---------------------------------------------------------------------------
// Senior
// ---------------------------------------------------------------------------

type MigOp = { sql: string; secs: (rows: number) => number; note: string };

const RW = 50_000; // строк/с при перезаписи таблицы
const IDX = 100_000; // строк/с при построении индекса
const SCAN = 500_000; // строк/с при проверке ограничения

const MIG_POOL: MigOp[] = [
  { sql: "ADD COLUMN flag boolean NOT NULL DEFAULT false", secs: () => 0, note: 'константный DEFAULT: без перезаписи (PostgreSQL 11+)' },
  { sql: 'ADD COLUMN ref uuid NOT NULL DEFAULT gen_random_uuid()', secs: (r) => r / RW, note: 'волатильный DEFAULT: перезапись таблицы' },
  { sql: 'ALTER COLUMN amount TYPE bigint (из integer)', secs: (r) => r / RW, note: 'смена типа: перезапись таблицы' },
  { sql: 'CREATE INDEX idx_orders_user ON orders (user_id)', secs: (r) => r / IDX, note: 'обычный CREATE INDEX блокирует запись' },
  { sql: 'CREATE INDEX CONCURRENTLY idx_orders_date ON orders (created_at)', secs: () => 0, note: 'CONCURRENTLY не блокирует запись' },
  { sql: 'ADD FOREIGN KEY (user_id) REFERENCES users (id)', secs: (r) => r / SCAN, note: 'проверка существующих строк под блокировкой' },
  { sql: 'ADD FOREIGN KEY (user_id) REFERENCES users (id) NOT VALID', secs: () => 0, note: 'NOT VALID: без проверки старых строк' },
  { sql: 'ADD COLUMN note text', secs: () => 0, note: 'NULLable без DEFAULT: только метаданные' },
];

export const dmMigrationLocks: TaskGenerator = fam(
  { slug: 'dm-migration-lock-time', title: 'Сколько записи заблокированы миграцией', sub: 'data-model', grade: 'senior', catalogIds: ['be.migrations', 'be.sql-indexes', 'be.transactions'], format: 'number', a: 1.2, b: 1.2, paramSpace: 1e5, timeLimitSec: 300 },
  (seed) => {
    const rng = createRng(seed);
    const rows = rng.pick([1, 2, 3, 6]) * 1_000_000;
    const picked = rng.sample(MIG_POOL, 5);
    const total = picked.reduce((s, m) => s + m.secs(rows), 0);
    return {
      prompt: `Таблица orders содержит ${(rows / 1e6).toString()} млн строк. Миграция выполняет команды ниже по очереди (ALTER TABLE orders ..., если не указано иное). Считайте, что запись в таблицу блокируется на всё время тех операций, которые перезаписывают таблицу (${RW.toLocaleString('ru-RU')} строк/с), строят индекс без CONCURRENTLY (${IDX.toLocaleString('ru-RU')} строк/с) или проверяют существующие строки при добавлении ограничения (${SCAN.toLocaleString('ru-RU')} строк/с); операции только над метаданными и CONCURRENTLY запись не блокируют. Сколько секунд в сумме запись будет заблокирована?`,
      code: picked.map((m, i) => `${i + 1}. ${m.sql}`).join('\n'),
      answerHint: 'секунды',
      answerKey: String(total),
      explanation: picked.map((m, i) => `${i + 1}: ${m.secs(rows)} с (${m.note})`).join('; ') + `. Итого ${total} с.`,
      params: { rows, picked: picked.map((m) => m.sql.length).join(',') },
    };
  },
);

export const dmAutovacuumRuns: TaskGenerator = fam(
  { slug: 'dm-autovacuum-runs', title: 'Сколько раз сработает автовакуум', sub: 'data-model', grade: 'senior', catalogIds: ['be.sql-schema', 'be.performance'], format: 'number', a: 1.1, b: 1.25, paramSpace: 1e4, timeLimitSec: 270 },
  (seed) => {
    const rng = createRng(seed);
    const rows = rng.pick([100_000, 200_000, 500_000, 1_000_000]);
    const scale = rng.pick([0.2, 0.1, 0.05]);
    const thr = 50;
    const limit = thr + scale * rows;
    const updates = rng.pick([40_000, 100_000, 250_000, 600_000, 1_000_000]);
    const deletes = rng.pick([0, 0, 20_000, 50_000]);
    const dead = updates + deletes;
    const runs = Math.floor(dead / (limit + 1));
    return {
      prompt: `В таблице ${rows.toLocaleString('ru-RU')} живых строк (число не меняется). Автовакуум запускается, когда число мёртвых версий строк превышает autovacuum_vacuum_threshold (${thr}) + autovacuum_vacuum_scale_factor (${scale}) × число строк, и после запуска полностью очищает мёртвые версии (считайте, что очистка мгновенна). Каждый UPDATE оставляет одну мёртвую версию строки (HOT-обновлений нет), каждый DELETE - одну. За период выполнено ${updates.toLocaleString('ru-RU')} UPDATE${deletes ? ` и ${deletes.toLocaleString('ru-RU')} DELETE (с компенсирующими вставками, число живых строк прежнее)` : ''}. Сколько раз сработает автовакуум?`,
      answerHint: 'число запусков',
      answerKey: String(runs),
      explanation: `Порог: ${thr} + ${scale} × ${rows} = ${limit}; запуск при превышении, то есть на ${limit + 1}-й мёртвой версии. Мёртвых версий ${dead}: ${dead} / ${limit + 1} с округлением вниз = ${runs}.`,
      params: { rows, scale, updates, deletes },
    };
  },
);

export const dmOptimisticAttempts: TaskGenerator = fam(
  { slug: 'dm-optimistic-attempts', title: 'Цена оптимистичной блокировки при конкуренции', sub: 'data-model', grade: 'senior', catalogIds: ['be.concurrency', 'be.transactions'], format: 'number', a: 1.2, b: 1.15, paramSpace: 1e4, timeLimitSec: 270 },
  (seed) => {
    const rng = createRng(seed);
    const workers = rng.int(3, 5);
    const need = Array.from({ length: workers }, () => rng.int(1, 3));
    const left = [...need];
    let attempts = 0;
    let rounds = 0;
    for (;;) {
      const active = left.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
      if (!active.length) break;
      attempts += active.length;
      left[active[0]!]!--;
      rounds++;
    }
    const failed = attempts - need.reduce((s, x) => s + x, 0);
    return {
      prompt: `${workers} воркеров увеличивают один и тот же счётчик через UPDATE counters SET value = value + 1, version = version + 1 WHERE id = 1 AND version = :прочитанная. Нужное число успешных обновлений у каждого воркера указано ниже. Раунд: все ещё не закончившие воркеры читают текущую версию и одновременно выполняют UPDATE; успешно проходит ровно один (с наименьшим номером), остальные получают 0 строк и в следующем раунде читают и пробуют заново. Сколько UPDATE вернут 0 строк за всё время?`,
      code: need.map((n, i) => `воркер ${i + 1}: нужно обновлений ${n}`).join('\n'),
      answerHint: 'число неудачных UPDATE',
      answerKey: String(failed),
      explanation: `Раундов ${rounds}, всего попыток ${attempts}, успешных ${need.reduce((s, x) => s + x, 0)}; неудачных ${failed}. Число попыток растёт квадратично от числа конкурентов.`,
      params: { need: need.join(',') },
    };
  },
);

export const dmTransferCrash: TaskGenerator = fam(
  { slug: 'dm-transfer-crash', title: 'Баланс после сбоев при переводах', sub: 'data-model', grade: 'senior', catalogIds: ['be.transactions', 'be.sql-schema', 'be.distributed-consistency'], format: 'number', a: 1.1, b: 1.3, paramSpace: 1e6, timeLimitSec: 300 },
  (seed) => {
    const rng = createRng(seed);
    const useTx = rng.int(0, 1) === 1;
    const bal: Record<string, number> = { A: rng.pick([100, 200]), B: rng.pick([50, 100]), C: rng.pick([0, 50]) };
    const names = ['A', 'B', 'C'];
    const initial = { ...bal };
    const transfers = Array.from({ length: 5 }, () => {
      const from = rng.pick(names);
      const to = rng.pick(names.filter((n) => n !== from));
      return { from, to, amount: rng.pick([20, 50, 80, 120]), crash: rng.int(0, 3) === 0 };
    });
    for (const t of transfers) {
      if (bal[t.from]! < t.amount) continue; // CHECK (balance >= 0) не даёт списать
      if (useTx) {
        if (t.crash) continue; // откат всей транзакции
        bal[t.from]! -= t.amount;
        bal[t.to]! += t.amount;
      } else {
        bal[t.from]! -= t.amount;
        if (!t.crash) bal[t.to]! += t.amount;
      }
    }
    const who = rng.pick(names);
    return {
      prompt: `Счета A, B, C с начальными балансами ${names.map((n) => `${n}=${initial[n]}`).join(', ')}; на колонке баланса есть CHECK (balance >= 0), списание при нехватке средств завершается ошибкой, и перевод целиком пропускается (кредитовая часть не выполняется). Перевод - это два UPDATE: списание у отправителя, затем зачисление получателю. ${
        useTx ? 'Оба UPDATE выполняются в одной транзакции.' : 'UPDATE выполняются отдельными командами без общей транзакции.'
      } У переводов с пометкой «сбой» процесс падает между двумя UPDATE и больше не возвращается к этому переводу. Переводы идут по порядку. Каков итоговый баланс счёта ${who}?`,
      code: transfers.map((t, i) => `${i + 1}. ${t.from} -> ${t.to}, ${t.amount}${t.crash ? ' (сбой между UPDATE)' : ''}`).join('\n'),
      answerHint: `баланс счёта ${who}`,
      answerKey: String(bal[who]),
      explanation: useTx ? 'В транзакции перевод со сбоем откатывается целиком, деньги не теряются.' : 'Без транзакции после сбоя списание остаётся, а зачисления нет: деньги пропадают. Переводы при нехватке средств пропускаются целиком.',
      params: { useTx, who, n: transfers.length },
    };
  },
);

export const DATAMODEL_BANK2: TaskGenerator[] = [
  dmMigrationsPending,
  dmJunctionRows,
  dmAlterFails,
  dmRenameOrder,
  dmBackfillTime,
  dmRowLockQueue,
  dmSoftDeleteUnique,
  dmCascadeChain,
  dmMigrationLocks,
  dmAutovacuumRuns,
  dmOptimisticAttempts,
  dmTransferCrash,
];
