// Банк-2 backend.highload: +3 Junior, +5 Middle, +4 Senior. Пробел: профилирование CPU/IO ниже Senior.
// Ответ считает код (R-T-02); a, b — ПРЕДЛОЖЕНИЕ (экспертные).
import { createRng } from '../rng';
import type { TaskGenerator } from '../types';
import { fam, notHalf, until } from './backend-bank2-util';

const FUNCS = ['parseJson', 'renderTemplate', 'hashPassword', 'serialize', 'compress', 'validate', 'regexMatch', 'sortItems', 'formatDate', 'encodeBase64'];

// ---------------------------------------------------------------------------
// Junior
// ---------------------------------------------------------------------------

export const hlProfileShare: TaskGenerator = fam(
  { slug: 'hl-profile-share', title: 'Сколько CPU уходит на функцию по профилю', sub: 'highload', grade: 'junior', catalogIds: ['be.performance', 'be.observability'], format: 'number', a: 1.2, b: -0.7, paramSpace: 1e5, timeLimitSec: 180 },
  (seed) => {
    const rng = createRng(seed);
    const names = rng.sample(FUNCS, 5);
    const total = rng.pick([500, 1000, 2000]);
    const interval = rng.pick([5, 10, 20]);
    const shares = [rng.int(30, 50), rng.int(15, 25), rng.int(8, 14), rng.int(5, 8)];
    shares.push(100 - shares.reduce((s, x) => s + x, 0));
    const samples = shares.map((s) => (s * total) / 100);
    const target = rng.int(0, 4);
    const kind = rng.int(0, 1);
    const ms = samples[target]! * interval;
    return {
      prompt: `CPU-профилировщик снимает стек каждые ${interval} мс и сохранил ${total} сэмплов за время работы. Плоский профиль (self-время: сэмплы, где функция была на вершине стека) показан ниже. ${
        kind === 0 ? `Сколько процентов CPU-времени приходится на ${names[target]}?` : `Сколько миллисекунд CPU-времени потрачено в ${names[target]} за всё время профилирования?`
      }`,
      code: names.map((n, i) => `${n}: ${samples[i]} сэмплов`).join('\n'),
      answerHint: kind === 0 ? 'процент' : 'миллисекунды',
      answerKey: String(kind === 0 ? shares[target] : ms),
      explanation: kind === 0 ? `${samples[target]} из ${total} сэмплов = ${shares[target]}%.` : `${samples[target]} сэмплов × ${interval} мс = ${ms} мс.`,
      params: { total, interval, target, kind },
    };
  },
);

export const hlParallelCalls: TaskGenerator = fam(
  { slug: 'hl-parallel-calls', title: 'Задержка после распараллеливания вызовов', sub: 'highload', grade: 'junior', catalogIds: ['be.performance', 'be.external-integration'], format: 'number', a: 1.2, b: -0.9, paramSpace: 1e5, timeLimitSec: 180 },
  (seed) => {
    const rng = createRng(seed);
    const cpu1 = rng.pick([5, 10, 15]);
    const a = rng.pick([30, 40, 60, 80, 120]);
    let b = rng.pick([20, 50, 70, 100]);
    if (b === a) b += 10;
    const c = rng.pick([25, 35, 45]);
    const cpu2 = rng.pick([5, 10, 20]);
    const before = cpu1 + a + b + c + cpu2;
    const after = cpu1 + Math.max(a, b) + c + cpu2;
    return {
      prompt: `Обработчик сейчас делает всё последовательно: разбор запроса (CPU ${cpu1} мс), вызов сервиса рейтингов (${a} мс), вызов сервиса скидок (${b} мс), запрос в БД, которому нужны результаты обоих вызовов (${c} мс), формирование ответа (CPU ${cpu2} мс). Вызовы рейтингов и скидок друг от друга не зависят, и их решили выполнять одновременно. Какой станет задержка запроса в миллисекундах (сейчас ${before} мс)?`,
      answerHint: 'миллисекунды',
      answerKey: String(after),
      explanation: `Независимые вызовы занимают max(${a}, ${b}) = ${Math.max(a, b)} мс вместо ${a + b}; остальное без изменений: ${cpu1} + ${Math.max(a, b)} + ${c} + ${cpu2} = ${after} мс.`,
      params: { cpu1, a, b, c, cpu2 },
    };
  },
);

export const hlBandwidth: TaskGenerator = fam(
  { slug: 'hl-bandwidth', title: 'Какой канал нужен под ответы', sub: 'highload', grade: 'junior', catalogIds: ['be.performance'], format: 'number', a: 1.1, b: -1.0, paramSpace: 2e3, timeLimitSec: 150 },
  (seed) => {
    const rng = createRng(seed);
    const size = rng.pick([50, 100, 200, 250, 500]);
    const rps = rng.pick([100, 200, 400, 500, 1000]);
    const saved = rng.pick([0, 50, 60, 80]);
    const mbit = (size * rps * 8 * (100 - saved)) / 100 / 1000;
    return {
      prompt: `Эндпоинт отдаёт ответ размером ${size} КБ (1 КБ = 1000 байт) с интенсивностью ${rps} запросов/с. ${saved ? `Включено сжатие, оно уменьшает размер ответа на ${saved}%.` : 'Сжатие не используется.'} Сколько мегабит в секунду исходящего трафика создаёт эндпоинт (1 байт = 8 бит, 1 Мбит = 1000 Кбит)?`,
      answerHint: 'Мбит/с',
      answerKey: String(mbit),
      explanation: `${size} КБ × ${rps} = ${size * rps} КБ/с; × 8 = ${size * rps * 8} Кбит/с${saved ? `; после сжатия ×${(100 - saved) / 100}` : ''}; в Мбит/с: ${mbit}.`,
      params: { size, rps, saved },
    };
  },
);

// ---------------------------------------------------------------------------
// Middle
// ---------------------------------------------------------------------------

export const hlFlameOptimize: TaskGenerator = fam(
  { slug: 'hl-flame-optimize', title: 'Выигрыш от ускорения функции в профиле', sub: 'highload', grade: 'middle', catalogIds: ['be.performance', 'be.observability'], format: 'number', a: 1.3, b: 0.4, paramSpace: 1e6, timeLimitSec: 240 },
  (seed) => {
    const rng = createRng(seed);
    const names = rng.sample(FUNCS, 5);
    const nodes = names.map((name, i) => ({ name, self: rng.pick([4, 8, 12, 16, 20, 24]), calls: i === 0 ? 1 : rng.int(1, 5) }));
    const x = rng.int(1, 4);
    const k = rng.pick([2, 4]);
    const base = nodes.reduce((s, n) => s + n.self * n.calls, 0);
    const spent = nodes[x]!.self * nodes[x]!.calls;
    const answer = base - spent + spent / k;
    return {
      prompt: `Профиль одного запроса: у каждой функции указаны время одного вызова (self, без учёта вложенных) и число вызовов за запрос. Функцию ${nodes[x]!.name} переписали так, что один её вызов стал быстрее в ${k} раза(раз). Сколько миллисекунд займёт запрос после этого?`,
      code: nodes.map((n) => `${n.name}: self ${n.self} мс × ${n.calls} вызов(ов)`).join('\n'),
      answerHint: 'миллисекунды',
      answerKey: String(answer),
      explanation: `Сейчас запрос занимает ${base} мс; ${nodes[x]!.name} даёт ${spent} мс, после ускорения ${spent / k} мс; итог ${base} - ${spent} + ${spent / k} = ${answer}.`,
      params: { x, k, base },
    };
  },
);

export const hlThreadPool: TaskGenerator = fam(
  { slug: 'hl-thread-pool', title: 'Размер пула потоков для I/O-нагрузки', sub: 'highload', grade: 'middle', catalogIds: ['be.performance', 'be.concurrency'], format: 'number', a: 1.2, b: 0.5, paramSpace: 1e4, timeLimitSec: 240 },
  (seed) => {
    const rng = createRng(seed);
    const cores = rng.pick([2, 4, 8]);
    const cpu = rng.pick([5, 10, 20]);
    const wait = cpu * rng.pick([3, 4, 9, 19]);
    const kind = rng.int(0, 1);
    if (kind === 0) {
      const n = Math.ceil(cores * (1 + wait / cpu));
      return {
        prompt: `Запрос обрабатывается одним потоком: ${cpu} мс работы процессора и ${wait} мс ожидания ввода-вывода (поток при этом простаивает). На сервере ${cores} ядер. Какое минимальное число потоков в пуле нужно, чтобы все ядра были загружены полностью?`,
        answerHint: 'число потоков',
        answerKey: String(n),
        explanation: `Один поток занимает ядро ${cpu} из ${cpu + wait} мс. Чтобы загрузить ${cores} ядер, нужно ${cores} × (${cpu} + ${wait}) / ${cpu} = ${n} потоков.`,
        params: { cores, cpu, wait, kind },
      };
    }
    const threads = rng.pick([4, 8, 16, 32, 64]);
    const byThreads = (threads * 1000) / (cpu + wait);
    const byCpu = (cores * 1000) / cpu;
    const tput = until(() => Math.min(byThreads, byCpu), () => true);
    const ans = Math.round(tput);
    return {
      prompt: `Запрос обрабатывается одним потоком: ${cpu} мс процессора и ${wait} мс ожидания ввода-вывода. На сервере ${cores} ядер, пул - ${threads} потоков. Какую максимальную пропускную способность (запросов в секунду, округлите до целого) даст сервис?`,
      answerHint: 'запросов в секунду',
      answerKey: String(ans),
      explanation: `Ограничение потоками: ${threads} × 1000 / ${cpu + wait} = ${byThreads.toFixed(1)}; ограничение процессором: ${cores} × 1000 / ${cpu} = ${byCpu.toFixed(1)}. Меньшее - ${tput.toFixed(1)}, то есть ${ans}.`,
      params: { cores, cpu, wait, threads, kind },
    };
  },
);

export const hlHitRatio: TaskGenerator = fam(
  { slug: 'hl-hit-ratio', title: 'Какой hit ratio нужен кэшу', sub: 'highload', grade: 'middle', catalogIds: ['be.cache', 'be.performance'], format: 'number', a: 1.2, b: 0.35, paramSpace: 1e4, timeLimitSec: 210 },
  (seed) => {
    const rng = createRng(seed);
    const tc = rng.pick([1, 2, 5]);
    const tdb = rng.pick([40, 50, 80, 100]);
    const target = rng.pick([10, 15, 20, 25, 30]);
    const h = (tdb - target) / (tdb - tc);
    const need = Math.ceil(h * 100 - 1e-9);
    return {
      prompt: `Чтение из кэша занимает ${tc} мс, чтение из БД (при промахе) - ${tdb} мс (время проверки кэша при промахе не учитываем). Нужно, чтобы средняя задержка чтения была не больше ${target} мс. Какой минимальный целый процент попаданий в кэш (hit ratio) для этого нужен?`,
      answerHint: 'процент, целое',
      answerKey: String(need),
      explanation: `h·${tc} + (1 - h)·${tdb} ≤ ${target} => h ≥ (${tdb} - ${target}) / (${tdb} - ${tc}) = ${(h * 100).toFixed(2)}%; минимальное целое - ${need}.`,
      params: { tc, tdb, target },
    };
  },
);

export const hlBackgroundWorkers: TaskGenerator = fam(
  { slug: 'hl-background-workers', title: 'Сколько воркеров для фоновой обработки', sub: 'highload', grade: 'middle', catalogIds: ['be.background-jobs', 'be.performance', 'be.concurrency'], format: 'number', a: 1.2, b: 0.5, paramSpace: 1e4, timeLimitSec: 240 },
  (seed) => {
    const rng = createRng(seed);
    const rps = rng.pick([20, 30, 40, 60, 100]);
    const bg = rng.pick([200, 400, 500, 800, 1000]);
    const util = rng.pick([50, 60, 80]);
    const need = Math.ceil((rps * bg * 100) / (1000 * util) - 1e-9);
    return {
      prompt: `Тяжёлую часть обработки (${bg} мс на запрос) вынесли из HTTP-обработчика в фоновые задачи; обработчик теперь только кладёт задачу в очередь. Поступает ${rps} запросов/с. Воркер обрабатывает по одной задаче за раз. Чтобы очередь не росла и оставался запас, средняя загрузка воркера не должна превышать ${util}%. Сколько воркеров нужно как минимум?`,
      answerHint: 'число воркеров',
      answerKey: String(need),
      explanation: `Средняя занятость: ${rps} × ${bg}/1000 = ${(rps * bg) / 1000} воркеров; делим на допустимую загрузку ${util}% и округляем вверх: ${need}.`,
      params: { rps, bg, util },
    };
  },
);

export const hlDiskIops: TaskGenerator = fam(
  { slug: 'hl-disk-iops', title: 'Сколько дисковых операций создаёт запрос', sub: 'highload', grade: 'middle', catalogIds: ['be.performance', 'be.sql-indexes'], format: 'number', a: 1.2, b: 0.45, paramSpace: 1e4, timeLimitSec: 240 },
  (seed) => {
    const rng = createRng(seed);
    const qps = rng.pick([1000, 2000, 4000, 8000, 12000, 20000]);
    const pages = rng.pick([4, 6, 10, 12]);
    const hit = rng.pick([80, 90, 95, 98]);
    const perDisk = rng.pick([300, 500, 800, 1000]);
    const reads = (qps * pages * (100 - hit)) / 100;
    const disks = Math.max(1, Math.ceil(reads / perDisk - 1e-9));
    return {
      prompt: `Каждый запрос к БД читает ${pages} страниц. Доля страниц, найденных в буферном кэше, - ${hit}%; остальные читаются с диска (одна страница - одна операция чтения). Нагрузка - ${qps} запросов/с. Один диск выдерживает ${perDisk} операций чтения в секунду. Какое минимальное число дисков понадобится для чтения?`,
      answerHint: 'число дисков',
      answerKey: String(disks),
      explanation: `С диска читается ${qps} × ${pages} × ${(100 - hit) / 100} = ${reads} страниц/с; ${reads} / ${perDisk} округляем вверх (минимум один диск): ${disks}.`,
      params: { qps, pages, hit, perDisk },
    };
  },
);

// ---------------------------------------------------------------------------
// Senior
// ---------------------------------------------------------------------------

export const hlAmdahl: TaskGenerator = fam(
  { slug: 'hl-amdahl', title: 'Предел ускорения при распараллеливании', sub: 'highload', grade: 'senior', catalogIds: ['be.performance', 'be.concurrency', 'common.algo-complexity'], format: 'number', a: 1.1, b: 1.05, paramSpace: 1e3, timeLimitSec: 240 },
  (seed) => {
    const rng = createRng(seed);
    const p = rng.pick([50, 75, 80, 90, 95]);
    const kind = rng.int(0, 1);
    if (kind === 0) {
      const limit = Math.round(100 / (100 - p));
      return {
        prompt: `Пакетная обработка выполняется ${p}% времени параллельной работой, остальные ${100 - p}% - строго последовательны (чтение конфигурации, слияние результатов). Во сколько раз можно ускорить задачу при неограниченном числе ядер (закон Амдала)? Ответ - целое число.`,
        answerHint: 'во сколько раз',
        answerKey: String(limit),
        explanation: `Предел ускорения - 1 / (1 - ${p / 100}) = ${limit}: последовательная часть остаётся при любом числе ядер.`,
        params: { p, kind },
      };
    }
    const r = until(
      () => {
        const T = rng.pick([100, 200, 400, 800]);
        const k = rng.pick([2, 4, 5, 8, 10, 16]);
        return { T, k, v: T * ((100 - p) / 100 + p / 100 / k) };
      },
      (x) => notHalf(x.v),
    );
    const ans = Math.round(r.v);
    return {
      prompt: `Задача на одном ядре работает ${r.T} с; ${p}% этого времени можно распараллелить идеально, остальное - последовательно. Сколько секунд займёт задача на ${r.k} ядрах? Округлите до целого.`,
      answerHint: 'секунды, целое',
      answerKey: String(ans),
      explanation: `T·((1 - ${p / 100}) + ${p / 100}/${r.k}) = ${r.v.toFixed(2)} с, округляем до ${ans}.`,
      params: { p, T: r.T, k: r.k, kind },
    };
  },
);

export const hlQueueLatency: TaskGenerator = fam(
  { slug: 'hl-mm1-latency', title: 'Время ответа при росте загрузки', sub: 'highload', grade: 'senior', catalogIds: ['be.performance', 'be.concurrency'], format: 'number', a: 1.2, b: 1.3, paramSpace: 1e3, timeLimitSec: 270 },
  (seed) => {
    const rng = createRng(seed);
    const r = until(
      () => {
        const s = rng.pick([20, 25, 30, 40, 50, 60]);
        const lam = rng.int(8, 40);
        const rho = (lam * s) / 1000;
        return { s, lam, rho, w: s / (1 - rho) };
      },
      (x) => x.rho >= 0.4 && x.rho <= 0.92 && notHalf(x.w),
      200,
    );
    const w = Math.round(r.w);
    return {
      prompt: `Экземпляр сервиса обрабатывает запросы по одному, обработка занимает ${r.s} мс. Запросы приходят случайно (пуассоновский поток) со средней интенсивностью ${r.lam} запросов/с на экземпляр, время обработки случайное с экспоненциальным распределением (модель M/M/1: среднее время пребывания в системе = S / (1 - ρ), ρ - загрузка). Каково среднее время ответа с учётом ожидания в очереди, в миллисекундах? Округлите до целого.`,
      answerHint: 'миллисекунды, целое',
      answerKey: String(w),
      explanation: `ρ = ${r.lam} × ${r.s}/1000 = ${r.rho.toFixed(3)}; время = ${r.s} / (1 - ${r.rho.toFixed(3)}) = ${r.w.toFixed(1)} мс, округляем до ${w}. Рост загрузки к 100% растит время ответа нелинейно.`,
      params: { s: r.s, lam: r.lam },
    };
  },
);

export const hlConnBudget: TaskGenerator = fam(
  { slug: 'hl-conn-budget', title: 'Бюджет соединений БД при выкатке', sub: 'highload', grade: 'senior', catalogIds: ['be.performance', 'be.concurrency'], format: 'number', a: 1.1, b: 1.1, paramSpace: 1e4, timeLimitSec: 270 },
  (seed) => {
    const rng = createRng(seed);
    const maxConn = rng.pick([200, 300, 500]);
    const reserved = rng.pick([20, 30, 40]);
    const web = rng.pick([8, 10, 20]);
    const bg = rng.pick([2, 5, 10]);
    const surge = rng.pick([1, 2, 3]);
    const perInst = web + bg;
    const fit = Math.floor((maxConn - reserved) / perInst);
    const n = fit - surge;
    return {
      prompt: `PostgreSQL допускает max_connections = ${maxConn}; ${reserved} соединений зарезервировано под администрирование, репликацию и миграции. Каждый экземпляр приложения держит пул веб-запросов из ${web} соединений и отдельный пул фоновых задач из ${bg}. При плановой выкатке в течение нескольких минут одновременно работают штатные экземпляры и ещё ${surge} новых (maxSurge). Какое максимальное штатное число экземпляров можно держать, чтобы во время выкатки соединений хватило?`,
      answerHint: 'число экземпляров',
      answerKey: String(n),
      explanation: `Доступно ${maxConn} - ${reserved} = ${maxConn - reserved}; на экземпляр ${perInst}; помещается ${fit} экземпляров одновременно; из них ${surge} - запас на выкатку: ${n}.`,
      params: { maxConn, reserved, web, bg, surge },
    };
  },
);

export const hlCpuVsWall: TaskGenerator = fam(
  { slug: 'hl-cpu-vs-wall', title: 'CPU-профиль и реальное время запроса', sub: 'highload', grade: 'senior', catalogIds: ['be.performance', 'be.observability'], format: 'number', a: 1.2, b: 1.2, paramSpace: 1e4, timeLimitSec: 270 },
  (seed) => {
    const rng = createRng(seed);
    const r = until(
      () => {
        const wall = rng.pick([200, 300, 400, 500]);
        const cpu = rng.pick([40, 60, 80, 100]);
        const f = rng.pick([25, 40, 50, 60, 75]);
        const k = rng.pick([2, 4, 5]);
        const fn = (cpu * f) / 100;
        return { wall, cpu, f, k, fn };
      },
      (x) => Number.isInteger(x.fn) && Number.isInteger(x.fn / x.k),
      200,
    );
    const fname = rng.pick(FUNCS);
    const after = r.wall - r.fn + r.fn / r.k;
    return {
      prompt: `Запрос в среднем занимает ${r.wall} мс по часам, из них на процессоре - ${r.cpu} мс, остальное - ожидание БД и сети. CPU-профиль показывает, что функция ${fname} занимает ${r.f}% CPU-времени запроса. Функцию ускорили в ${r.k} раза(раз) (ожидание ввода-вывода не изменилось, пересечений по времени нет). Каким станет среднее время запроса по часам, в мс?`,
      answerHint: 'миллисекунды',
      answerKey: String(after),
      explanation: `${fname} занимает ${r.f}% от ${r.cpu} = ${r.fn} мс, а не процент от ${r.wall} мс. После ускорения ${r.fn / r.k} мс; итог ${r.wall} - ${r.fn} + ${r.fn / r.k} = ${after}. CPU-профиль не видит время ожидания.`,
      params: { wall: r.wall, cpu: r.cpu, f: r.f, k: r.k },
    };
  },
);

export const HIGHLOAD_BANK2: TaskGenerator[] = [
  hlProfileShare,
  hlParallelCalls,
  hlBandwidth,
  hlFlameOptimize,
  hlThreadPool,
  hlHitRatio,
  hlBackgroundWorkers,
  hlDiskIops,
  hlAmdahl,
  hlQueueLatency,
  hlConnBudget,
  hlCpuVsWall,
];
