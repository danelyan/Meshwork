// Senior-задания AI (ADR 0003, дополнение 10.10 16:15): по 4 на подкатегорию. Проектные решения, компромиссы,
// диагностика по неполным данным, границы применимости – но ответ по-прежнему считает код (R-T-02): выбор
// варианта под ограничения, расчёт ёмкости и бюджета, поиск причины в логе. b 1,0…1,7, a 1,0…1,4 – ПРЕДЛОЖЕНИЕ,
// проверено персонами на подкатегорию (eval/test/subcategory-personas.ts).
import { createRng, type Rng } from '../rng';
import type { TaskGenerator, TaskInstance } from '../types';

import { num, table } from './ai-util';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

/** Варианты с буквами в порядке, перемешанном от seed: ответ-буква не угадывается позицией. */
function lettered<T>(rng: Rng, items: T[]): { label: string; item: T }[] {
  return rng.shuffle(items).map((item, i) => ({ label: LETTERS[i]!, item }));
}

const ceil = Math.ceil;

// ===========================================================================
// ai.llm-apps
// ===========================================================================

/** Выбор конфигурации RAG под SLA и бюджет. */
export const ragDesignChoice: TaskGenerator = {
  id: 'ai.rag-design-choice',
  taskId: 'task:rag-design',
  title: 'Какую конфигурацию RAG выкатывать',
  specialization: 'ai',
  subcategoryId: 'ai.llm-apps',
  grade: 'senior',
  catalogIds: ['ai.rag', 'ai.llm-eval', 'ai.llm-cost'],
  format: 'text',
  a: 1.4,
  b: 1.2,
  paramSpace: 1e8,
  timeLimitSec: 300,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    for (;;) {
      const qpd = rng.pick([20000, 50000, 100000]);
      const slaMs = rng.pick([1200, 1500, 2000]);
      const budget = rng.pick([300, 500, 800]) * 1000; // ₽ в месяц
      const configs = Array.from({ length: 4 }, () => {
        const k = rng.pick([3, 5, 8, 12]);
        const rerank = rng.next() < 0.5;
        const recall = Math.min(0.97, 0.55 + k * 0.025 + (rerank ? 0.08 : 0) + rng.int(-4, 4) / 100);
        const p95 = 600 + k * 40 + (rerank ? 350 : 0) + rng.int(-10, 10) * 10;
        // Стоимость запроса, коп.: токены контекста растут с k, реранкер добавляет фикс.
        const kopecks = 4 + k * 1.5 + (rerank ? 3 : 0);
        return { k, rerank, recall: Number(recall.toFixed(2)), p95, kopecks };
      });
      const monthly = (c: (typeof configs)[number]) => (qpd * 30 * c.kopecks) / 100;
      const ok = configs.filter((c) => c.p95 <= slaMs && monthly(c) <= budget);
      if (ok.length === 0 || ok.length === configs.length) continue;
      ok.sort((a, b) => b.recall - a.recall);
      if (ok.length > 1 && ok[0]!.recall === ok[1]!.recall) continue;
      // Ловушка: лучший recall вообще не проходит по SLA или бюджету.
      const best = [...configs].sort((a, b) => b.recall - a.recall)[0]!;
      if (best === ok[0] && rng.next() < 0.7) continue;
      const opts = lettered(rng, configs);
      const answer = opts.find((o) => o.item === ok[0])!.label;
      return {
        prompt: `Ассистент по базе знаний: ${qpd.toLocaleString('ru-RU')} запросов в день. Требования: p95 латентности ≤ ${slaMs} мс и расходы на LLM ≤ ${budget.toLocaleString('ru-RU')} ₽ в месяц (30 дней). Из конфигураций, прошедших оба ограничения, выбирают максимальный recall@k на размеченном наборе. Какую выкатывать?`,
        code: table(
          ['вариант', 'top-k', 'реранкер', 'recall@k', 'p95, мс', 'коп./запрос'],
          opts.map((o) => [o.label, o.item.k, o.item.rerank ? 'да' : 'нет', o.item.recall.toFixed(2), o.item.p95, num(o.item.kopecks)]),
        ),
        answerHint: 'буква варианта',
        answerKey: answer,
        explanation: opts
          .map((o) => `${o.label}: ${num(monthly(o.item))} ₽/мес, p95 ${o.item.p95}${o.item.p95 > slaMs ? ' > SLA' : ''}${monthly(o.item) > budget ? ', бюджет превышен' : ''}`)
          .join('; ') + `. Из прошедших лучший recall у ${answer}.`,
        params: { qpd, slaMs, budget, configs: configs.map((c) => `${c.k}/${c.rerank ? 1 : 0}/${c.recall}/${c.p95}`).join(',') },
      };
    }
  },
};

/** Релизный гейт по оценке на золотом наборе: общий рост не должен прятать регресс в категории. */
export const evalReleaseGate: TaskGenerator = {
  id: 'ai.eval-release-gate',
  taskId: 'task:eval-release-gate',
  title: 'Какие версии промпта можно выкатывать',
  specialization: 'ai',
  subcategoryId: 'ai.llm-apps',
  grade: 'senior',
  catalogIds: ['ai.llm-eval', 'ai.prompting'],
  format: 'list',
  a: 1.4,
  b: 1.3,
  paramSpace: 1e9,
  timeLimitSec: 300,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const cats = rng.sample(['тарифы', 'возвраты', 'блокировки', 'доставка', 'жалобы'], 3);
    const sizes = cats.map(() => rng.pick([40, 50, 60, 80, 100]));
    const tol = rng.pick([3, 5]); // п.п.
    for (;;) {
      const base = cats.map(() => rng.int(60, 85));
      const versions = ['v2', 'v3', 'v4', 'v5'].map((v) => ({ v, acc: base.map((b) => Math.max(30, Math.min(99, b + rng.int(-9, 10)))) }));
      const overall = (acc: number[]) => acc.reduce((s, a, i) => s + (a * sizes[i]!) / 100, 0) / sizes.reduce((s, x) => s + x, 0);
      const baseAll = overall(base);
      const pass = versions.filter((x) => overall(x.acc) > baseAll + 1e-9 && x.acc.every((a, i) => a >= base[i]! - tol)).map((x) => x.v);
      const better = versions.filter((x) => overall(x.acc) > baseAll + 1e-9).length;
      // Нужны: хотя бы одна прошедшая и хотя бы одна «выросла в целом, но провалила категорию».
      if (pass.length === 0 || better === pass.length) continue;
      return {
        prompt: `Промпт классификатора обращений оценивают на золотом наборе (точность по категориям, %; размер категории указан). Версию можно выкатывать, если её общая точность (взвешенная по размерам) выше текущей v1 и ни в одной категории точность не упала больше чем на ${tol} п.п. относительно v1. Перечислите версии, которые можно выкатывать.`,
        code: table(
          ['версия', ...cats.map((c, i) => `${c} (${sizes[i]})`)],
          [['v1 (прод)', ...base.map(String)], ...versions.map((x) => [x.v, ...x.acc.map(String)])],
        ),
        answerHint: 'версии через запятую',
        answerKey: pass.join(','),
        explanation: [`v1: ${(baseAll * 100).toFixed(2)} %`, ...versions.map((x) => `${x.v}: ${(overall(x.acc) * 100).toFixed(2)} %${x.acc.some((a, i) => a < base[i]! - tol) ? `, падение в «${cats[x.acc.findIndex((a, i) => a < base[i]! - tol)]}»` : ''}`)].join('; ') + '.',
        params: { tol, sizes: sizes.join(','), base: base.join(',') },
      };
    }
  },
};

/** Семантический кэш: порог похожести по ожидаемой стоимости. */
export const semanticCacheThreshold: TaskGenerator = {
  id: 'ai.semantic-cache-threshold',
  taskId: 'task:semantic-cache',
  title: 'Порог семантического кэша',
  specialization: 'ai',
  subcategoryId: 'ai.llm-apps',
  grade: 'senior',
  catalogIds: ['ai.llm-cost', 'ai.vector-search'],
  format: 'number',
  a: 1.4,
  b: 1.5,
  paramSpace: 1e8,
  timeLimitSec: 300,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    for (;;) {
      const call = rng.pick([20, 30, 50, 80]); // коп. за вызов LLM
      const wrong = rng.pick([200, 300, 500, 1000]); // коп.: цена неверного ответа из кэша (эскалация в поддержку)
      const thr = [0.8, 0.85, 0.9, 0.95];
      let hit = rng.int(55, 70);
      let bad = rng.int(8, 14);
      const rows = thr.map((t) => {
        const r = { t, hit, bad: Number((bad / 10).toFixed(1)) };
        hit -= rng.int(6, 14);
        bad = Math.max(1, bad - rng.int(2, 5));
        return r;
      });
      // На 1000 запросов: промах кэша → вызов LLM; попадание → неверное с долей bad% от попаданий.
      const cost = (r: (typeof rows)[number]) => (1000 - 10 * r.hit) * call + 10 * r.hit * (r.bad / 100) * wrong;
      const ranked = [...rows].sort((a, b) => cost(a) - cost(b));
      if (cost(ranked[1]!) - cost(ranked[0]!) < call * 5) continue;
      // Ловушка: максимальное число попаданий (минимальный порог) не лучший.
      if (ranked[0]!.t === 0.8 && rng.next() < 0.7) continue;
      return {
        prompt: `Семантический кэш ответов чат-бота: если косинус запроса с закэшированным ≥ порога, отдаём кэш, иначе вызываем LLM (${call} коп.). Попадание иногда неверное (вопрос похож, но другой) - такой ответ стоит ${wrong} коп. (эскалация в поддержку). По замерам на логах ниже какой порог даёт минимальные ожидаемые расходы на 1000 запросов?`,
        code: table(['порог', 'попаданий, %', 'неверных среди попаданий, %'], rows.map((r) => [r.t.toFixed(2), r.hit, r.bad.toFixed(1)])),
        answerHint: 'порог, например 0.9',
        answerKey: num(ranked[0]!.t),
        explanation: rows.map((r) => `${r.t}: ${num(cost(r) / 100)} ₽`).join('; ') + '. Расходы = промахи × цена вызова + попадания × доля неверных × цена ошибки.',
        params: { call, wrong, rows: rows.map((r) => `${r.t}:${r.hit}:${r.bad}`).join(',') },
      };
    }
  },
};

/** Диагностика агента по трассе: где начался цикл. */
export const agentLoopDiagnosis: TaskGenerator = {
  id: 'ai.agent-loop-diagnosis',
  taskId: 'task:agent-trace',
  title: 'С какого шага агент зациклился',
  specialization: 'ai',
  subcategoryId: 'ai.llm-apps',
  grade: 'senior',
  catalogIds: ['ai.tool-use', 'ai.llm-eval'],
  format: 'line',
  a: 1.4,
  b: 1.1,
  paramSpace: 1e7,
  timeLimitSec: 300,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const order = String(rng.int(10000, 99999));
    const tools = [
      `search_orders(customer="${rng.pick(['Иванова', 'Петров', 'Смирнова'])}")`,
      `get_order(id="${order}")`,
      `get_delivery(order_id="${order}")`,
      `get_refund_policy(category="${rng.pick(['техника', 'одежда', 'книги'])}")`,
      `create_ticket(order_id="${order}")`,
    ];
    const prefix = rng.int(1, 3);
    const steps: string[] = [];
    for (let i = 0; i < prefix; i++) steps.push(`call ${tools[i]} → ok`);
    // Петля: агент повторяет пару «вызов с ошибкой 404 из-за неверного id → тот же вызов», не меняя аргументы.
    const bad = `get_delivery(order_id="${order.slice(0, 4)}")`;
    const loopStart = steps.length + 1;
    const reps = rng.int(3, 4);
    for (let i = 0; i < reps; i++) {
      steps.push(`call ${bad} → 404 not found`);
      if (i === 0 || rng.next() < 0.6) steps.push(`think: "попробую ещё раз получить доставку"`);
    }
    steps.push('stop: MAX_STEPS');
    const code = steps.join('\n');
    return {
      prompt: 'Трасса агента поддержки остановилась по лимиту шагов. Найдите номер строки, с которой начался цикл: агент повторяет один и тот же вызов с теми же аргументами и тем же результатом, ничего не меняя. Укажите первую строку повторяющегося вызова.',
      code,
      answerHint: 'номер строки',
      answerKey: String(loopStart),
      explanation: `С строки ${loopStart} агент вызывает ${bad} - id обрезан до 4 цифр, ответ 404, аргументы не меняются. Лечится проверкой повторного вызова и ошибкой инструмента в контексте модели, а не ростом MAX_STEPS.`,
      params: { prefix, reps, loopStart },
    };
  },
};

// ===========================================================================
// ai.ai-integration
// ===========================================================================

/** Стратегия маршрутизации по провайдерам: SLA успешности и цена. */
export const providerRouting: TaskGenerator = {
  id: 'ai.provider-routing',
  taskId: 'task:provider-routing',
  title: 'Какую схему провайдеров выбрать',
  specialization: 'ai',
  subcategoryId: 'ai.ai-integration',
  grade: 'senior',
  catalogIds: ['ai.llm-fallback', 'ai.llm-cost'],
  format: 'text',
  a: 1.4,
  b: 1.3,
  paramSpace: 1e8,
  timeLimitSec: 300,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    for (;;) {
      const pA = { price: rng.pick([20, 30, 40]), fail: rng.pick([1, 2, 3, 4]) }; // коп., % отказов
      const pB = { price: rng.pick([50, 60, 80]), fail: rng.pick([0.2, 0.5, 1]) };
      const sla = rng.pick([99.5, 99.8, 99.9]);
      // Отказы независимы. Цена: платим только за успешный вызов (так тарифицируют провайдеры).
      const fa = pA.fail / 100;
      const fb = pB.fail / 100;
      const schemes = [
        { name: 'только A', ok: 1 - fa, cost: (1 - fa) * pA.price },
        { name: 'только B', ok: 1 - fb, cost: (1 - fb) * pB.price },
        { name: 'A, при отказе B', ok: 1 - fa * fb, cost: (1 - fa) * pA.price + fa * (1 - fb) * pB.price },
        { name: 'B, при отказе A', ok: 1 - fb * fa, cost: (1 - fb) * pB.price + fb * (1 - fa) * pA.price },
      ];
      const ok = schemes.filter((s) => s.ok * 100 >= sla - 1e-9);
      if (ok.length === 0 || ok.length === schemes.length) continue;
      ok.sort((a, b) => a.cost - b.cost);
      if (ok.length > 1 && ok[1]!.cost - ok[0]!.cost < 0.05) continue;
      const opts = lettered(rng, schemes);
      const answer = opts.find((o) => o.item === ok[0])!.label;
      return {
        prompt: `Интеграция LLM в обработку заявок. Провайдер A: ${pA.price} коп. за успешный вызов, отказов ${pA.fail} %. Провайдер B: ${pB.price} коп., отказов ${pB.fail} %. Отказы независимы, платим только за успешные вызовы. Требование: доля успешно обработанных заявок ≥ ${sla} %. Какая схема дешевле всех среди удовлетворяющих требованию?`,
        code: opts.map((o) => `${o.label}. ${o.item.name}`).join('\n'),
        answerHint: 'буква схемы',
        answerKey: answer,
        explanation: opts.map((o) => `${o.label}: успех ${(o.item.ok * 100).toFixed(3)} %, ${o.item.cost.toFixed(2)} коп./заявку`).join('; ') + '.',
        params: { a: `${pA.price}/${pA.fail}`, b: `${pB.price}/${pB.fail}`, sla },
      };
    }
  },
};

/** Очередь асинхронных LLM-задач: хвост через T минут. */
export const llmQueueBacklog: TaskGenerator = {
  id: 'ai.llm-queue-backlog',
  taskId: 'task:llm-queue',
  title: 'Сколько задач накопится в очереди',
  specialization: 'ai',
  subcategoryId: 'ai.ai-integration',
  grade: 'senior',
  catalogIds: ['ai.llm-api', 'ai.llm-cost'],
  format: 'number',
  a: 1.4,
  b: 1.2,
  paramSpace: 1e6,
  timeLimitSec: 300,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    for (;;) {
      const arrive = rng.int(4, 30) * 10; // задач в минуту в пике
      const conc = rng.pick([4, 8, 16, 32]); // параллельных запросов
      const latency = rng.pick([2, 3, 4, 6, 8, 10]); // секунд на задачу
      const rpm = rng.int(5, 40) * 10; // лимит провайдера
      const minutes = rng.pick([10, 15, 30, 60]);
      const byConc = (conc * 60) / latency;
      const throughput = Math.min(byConc, rpm);
      const backlog = Math.max(0, (arrive - throughput) * minutes);
      if (backlog === 0 && rng.next() < 0.7) continue;
      return {
        prompt: `Пиковая нагрузка: ${arrive} задач в минуту в течение ${minutes} минут, очередь пуста в начале. Воркер держит ${conc} параллельных запросов к LLM, задача обрабатывается ${latency} с. Лимит провайдера - ${rpm} запросов в минуту. Сколько задач будет в очереди к концу пика (потоки считать ровными)?`,
        answerHint: 'число задач',
        answerKey: num(Number(backlog.toFixed(1))),
        explanation: `Пропускная способность = min(${conc} × 60 / ${latency} = ${num(byConc)}, лимит ${rpm}) = ${num(throughput)} в минуту. Хвост = max(0, ${arrive} − ${num(throughput)}) × ${minutes} = ${num(Number(backlog.toFixed(1)))}. Узкое место - ${byConc < rpm ? 'параллельность воркера' : 'лимит провайдера'}: его и масштабируют.`,
        params: { arrive, conc, latency, rpm, minutes },
      };
    }
  },
};

/** Аудит пайплайна на утечку ПДн: какая строка отправляет или сохраняет немаскированные данные. */
export const piiPipelineAudit: TaskGenerator = {
  id: 'ai.pii-pipeline-audit',
  taskId: 'task:pii-audit',
  title: 'Где пайплайн теряет маскирование',
  specialization: 'ai',
  subcategoryId: 'ai.ai-integration',
  grade: 'senior',
  catalogIds: ['ai.pii-masking', 'ai.llm-api'],
  format: 'line',
  a: 1.4,
  b: 1.0,
  paramSpace: 1e6,
  timeLimitSec: 300,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const safe = [
      'masked = mask_pii(raw_text)',
      'audit.log(request_id, len(masked))',
      'reply = llm.complete(SYSTEM, masked)',
      'cache.set(hash(masked), reply)',
      'restored = unmask(reply, mapping)',
      'metrics.observe("llm_latency", reply.latency)',
      'return restored',
    ];
    const leaks = [
      { line: 'logger.info("prompt=%s", raw_text)', after: 0, why: 'в лог уходит текст до маскирования' },
      { line: 'cache.set(hash(raw_text), restored)', after: 4, why: 'в кэш кладётся восстановленный ответ с ПДн' },
      { line: 'trace.attach("llm_input", raw_text)', after: 1, why: 'в трассировку уходит немаскированный вход' },
      { line: 'eval_store.save(raw_text, restored)', after: 5, why: 'в датасет оценки пишутся ПДн' },
    ];
    const leak = rng.pick(leaks);
    const lines = [...safe];
    lines.splice(leak.after + 1, 0, leak.line);
    const extras = rng.sample(
      ['tokens = count_tokens(masked)', 'assert is_masked(masked)', 'ratelimit.acquire(tenant_id)', 'span.set("tenant", tenant_id)', 'budget.charge(tenant_id, tokens_estimate(masked))'],
      2,
    );
    const pos = rng.int(1, 2);
    lines.splice(pos, 0, extras[0]!);
    lines.splice(rng.int(pos + 1, pos + 3), 0, extras[1]!);
    const extraSafe = extras.join(' | ');
    const answer = lines.indexOf(leak.line) + 1;
    return {
      prompt: 'Обработчик обращения клиента перед вызовом внешней LLM маскирует ПДн (ФИО, телефон, карта) и после ответа восстанавливает их. Логи, кэш, трассировка и датасеты хранятся вне контура ПДн. Какая строка нарушает это - выносит немаскированные данные за контур?',
      code: lines.join('\n'),
      answerHint: 'номер строки',
      answerKey: String(answer),
      explanation: `Строка ${answer}: ${leak.why}. Остальные работают с masked или с ответом внутри контура.`,
      params: { leak: leak.line, extraSafe, pos },
    };
  },
};

/** Прогноз расходов: в каком месяце LLM выйдет за бюджет. */
export const costForecast: TaskGenerator = {
  id: 'ai.cost-forecast',
  taskId: 'task:cost-forecast',
  title: 'Когда расходы на LLM превысят бюджет',
  specialization: 'ai',
  subcategoryId: 'ai.ai-integration',
  grade: 'senior',
  catalogIds: ['ai.llm-cost'],
  format: 'number',
  a: 1.4,
  b: 1.5,
  paramSpace: 1e7,
  timeLimitSec: 300,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    for (;;) {
      const users = rng.int(2, 20) * 1000; // активных в первый месяц
      const growth = rng.pick([10, 15, 20, 25, 30]); // % в месяц
      const reqPerUser = rng.int(10, 60);
      const tokens = rng.int(10, 40) * 100; // вход + выход на запрос
      const price = rng.pick([100, 150, 200, 300]); // ₽ за 1 млн токенов
      const cacheHit = rng.pick([0, 20, 30, 40]); // % запросов из кэша (без вызова)
      const budget = rng.int(5, 40) * 10000;
      let month = 0;
      let cost = 0;
      for (let m = 1; m <= 24; m++) {
        const u = users * (1 + growth / 100) ** (m - 1);
        cost = (u * reqPerUser * (1 - cacheHit / 100) * tokens * price) / 1e6;
        if (cost > budget) {
          month = m;
          break;
        }
      }
      if (month < 2 || month > 12) continue;
      return {
        prompt: `Прогноз расходов на LLM. В первый месяц ${users.toLocaleString('ru-RU')} активных пользователей, дальше +${growth} % в месяц (сложный рост). Пользователь делает ${reqPerUser} запросов в месяц, ${cacheHit} % из них отдаёт кэш без вызова модели. Запрос - ${tokens} токенов, цена ${price} ₽ за 1 млн токенов. Бюджет - ${budget.toLocaleString('ru-RU')} ₽ в месяц. В каком месяце (первый = 1) расходы впервые превысят бюджет?`,
        answerHint: 'номер месяца',
        answerKey: String(month),
        explanation: `Расход месяца m = ${users} × ${1 + growth / 100}^(m−1) × ${reqPerUser} × ${1 - cacheHit / 100} × ${tokens} × ${price} / 10⁶; в месяце ${month} ≈ ${Math.round(cost)} ₽ > ${budget}.`,
        params: { users, growth, reqPerUser, tokens, price, cacheHit, budget },
      };
    }
  },
};

// ===========================================================================
// ai.ml-engineering
// ===========================================================================

/** Порог по бизнес-стоимости ошибок. */
export const costThreshold: TaskGenerator = {
  id: 'ai.cost-threshold',
  taskId: 'task:cost-threshold',
  title: 'Порог модели по цене ошибок',
  specialization: 'ai',
  subcategoryId: 'ai.ml-engineering',
  grade: 'senior',
  catalogIds: ['ai.ml-metrics', 'ai.validation'],
  format: 'number',
  a: 1.4,
  b: 1.2,
  paramSpace: 1e8,
  timeLimitSec: 300,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    for (;;) {
      const fnCost = rng.pick([5000, 10000, 20000, 50000]); // пропущенное мошенничество
      const fpCost = rng.pick([200, 300, 500, 1000]); // ручная проверка честной операции
      const pos = rng.int(40, 120);
      const thrs = [0.2, 0.3, 0.4, 0.5, 0.6];
      let tp = pos - rng.int(0, 5);
      let fp = rng.int(800, 2000);
      const rows = thrs.map((t) => {
        const r = { t, tp, fp };
        tp = Math.max(1, tp - rng.int(3, 15));
        fp = Math.max(5, Math.round(fp * (rng.int(30, 60) / 100)));
        return r;
      });
      const cost = (r: (typeof rows)[number]) => (pos - r.tp) * fnCost + r.fp * fpCost;
      const ranked = [...rows].sort((a, b) => cost(a) - cost(b));
      if (cost(ranked[1]!) - cost(ranked[0]!) < fpCost * 3) continue;
      // Ловушка: F1-оптимальный порог – не тот, что по стоимости (проверяем, что они чаще различаются).
      const f1 = (r: (typeof rows)[number]) => (2 * r.tp) / (2 * r.tp + r.fp + (pos - r.tp));
      const byF1 = [...rows].sort((a, b) => f1(b) - f1(a))[0]!;
      if (byF1.t === ranked[0]!.t && rng.next() < 0.7) continue;
      return {
        prompt: `Антифрод на валидации: ${pos} мошеннических операций. Пропуск мошенничества стоит ${fnCost.toLocaleString('ru-RU')} ₽, ручная проверка честной операции (ложное срабатывание) - ${fpCost} ₽. Какой порог минимизирует суммарную стоимость ошибок?`,
        code: table(['порог', 'TP', 'FP'], rows.map((r) => [r.t.toFixed(1), r.tp, r.fp])),
        answerHint: 'порог, например 0.4',
        answerKey: num(ranked[0]!.t),
        explanation: rows.map((r) => `${r.t}: ${(pos - r.tp) * fnCost + r.fp * fpCost} ₽`).join('; ') + `. Стоимость = FN × ${fnCost} + FP × ${fpCost}, FN = ${pos} − TP. По F1 был бы ${byF1.t}.`,
        params: { fnCost, fpCost, pos, rows: rows.map((r) => `${r.t}:${r.tp}:${r.fp}`).join(',') },
      };
    }
  },
};

/** Калибровка: ECE по бинам. */
export const calibrationEce: TaskGenerator = {
  id: 'ai.calibration-ece',
  taskId: 'task:calibration',
  title: 'Насколько откалибрована модель',
  specialization: 'ai',
  subcategoryId: 'ai.ml-engineering',
  grade: 'senior',
  catalogIds: ['ai.ml-metrics', 'ai.validation'],
  format: 'number',
  a: 1.4,
  b: 1.4,
  paramSpace: 1e9,
  timeLimitSec: 300,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const bins = [0.1, 0.3, 0.5, 0.7, 0.9];
    const counts = bins.map(() => rng.int(1, 20) * 10);
    const conf = bins.map((b) => Number((b + rng.int(-5, 5) / 100).toFixed(2)));
    const acc = conf.map((c) => Number(Math.min(0.99, Math.max(0.01, c + rng.int(-15, 15) / 100)).toFixed(2)));
    const n = counts.reduce((s, x) => s + x, 0);
    const ece = counts.reduce((s, c, i) => s + (c / n) * Math.abs(acc[i]! - conf[i]!), 0);
    return {
      prompt: 'Предсказанные вероятности разбиты на 5 бинов. Посчитайте Expected Calibration Error: ECE = Σ (n_bin / N) × |доля положительных − средняя уверенность|. Ответ округлите до 0,001.',
      code: table(['бин', 'объектов', 'средняя уверенность', 'доля положительных'], bins.map((_, i) => [i + 1, counts[i]!, conf[i]!.toFixed(2), acc[i]!.toFixed(2)])),
      answerHint: 'число до 0,001',
      answerKey: num(Number(ece.toFixed(3))),
      explanation: `N = ${n}; ${counts.map((c, i) => `${c}/${n}×${Math.abs(acc[i]! - conf[i]!).toFixed(2)}`).join(' + ')} = ${ece.toFixed(3)}. Высокий ECE при хорошем AUC - повод калибровать (Platt, isotonic), если по вероятности считают деньги.`,
      params: { counts: counts.join(','), conf: conf.join(','), acc: acc.join(',') },
    };
  },
};

/** Выбор ансамбля под бюджет латентности. */
export const ensembleBudget: TaskGenerator = {
  id: 'ai.ensemble-budget',
  taskId: 'task:ensemble-budget',
  title: 'Какой ансамбль влезает в бюджет',
  specialization: 'ai',
  subcategoryId: 'ai.ml-engineering',
  grade: 'senior',
  catalogIds: ['ai.ml-baseline', 'ai.model-serving'],
  format: 'text',
  a: 1.4,
  b: 1.1,
  paramSpace: 1e8,
  timeLimitSec: 300,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    for (;;) {
      const budget = rng.pick([40, 60, 80, 100]);
      const models = ['CatBoost', 'LogReg', 'MLP', 'kNN'].map((m) => ({ m, ms: rng.int(1, 12) * 5 }));
      const pairs: { a: string; b: string; ms: number; auc: number; parallel: boolean }[] = [];
      for (let i = 0; i < models.length; i++)
        for (let j = i + 1; j < models.length; j++) {
          const parallel = rng.next() < 0.4;
          const ms = parallel ? Math.max(models[i]!.ms, models[j]!.ms) : models[i]!.ms + models[j]!.ms;
          pairs.push({ a: models[i]!.m, b: models[j]!.m, ms, auc: rng.int(780, 880) / 1000, parallel });
        }
      const shown = rng.sample(pairs, 4);
      const ok = shown.filter((p) => p.ms <= budget).sort((x, y) => y.auc - x.auc);
      if (ok.length === 0 || ok.length === shown.length) continue;
      if (ok.length > 1 && ok[0]!.auc === ok[1]!.auc) continue;
      const opts = lettered(rng, shown);
      const answer = opts.find((o) => o.item === ok[0])!.label;
      return {
        prompt: `Скоринг в онлайне: бюджет латентности модели - ${budget} мс. Модели ансамбля работают последовательно, если не указано «параллельно» (тогда задержка - максимум из двух). Задержки одиночных моделей: ${models.map((x) => `${x.m} ${x.ms} мс`).join(', ')}. Из пар, укладывающихся в бюджет, выбирают максимальный AUC на валидации. Какую пару выкатывать?`,
        code: opts.map((o) => `${o.label}. ${o.item.a} + ${o.item.b}${o.item.parallel ? ' (параллельно)' : ''}: AUC ${o.item.auc.toFixed(3)}`).join('\n'),
        answerHint: 'буква варианта',
        answerKey: answer,
        explanation: opts.map((o) => `${o.label}: ${o.item.ms} мс${o.item.ms > budget ? ' > бюджета' : ''}`).join('; ') + `. Лучший AUC в бюджете - ${answer}.`,
        params: { budget, models: models.map((x) => `${x.m}:${x.ms}`).join(','), shown: shown.map((p) => `${p.a}+${p.b}:${p.ms}:${p.auc}`).join(',') },
      };
    }
  },
};

/** Временной сплит: сколько строк train «из будущего» при случайном разбиении. */
export const temporalLeak: TaskGenerator = {
  id: 'ai.temporal-leak',
  taskId: 'task:temporal-split',
  title: 'Сколько строк train заглядывают в будущее',
  specialization: 'ai',
  subcategoryId: 'ai.ml-engineering',
  grade: 'senior',
  catalogIds: ['ai.data-leakage', 'ai.validation'],
  format: 'number',
  a: 1.4,
  b: 1.0,
  paramSpace: 1e9,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    for (;;) {
      const n = rng.int(10, 12);
      const days = rng.sample(Array.from({ length: 28 }, (_, i) => i + 1), n).sort((a, b) => a - b);
      const isTest = days.map(() => rng.next() < 0.35);
      if (!isTest.some(Boolean) || isTest.every(Boolean)) continue;
      const firstTest = Math.min(...days.filter((_, i) => isTest[i]));
      const leaky = days.filter((d, i) => !isTest[i] && d > firstTest).length;
      if (leaky === 0 && rng.next() < 0.8) continue;
      return {
        prompt: 'Модель прогноза оттока будет работать на будущих данных, а сплит сделали случайным train_test_split. Сколько строк train позже самой ранней даты test (по ним модель «видит будущее» относительно части теста)?',
        code: table(['дата (октябрь)', 'выборка'], days.map((d, i) => [d, isTest[i] ? 'test' : 'train'])),
        answerHint: 'число строк',
        answerKey: String(leaky),
        explanation: `Самая ранняя дата test - ${firstTest}; строк train позже неё - ${leaky}. Для прогноза во времени сплит делают по дате: train строго раньше test (TimeSeriesSplit).`,
        params: { days: days.join(','), test: isTest.map((x) => (x ? 1 : 0)).join('') },
      };
    }
  },
};

// ===========================================================================
// ai.mlops
// ===========================================================================

/** Откат канарейки по нескольким guardrail относительно базовой версии. */
export const canaryRollback: TaskGenerator = {
  id: 'ai.canary-rollback',
  taskId: 'task:canary-guardrails',
  title: 'Когда откатится канарейка',
  specialization: 'ai',
  subcategoryId: 'ai.mlops',
  grade: 'senior',
  catalogIds: ['ai.model-versioning', 'ai.monitoring-drift'],
  format: 'number',
  a: 1.4,
  b: 1.2,
  paramSpace: 1e9,
  timeLimitSec: 300,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const errTol = rng.pick([20, 50]); // % относительного роста ошибок
    const latTol = rng.pick([10, 20]); // % роста p95
    const k = 2;
    for (;;) {
      const windows = Array.from({ length: 8 }, () => {
        const baseErr = rng.int(10, 20) / 10;
        const baseLat = rng.int(15, 30) * 10;
        const err = Number((baseErr * (1 + rng.int(-10, 70) / 100)).toFixed(2));
        const lat = Math.round(baseLat * (1 + rng.int(-5, 30) / 100));
        return { baseErr, err, baseLat, lat };
      });
      const bad = windows.map((w) => w.err > w.baseErr * (1 + errTol / 100) + 1e-9 || w.lat > w.baseLat * (1 + latTol / 100) + 1e-9);
      let run = 0;
      let at = 0;
      for (let i = 0; i < bad.length; i++) {
        run = bad[i] ? run + 1 : 0;
        if (run === k) {
          at = i + 1;
          break;
        }
      }
      if (at === 0 && rng.next() < 0.85) continue;
      // Ловушка: абсолютные числа канарейки ниже порога «на глаз», важна относительная разница с базой в том же окне.
      return {
        prompt: `Канареечный выкат модели. В каждом 10-минутном окне канарейку сравнивают с базовой версией в том же окне. Окно плохое, если доля ошибок канарейки выше базовой больше чем на ${errTol} % (относительно) ИЛИ её p95 выше базового больше чем на ${latTol} %. Откат - после ${k} плохих окон подряд. В каком окне произойдёт откат? Если не произойдёт - 0.`,
        code: table(['окно', 'ошибки база, %', 'ошибки канарейка, %', 'p95 база, мс', 'p95 канарейка, мс'], windows.map((w, i) => [i + 1, w.baseErr.toFixed(2), w.err.toFixed(2), w.baseLat, w.lat])),
        answerHint: 'номер окна или 0',
        answerKey: String(at),
        explanation: `Плохие окна: ${bad.map((b, i) => (b ? i + 1 : null)).filter(Boolean).join(', ') || 'нет'}. ${at ? `Второе подряд - окно ${at}.` : 'Двух подряд нет - откат не нужен.'}`,
        params: { errTol, latTol, bad: bad.map((b) => (b ? 1 : 0)).join('') },
      };
    }
  },
};

/** Сколько GPU под LLM-сервис с запасом и резервом. */
export const gpuSizing: TaskGenerator = {
  id: 'ai.gpu-sizing',
  taskId: 'task:gpu-sizing',
  title: 'Сколько GPU нужно сервису',
  specialization: 'ai',
  subcategoryId: 'ai.mlops',
  grade: 'senior',
  catalogIds: ['ai.model-serving'],
  format: 'number',
  a: 1.4,
  b: 1.3,
  paramSpace: 1e6,
  timeLimitSec: 300,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const rps = rng.int(2, 40); // пиковые запросы в секунду
    const outTokens = rng.int(2, 8) * 50; // генерируемых токенов на запрос
    const tpsPerGpu = rng.pick([1500, 2000, 2500, 3000, 4000]); // токенов/с на GPU при батчинге
    const headroom = rng.pick([20, 30, 40]); // % запаса
    const redundancy = rng.pick([0, 1]); // N+1
    const need = (rps * outTokens) / tpsPerGpu;
    const gpus = ceil(need * (1 + headroom / 100)) + redundancy;
    return {
      prompt: `LLM-сервис: пик ${rps} запросов в секунду, в среднем ${outTokens} генерируемых токенов на запрос. Одна GPU при батчинге выдаёт ${tpsPerGpu} токенов в секунду. Нужен запас ${headroom} % сверх пика${redundancy ? ' и ещё одна GPU на случай отказа (N+1)' : ''}. Сколько GPU заложить? Дробное число округляется вверх до добавления резерва.`,
      answerHint: 'число GPU',
      answerKey: String(gpus),
      explanation: `${rps} × ${outTokens} = ${rps * outTokens} токенов/с; / ${tpsPerGpu} = ${num(Number(need.toFixed(3)))} GPU; × ${1 + headroom / 100} = ${num(Number((need * (1 + headroom / 100)).toFixed(3)))} → ${ceil(need * (1 + headroom / 100))}${redundancy ? ' + 1' : ''} = ${gpus}.`,
      params: { rps, outTokens, tpsPerGpu, headroom, redundancy },
    };
  },
};

/** Shadow-режим: какие сегменты блокируют выкат. */
export const shadowSegments: TaskGenerator = {
  id: 'ai.shadow-segments',
  taskId: 'task:shadow-deploy',
  title: 'Какие сегменты блокируют выкат',
  specialization: 'ai',
  subcategoryId: 'ai.mlops',
  grade: 'senior',
  catalogIds: ['ai.model-versioning', 'ai.monitoring-drift'],
  format: 'list',
  a: 1.4,
  b: 1.0,
  paramSpace: 1e8,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const segs = rng.sample(['новые клиенты', 'премиум', 'регионы', 'мобильное приложение', 'юрлица', 'пенсионеры'], 5);
    const maxDis = rng.pick([5, 8, 10]); // % расхождения
    const minShare = rng.pick([3, 5]); // % трафика
    for (;;) {
      const rows = segs.map((s) => ({ s, share: rng.int(1, 40), dis: rng.int(1, 20) }));
      const block = rows.filter((r) => r.dis > maxDis && r.share >= minShare).map((r) => r.s);
      const decoys = rows.filter((r) => r.dis > maxDis && r.share < minShare).length;
      if (block.length === 0 || block.length === rows.length) continue;
      if (decoys === 0 && rng.next() < 0.6) continue;
      return {
        prompt: `Новая модель работает в shadow-режиме рядом с продовой. Выкат блокирует сегмент, где решения моделей расходятся больше чем в ${maxDis} % случаев, если у сегмента не меньше ${minShare} % трафика (мелкие сегменты разбирают вручную после выката). Перечислите сегменты, которые блокируют выкат.`,
        code: table(['сегмент', 'доля трафика, %', 'расхождение, %'], rows.map((r) => [r.s, r.share, r.dis])),
        answerHint: 'сегменты через запятую',
        answerKey: block.join(','),
        explanation: rows.map((r) => `${r.s}: ${r.dis > maxDis ? (r.share >= minShare ? 'блокирует' : 'расходится, но < доли трафика') : 'в норме'}`).join('; ') + '.',
        params: { maxDis, minShare, rows: rows.map((r) => `${r.share}/${r.dis}`).join(',') },
      };
    }
  },
};

/** Бюджет ошибок SLO: сколько минут осталось. */
export const errorBudget: TaskGenerator = {
  id: 'ai.error-budget',
  taskId: 'task:error-budget',
  title: 'Сколько осталось бюджета ошибок',
  specialization: 'ai',
  subcategoryId: 'ai.mlops',
  grade: 'senior',
  catalogIds: ['ai.model-serving', 'ai.monitoring-drift'],
  format: 'number',
  a: 1.4,
  b: 1.1,
  paramSpace: 1e7,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const slo = rng.pick([99, 99.5, 99.9, 99.95]);
    const days = 30;
    const budget = days * 24 * 60 * (1 - slo / 100);
    const incidents = Array.from({ length: rng.int(2, 4) }, () => ({ min: rng.int(2, 40), partial: rng.pick([100, 100, 50, 25]) }));
    const spent = incidents.reduce((s, x) => s + (x.min * x.partial) / 100, 0);
    const left = budget - spent;
    return {
      prompt: `SLO сервиса скоринга - ${slo} % доступности за ${days} дней (недоступность считается в минутах, частичная - пропорционально доле упавших запросов). Инциденты месяца ниже. Сколько минут бюджета ошибок осталось? Если бюджет перерасходован - число отрицательное. Ответ до 0,1.`,
      code: incidents.map((x, i) => `инцидент ${i + 1}: ${x.min} мин, падало ${x.partial} % запросов`).join('\n'),
      answerHint: 'минут, до 0,1',
      answerKey: num(Number(left.toFixed(1))),
      explanation: `Бюджет = ${days} × 24 × 60 × ${num(Number((1 - slo / 100).toFixed(4)))} = ${num(Number(budget.toFixed(1)))} мин; потрачено ${num(Number(spent.toFixed(1)))}; осталось ${num(Number(left.toFixed(1)))}. ${left < 0 ? 'Рискованные выкаты - заморозить.' : ''}`.trim(),
      params: { slo, incidents: incidents.map((x) => `${x.min}:${x.partial}`).join(',') },
    };
  },
};

// ===========================================================================
// ai.data-science
// ===========================================================================

/** Длительность A/B по размеру выборки (правило 16·p(1−p)/δ²). */
export const abDuration: TaskGenerator = {
  id: 'ai.ab-duration',
  taskId: 'task:ab-sample-size',
  title: 'Сколько дней идти тесту',
  specialization: 'ai',
  subcategoryId: 'ai.data-science',
  grade: 'senior',
  catalogIds: ['ai.ab-testing'],
  format: 'number',
  a: 1.4,
  b: 1.3,
  paramSpace: 1e6,
  timeLimitSec: 300,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const p = rng.pick([2, 4, 5, 8, 10, 20]) / 100;
    const relMde = rng.pick([5, 10, 15, 20]) / 100;
    const traffic = rng.int(2, 50) * 1000; // пользователей в день на весь тест
    const share = rng.pick([50, 100]); // % трафика в эксперименте
    const delta = p * relMde;
    const nPerGroup = ceil((16 * p * (1 - p)) / delta ** 2);
    const perDayPerGroup = (traffic * share) / 100 / 2;
    const days = ceil(nPerGroup / perDayPerGroup);
    return {
      prompt: `Планируем A/B (две группы поровну). Базовая конверсия ${p * 100} %, хотим заметить относительный рост ${relMde * 100} % (α = 0,05, мощность 80 %). Оценка размера группы: n = 16 × p × (1 − p) / δ², δ - абсолютная разница. В эксперимент идёт ${share} % из ${traffic.toLocaleString('ru-RU')} новых пользователей в день. Сколько полных дней нужно тесту?`,
      answerHint: 'дней',
      answerKey: String(days),
      explanation: `δ = ${p} × ${relMde} = ${num(delta)}; n = ⌈16 × ${p} × ${num(1 - p)} / ${num(delta)}²⌉ = ${nPerGroup} на группу; в день на группу ${num(perDayPerGroup)}; дней ⌈${nPerGroup} / ${num(perDayPerGroup)}⌉ = ${days}. Остановка раньше по «уже значимо» ломает α.`,
      params: { p, relMde, traffic, share },
    };
  },
};

/** Разность разностей. */
export const diffInDiff: TaskGenerator = {
  id: 'ai.diff-in-diff',
  taskId: 'task:diff-in-diff',
  title: 'Эффект запуска без A/B',
  specialization: 'ai',
  subcategoryId: 'ai.data-science',
  grade: 'senior',
  catalogIds: ['ai.ab-testing', 'ai.pandas-sql'],
  format: 'number',
  a: 1.4,
  b: 1.1,
  paramSpace: 1e8,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    for (;;) {
      const cityA = rng.pick(['Казань', 'Самара', 'Пермь']);
      const cityB = rng.pick(['Тверь', 'Омск', 'Томск']);
      const preT = rng.int(100, 300) / 10;
      const preC = rng.int(100, 300) / 10;
      const trend = rng.int(-20, 30) / 10;
      const effect = rng.int(-15, 40) / 10;
      if (Math.abs(effect) < 0.3) continue;
      const postT = Number((preT + trend + effect).toFixed(1));
      const postC = Number((preC + trend).toFixed(1));
      const did = Number((postT - preT - (postC - preC)).toFixed(1));
      return {
        prompt: `Рекомендательную модель включили только в городе ${cityA}; ${cityB} - контроль (тренды городов до запуска были параллельны). Оцените эффект запуска на средний чек методом разности разностей. Ответ - тыс. ₽ до 0,1, со знаком.`,
        code: table(['город', 'до запуска, тыс. ₽', 'после, тыс. ₽'], [[`${cityA} (запуск)`, preT.toFixed(1), postT.toFixed(1)], [`${cityB} (контроль)`, preC.toFixed(1), postC.toFixed(1)]]),
        answerHint: 'тыс. ₽, например 1.5',
        answerKey: num(did),
        explanation: `(${postT} − ${preT}) − (${postC} − ${preC}) = ${num(did)}. Простое «после − до» в ${cityA} (${num(Number((postT - preT).toFixed(1)))}) включает общий тренд.`,
        params: { preT, preC, postT, postC },
      };
    }
  },
};

/** Эффект новизны: оценка аплифта по стабильному периоду. */
export const noveltyEffect: TaskGenerator = {
  id: 'ai.novelty-effect',
  taskId: 'task:novelty-effect',
  title: 'Аплифт без эффекта новизны',
  specialization: 'ai',
  subcategoryId: 'ai.data-science',
  grade: 'senior',
  catalogIds: ['ai.ab-testing'],
  format: 'number',
  a: 1.4,
  b: 1.0,
  paramSpace: 1e9,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    for (;;) {
      const days = 14;
      const stable = rng.int(1, 8); // %
      const novelty = rng.int(3, 6); // дней всплеска
      const series = Array.from({ length: days }, (_, i) => (i < novelty ? stable + rng.int(4, 12) - i : stable + rng.int(-2, 2)));
      // Правило: стабильный период – с первого дня, после которого 3 дня подряд аплифт в пределах ±2 п.п. от медианы второй недели.
      const tail = series.slice(7).sort((a, b) => a - b);
      const med = tail[3]!;
      let start = -1;
      for (let i = 0; i + 2 < days; i++) {
        if ([0, 1, 2].every((j) => Math.abs(series[i + j]! - med) <= 2)) {
          start = i;
          break;
        }
      }
      if (start < 2) continue;
      const tailVals = series.slice(start);
      const avg = tailVals.reduce((s, x) => s + x, 0) / tailVals.length;
      return {
        prompt: `Аплифт новой ленты рекомендаций по дням теста (п.п. CTR к контролю). Первые дни завышены эффектом новизны. Стабильный период начинается с первого дня, начиная с которого 3 дня подряд аплифт отличается от медианы второй недели (дни 8-14) не больше чем на 2 п.п. Оцените аплифт как среднее по стабильному периоду (до конца теста). Ответ до 0,01.`,
        code: series.map((x, i) => `день ${i + 1}: ${x > 0 ? '+' : ''}${x}`).join('\n'),
        answerHint: 'п.п., до 0,01',
        answerKey: num(Number(avg.toFixed(2))),
        explanation: `Медиана дней 8-14 = ${med}; стабильный период - с дня ${start + 1}; среднее = ${num(Number(avg.toFixed(2)))}. Среднее по всем дням (${num(Number((series.reduce((s, x) => s + x, 0) / days).toFixed(2)))}) завышено новизной.`,
        params: { series: series.join(','), start },
      };
    }
  },
};

/** Выбор варианта по выручке с guardrail-метрикой. */
export const guardrailChoice: TaskGenerator = {
  id: 'ai.guardrail-choice',
  taskId: 'task:guardrail-metric',
  title: 'Какой вариант выкатывать с учётом guardrail',
  specialization: 'ai',
  subcategoryId: 'ai.data-science',
  grade: 'senior',
  catalogIds: ['ai.ab-testing'],
  format: 'text',
  a: 1.4,
  b: 1.4,
  paramSpace: 1e8,
  timeLimitSec: 300,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    for (;;) {
      const users = rng.pick([10000, 20000, 50000]);
      const aov = rng.pick([1500, 2000, 3000]);
      const refundMax = rng.pick([3, 4, 5]); // % возвратов – guardrail
      const variants = ['контроль', 'скидка 5 %', 'бесплатная доставка', 'персональная подборка', 'таймер акции'].map((name, i) => ({
        name,
        conv: i === 0 ? 4 : Number((4 + rng.int(-5, 20) / 10).toFixed(1)),
        aov: i === 0 ? aov : Math.round(aov * (1 + rng.int(-15, 10) / 100)),
        refund: Number((rng.int(15, 60) / 10).toFixed(1)),
      }));
      // Чистая выручка на группу = пользователи × конверсия × чек × (1 − возвраты).
      const net = (v: (typeof variants)[number]) => users * (v.conv / 100) * v.aov * (1 - v.refund / 100);
      const ok = variants.filter((v) => v.refund <= refundMax).sort((a, b) => net(b) - net(a));
      if (ok.length < 2 || ok.length === variants.length) continue;
      if (net(ok[0]!) - net(ok[1]!) < 1000) continue;
      // Ловушка: лучший по чистой выручке вообще нарушает guardrail.
      const best = [...variants].sort((a, b) => net(b) - net(a))[0]!;
      if (best === ok[0] && rng.next() < 0.75) continue;
      const opts = lettered(rng, variants);
      const answer = opts.find((o) => o.item === ok[0])!.label;
      return {
        prompt: `Эксперимент на ${users.toLocaleString('ru-RU')} пользователей в каждой группе. Выбирают вариант с максимальной чистой выручкой (пользователи × конверсия × средний чек × (1 − доля возвратов)), но guardrail: доля возвратов не выше ${refundMax} %. Какой вариант выкатывать (контроль - тоже вариант)?`,
        code: table(['вариант', 'название', 'конверсия, %', 'средний чек, ₽', 'возвраты, %'], opts.map((o) => [o.label, o.item.name, o.item.conv.toFixed(1), o.item.aov, o.item.refund.toFixed(1)])),
        answerHint: 'буква варианта',
        answerKey: answer,
        explanation: opts.map((o) => `${o.label}: ${Math.round(net(o.item)).toLocaleString('ru-RU')} ₽${o.item.refund > refundMax ? ', нарушает guardrail' : ''}`).join('; ') + '.',
        params: { users, refundMax, variants: variants.map((v) => `${v.conv}/${v.aov}/${v.refund}`).join(',') },
      };
    }
  },
};

export const AI_SENIOR_GENERATORS: TaskGenerator[] = [
  ragDesignChoice,
  evalReleaseGate,
  semanticCacheThreshold,
  agentLoopDiagnosis,
  providerRouting,
  llmQueueBacklog,
  piiPipelineAudit,
  costForecast,
  costThreshold,
  calibrationEce,
  ensembleBudget,
  temporalLeak,
  canaryRollback,
  gpuSizing,
  shadowSegments,
  errorBudget,
  abDuration,
  diffInDiff,
  noveltyEffect,
  guardrailChoice,
];
