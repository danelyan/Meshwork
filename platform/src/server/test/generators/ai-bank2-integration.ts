// Расширение банка ai.ai-integration: +3 Junior, +5 Middle, +4 Senior (решение владельца 11.10).
import { family, fx, sum } from './ai-bank2-util';
import { num, table } from './ai-util';

const SUB = 'ai.ai-integration';

// ---------------------------------------------------------------------------
// Junior
// ---------------------------------------------------------------------------

export const logCostSum = family(
  { id: 'ai.log-cost-sum', taskId: 'task:token-cost', title: 'Сколько стоили успешные вызовы по логу', sub: SUB, grade: 'junior', catalogIds: ['ai.llm-cost', 'ai.llm-api'], a: 1.3, b: -0.8, space: 1e8, time: 210 },
  (rng) => {
    const prices = { small: { i: rng.pick([1, 2]), o: rng.pick([3, 4, 6]) }, large: { i: rng.pick([5, 10]), o: rng.pick([15, 20, 30]) } };
    const rows = Array.from({ length: rng.int(6, 8) }, (_, k) => ({
      id: `r${k + 1}`,
      model: rng.pick(['small', 'large'] as const),
      tin: rng.int(5, 40) * 100,
      tout: rng.int(1, 12) * 100,
      status: rng.pick([200, 200, 200, 429, 500]),
    }));
    const target = rng.pick(['small', 'large'] as const);
    const cents = sum(rows.filter((r) => r.status === 200 && r.model === target).map((r) => (r.tin * prices[target].i + r.tout * prices[target].o) / 1000));
    return {
      prompt: `Лог вызовов LLM. Цены, цент за 1000 токенов: модель small - вход ${prices.small.i}, выход ${prices.small.o}; модель large - вход ${prices.large.i}, выход ${prices.large.o}. Вызовы со статусом не 200 не тарифицируются. Сколько центов стоили успешные вызовы модели ${target}?`,
      code: table(['id', 'модель', 'токенов вход', 'токенов выход', 'статус'], rows.map((r) => [r.id, r.model, r.tin, r.tout, r.status])),
      answerHint: 'центы, до 2 знаков',
      answerKey: fx(cents, 2),
      explanation: `Берём строки модели ${target} со статусом 200 и считаем вход × ${prices[target].i} / 1000 + выход × ${prices[target].o} / 1000: итого ${fx(cents, 2)} цента.`,
      params: { rows: rows.map((r) => `${r.model}:${r.tin}:${r.tout}:${r.status}`).join(','), target },
    };
  },
);

export const logErrorRate = family(
  { id: 'ai.log-error-rate', taskId: 'task:llm-retry', title: 'Доля ошибок по логу вызовов', sub: SUB, grade: 'junior', catalogIds: ['ai.llm-fallback', 'ai.llm-api'], a: 1.3, b: -0.7, space: 1e8, time: 210 },
  (rng) => {
    for (;;) {
      const statuses = Array.from({ length: rng.int(16, 24) }, () => rng.pick([200, 200, 200, 200, 200, 400, 429, 500, 503, 'timeout'] as const));
      const denom = statuses.filter((s) => s !== 400).length;
      const errors = statuses.filter((s) => s === 429 || s === 500 || s === 503 || s === 'timeout').length;
      if (errors === 0 || denom === 0) continue;
      const pct = (errors / denom) * 100;
      if (Math.abs(((pct * 10) % 1) - 0.5) < 0.02) continue;
      return {
        prompt: 'Лог статусов вызовов LLM за час. Ошибкой сервиса считаются 429, 5xx и таймауты. Ответ 400 (неверный запрос от нашего кода) в расчёт доли не входит - ни в ошибки, ни в общее число. Какова доля ошибок, %?',
        code: statuses.map((s, i) => `${i + 1}: ${s}`).join('\n'),
        answerHint: '% до 1 знака',
        answerKey: fx(pct, 1),
        explanation: `Всего без 400: ${denom}; ошибок (429, 5xx, timeout): ${errors}. ${errors} / ${denom} = ${fx(pct, 1)} %.`,
        params: { statuses: statuses.join(',') },
      };
    }
  },
);

export const piiLogLeak = family(
  { id: 'ai.pii-log-leak', taskId: 'task:pii-masking', title: 'Сколько записей лога раскрывают ПДн', sub: SUB, grade: 'junior', catalogIds: ['ai.pii-masking'], a: 1.3, b: -0.9, space: 1e7, time: 180 },
  (rng) => {
    const rows = Array.from({ length: rng.int(10, 16) }, () => {
      const email = rng.pick(['anna@mail.ru', 'h:3fa9c1', '***', 'ivan@corp.ru', 'h:b07e22']);
      const phone = rng.pick(['+79161234567', '+7***4567', 'h:77ad10', '89031112233', '***']);
      const route = rng.pick(['/chat', '/summarize', '/classify']);
      return { email, phone, route };
    });
    const raw = (v: string) => v.includes('@') || /\d{7,}/.test(v);
    const leaks = rows.filter((r) => raw(r.email) || raw(r.phone)).length;
    return {
      prompt: 'В лог запросов к LLM пишутся поля пользователя. Допустимо только маскированное значение: «***», «h:…» (хеш) или телефон с маской «+7***4567». Исходный email или номер телефона целиком - утечка ПДн. Сколько записей лога содержат хотя бы одно немаскированное поле?',
      code: rows.map((r, i) => `${i + 1}. ${r.route} email=${r.email} phone=${r.phone}`).join('\n'),
      answerHint: 'число записей',
      answerKey: String(leaks),
      explanation: `Утечка - запись с полным email (есть «@») или полным номером (7+ цифр подряд): таких ${leaks}.`,
      params: { rows: rows.map((r) => `${r.email}/${r.phone}`).join('|') },
    };
  },
);

// ---------------------------------------------------------------------------
// Middle
// ---------------------------------------------------------------------------

export const traceCriticalPath = family(
  { id: 'ai.trace-critical-path', taskId: 'task:streaming-latency', title: 'Сколько длится запрос по трейсу', sub: SUB, grade: 'middle', catalogIds: ['ai.llm-api'], a: 1.2, b: 0.3, space: 1e8, time: 270 },
  (rng) => {
    const d = { auth: rng.int(3, 15) * 10, search: rng.int(5, 30) * 10, graph: rng.int(5, 30) * 10, rerank: rng.int(4, 20) * 10, guard: rng.int(5, 40) * 10, llm: rng.int(30, 120) * 10, post: rng.int(2, 10) * 10, log: rng.int(5, 20) * 10 };
    const searchEnd = Math.max(d.auth + d.search, d.auth + d.graph);
    const rerankEnd = searchEnd + d.rerank;
    const llmEnd = Math.max(rerankEnd, d.auth + d.guard) + d.llm;
    const total = llmEnd + d.post;
    return {
      prompt: 'Трейс запроса к чат-боту. Спаны запускаются, как только завершились все спаны, от которых они зависят; независимые спаны идут параллельно. Ответ пользователю отдаётся после post; спан log запускается после post и в ответ не входит. Сколько миллисекунд пользователь ждёт ответа?',
      code: table(['спан', 'длительность, мс', 'зависит от'], [
        ['auth', d.auth, '-'],
        ['search', d.search, 'auth'],
        ['graph', d.graph, 'auth'],
        ['rerank', d.rerank, 'search, graph'],
        ['guard', d.guard, 'auth'],
        ['llm', d.llm, 'rerank, guard'],
        ['post', d.post, 'llm'],
        ['log', d.log, 'post'],
      ]),
      answerHint: 'мс',
      answerKey: String(total),
      explanation: `Критический путь: auth ${d.auth} + max(search, graph) ${searchEnd - d.auth} + rerank ${d.rerank} (guard идёт параллельно) + llm ${d.llm} + post ${d.post} = ${total} мс. Спан log в ответ не входит.`,
      params: d,
    };
  },
);

export const sloBurnAlert = family(
  { id: 'ai.slo-burn-alert', taskId: 'task:llm-rate-limit', title: 'Сколько медленных запросов до алерта по SLO', sub: SUB, grade: 'middle', catalogIds: ['ai.llm-api', 'ai.llm-cost'], a: 1.2, b: 0.4, space: 1e9, time: 270 },
  (rng) => {
    for (;;) {
      const slo = rng.pick([1, 2, 5]); // допустимая доля медленных запросов, %
      const rows = Array.from({ length: 10 }, () => {
        const total = rng.pick([200, 400, 500, 1000]);
        const slow = Math.round((total * rng.int(0, 60)) / 1000);
        return { total, slow };
      });
      let first = 0;
      for (let i = 1; i < rows.length; i++) {
        const bad = (r: { total: number; slow: number }) => r.slow * 100 > r.total * slo;
        if (bad(rows[i]!) && bad(rows[i - 1]!)) {
          first = i + 1;
          break;
        }
      }
      if (first === 0) continue;
      return {
        prompt: `SLO: не более ${slo} % запросов дольше 3 секунд в каждом 5-минутном окне. Окно нарушает SLO, если доля медленных строго больше ${slo} %. Алерт срабатывает, когда SLO нарушили два окна подряд (в момент конца второго). В момент первого алерта сколько всего медленных запросов накоплено по окнам с первого до того, на котором сработал алерт (включительно)?`,
        code: table(['окно', 'запросов', 'медленных'], rows.map((r, i) => [i + 1, r.total, r.slow])),
        answerHint: 'число запросов',
        answerKey: String(sum(rows.slice(0, first).map((r) => r.slow))),
        explanation: first ? `Окна ${first - 1} и ${first} подряд выше порога ${slo} % - алерт в окне ${first}; медленных запросов в окнах 1…${first}: ${sum(rows.slice(0, first).map((r) => r.slow))}.` : `Двух нарушающих окон подряд нет - алерта нет.`,
        params: { slo, rows: rows.map((r) => `${r.total}:${r.slow}`).join(',') },
      };
    }
  },
);

export const costAttribution = family(
  { id: 'ai.cost-attribution', taskId: 'task:llm-rate-limit', title: 'Какой клиент дороже всех', sub: SUB, grade: 'middle', catalogIds: ['ai.llm-cost'], a: 1.2, b: 0.5, space: 1e9, time: 300 },
  (rng) => {
    for (;;) {
      const pin = rng.pick([1, 2, 3]);
      const pout = rng.pick([4, 6, 8]);
      const calls = Array.from({ length: 10 }, () => {
        const tin = rng.int(5, 40) * 100;
        return { tenant: rng.pick(['acme', 'bolt', 'cedar', 'delta']), tin, cached: Math.min(tin, rng.int(0, 30) * 100), tout: rng.int(1, 10) * 100 };
      });
      const cost = new Map<string, number>();
      for (const c of calls) {
        // единицы: цена за 1000 токенов × токены; кеш-чтение стоит 10 % цены входа
        const v = ((c.tin - c.cached) * pin * 10 + c.cached * pin + c.tout * pout * 10) / 10;
        cost.set(c.tenant, (cost.get(c.tenant) ?? 0) + v);
      }
      const ranked = [...cost.entries()].sort((a, b) => b[1] - a[1]);
      if (ranked.length < 3 || ranked[0]![1] === ranked[1]![1]) continue;
      return {
        prompt: `Один LLM-шлюз обслуживает нескольких клиентов. Цена, центов за 1000 токенов: вход ${pin}, выход ${pout}. Токены входа, прочитанные из кеша промпта, стоят 10 % цены входа. Сколько центов составит самый большой счёт среди клиентов за период?`,
        code: table(['клиент', 'токенов вход', 'из них из кеша', 'токенов выход'], calls.map((c) => [c.tenant, c.tin, c.cached, c.tout])),
        answerHint: 'центы, до 2 знаков',
        answerKey: fx(ranked[0]![1] / 1000, 2),
        explanation: `Стоимость по клиентам, центы: ${ranked.map(([t, v]) => `${t} ${fx(v / 1000, 2)}`).join(', ')}. Кеш-токены удешевляют вход, поэтому наибольший по токенам клиент не обязательно самый дорогой.`,
        params: { pin, pout, calls: calls.map((c) => `${c.tenant}:${c.tin}:${c.cached}:${c.tout}`).join(',') },
      };
    }
  },
);

export const fallbackAvailability = family(
  { id: 'ai.fallback-availability', taskId: 'task:llm-fallback', title: 'Доступность с ретраями и запасным провайдером', sub: SUB, grade: 'middle', catalogIds: ['ai.llm-fallback'], a: 1.2, b: 0.5, space: 1e5, time: 270 },
  (rng) => {
    const p1 = rng.pick([50, 60, 70, 75, 80, 85, 90]);
    const p2 = rng.pick([50, 60, 70, 80, 90]);
    const r1 = rng.int(0, 2);
    const r2 = rng.int(0, 2);
    const fail = (1 - p1 / 100) ** (r1 + 1) * (1 - p2 / 100) ** (r2 + 1);
    const avail = (1 - fail) * 100;
    return {
      prompt: `Основной провайдер LLM отвечает успешно с вероятностью ${p1} % на каждую попытку; при ошибке делается ещё ${r1} повторов. Если все попытки основного провайдера провалились, запрос уходит запасному (успех ${p2} % на попытку, ещё ${r2} повторов). Попытки независимы. Сколько запросов из миллиона в среднем останутся без ответа (округлите до целого)?`,
      answerHint: 'запросов на миллион',
      answerKey: String(Math.round(fail * 1e6)),
      explanation: `Провал основного: (1 - ${p1 / 100})^${r1 + 1}; провал запасного: (1 - ${p2 / 100})^${r2 + 1}. Запрос не обслужен, только если провалились обе цепочки: ${fx(fail, 6)}. Доступность ${fx(avail, 4)} %, то есть без ответа ${Math.round(fail * 1e6)} запросов из миллиона.`,
      params: { p1, p2, r1, r2 },
    };
  },
);

export const promptVersionFailures = family(
  { id: 'ai.prompt-version-failures', taskId: 'task:extraction-review', title: 'Какая версия промпта ломает разбор чаще', sub: SUB, grade: 'middle', catalogIds: ['ai.structured-output', 'ai.llm-fallback'], a: 1.2, b: 0.3, space: 1e8, time: 240 },
  (rng) => {
    for (;;) {
      const versions = ['v1', 'v2', 'v3', 'v4'].map((v) => {
        const total = rng.int(4, 40) * 50;
        return { v, total, errors: Math.round((total * rng.int(10, 120)) / 1000) };
      });
      const byRate = [...versions].sort((a, b) => b.errors / b.total - a.errors / a.total);
      if (byRate[0]!.errors / byRate[0]!.total === byRate[1]!.errors / byRate[1]!.total) continue;
      if (Math.abs((((byRate[0]!.errors / byRate[0]!.total) * 10000) % 1) - 0.5) < 0.03) continue;
      const byCount = [...versions].sort((a, b) => b.errors - a.errors)[0]!;
      if (byCount.v === byRate[0]!.v && rng.next() < 0.7) continue;
      return {
        prompt: 'Лог ошибок разбора структурированного ответа LLM по версиям промпта. Найдите версию с наибольшей долей ошибок разбора (ошибки / запросы). Чему равна эта доля, %?',
        code: table(['версия', 'запросов', 'ошибок разбора'], versions.map((x) => [x.v, x.total, x.errors])),
        answerHint: '% до 2 знаков',
        answerKey: fx((byRate[0]!.errors / byRate[0]!.total) * 100, 2),
        explanation: `Доли: ${versions.map((x) => `${x.v} ${fx((x.errors / x.total) * 100, 2)} %`).join(', ')}. Наибольшая доля - у ${byRate[0]!.v}. Сравнивать нужно доли, а не абсолютное число ошибок: оно зависит от трафика версии.`,
        params: { versions: versions.map((x) => `${x.total}:${x.errors}`).join(',') },
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Senior
// ---------------------------------------------------------------------------

export const retryStorm = family(
  { id: 'ai.retry-storm', taskId: 'task:llm-retry', title: 'Сколько запросов выдержит провайдер при сбое', sub: SUB, grade: 'senior', catalogIds: ['ai.llm-api', 'ai.llm-fallback'], a: 1.3, b: 1.1, space: 1e9, time: 330 },
  (rng) => {
    const n = rng.int(5, 8);
    const starts = Array.from({ length: n }, () => rng.int(0, 12));
    const base = rng.int(1, 4);
    const maxAttempts = rng.int(4, 6);
    const outageEnd = rng.int(8, 45);
    let total = 0;
    const per: number[] = [];
    for (const s of starts) {
      let t = s;
      let attempts = 0;
      for (let k = 0; k < maxAttempts; k++) {
        attempts++;
        if (t >= outageEnd) break;
        t += base * 2 ** k;
      }
      per.push(attempts);
      total += attempts;
    }
    return {
      prompt: `Провайдер LLM недоступен до секунды ${outageEnd} (любой запрос раньше этого момента падает, начиная с секунды ${outageEnd} - успешен). ${n} клиентов шлют первый запрос в указанную секунду. После ошибки клиент ждёт ${base} с, затем ${base * 2} с, ${base * 4} с и так далее (задержка удваивается, без jitter), всего до ${maxAttempts} попыток; успех прекращает попытки. Сколько всего запросов получит провайдер от всех клиентов (включая успешные)?`,
      code: starts.map((s, i) => `клиент ${i + 1}: первый запрос на ${s}-й секунде`).join('\n'),
      answerHint: 'число запросов',
      answerKey: String(total),
      explanation: `По клиентам: ${per.join(' + ')} = ${total}. Попытки идут в моменты s, s+${base}, s+${base * 3}, s+${base * 7}, … пока не наступит ${outageEnd}-я секунда или не кончатся попытки. Без jitter клиенты повторяют синхронно - так сбой превращается в шторм.`,
      params: { outageEnd, base, maxAttempts, starts: starts.join(',') },
    };
  },
);

export const logSamplingBudget = family(
  { id: 'ai.log-sampling-budget', taskId: 'task:cost-forecast', title: 'Какую долю успешных вызовов логировать', sub: SUB, grade: 'senior', catalogIds: ['ai.llm-cost'], a: 1.2, b: 1.2, space: 1e9, time: 330 },
  (rng) => {
    for (;;) {
      const reqK = rng.int(20, 200) * 10; // тысяч запросов в сутки
      const sizeKb = rng.pick([2, 4, 6, 8, 12]);
      const errPct = rng.pick([1, 2, 3, 5]);
      const days = rng.pick([7, 14, 30]);
      const budgetGb = rng.int(5, 80) * 10;
      const allowedKbPerDay = (budgetGb * 1_000_000) / days;
      const maxRecords = allowedKbPerDay / sizeKb;
      const errRecords = (reqK * 1000 * errPct) / 100;
      const okRecords = reqK * 1000 - errRecords;
      const rate = ((maxRecords - errRecords) / okRecords) * 100;
      if (rate < 5 || rate > 95) continue;
      const answer = Math.floor(rate);
      return {
        prompt: `LLM-шлюз получает ${reqK} тыс. запросов в сутки; полная запись одного вызова (промпт, ответ, метаданные) занимает ${sizeKb} КБ. Ошибочные вызовы (${errPct} % трафика) пишутся всегда, успешные - выборкой. Логи хранятся ${days} суток, на них выделено ${budgetGb} ГБ (1 ГБ = 1 000 000 КБ). Какая максимальная доля успешных вызовов, % (округление вниз до целого), может попадать в лог?`,
        answerHint: '% целое',
        answerKey: String(answer),
        explanation: `В сутки можно хранить ${num(Number((allowedKbPerDay / 1e6).toFixed(3)))} ГБ = ${num(Math.floor(maxRecords))} записей. Ошибки занимают ${num(errRecords)}, остаётся ${num(Math.floor(maxRecords - errRecords))} записей на ${num(okRecords)} успешных: ${fx(rate, 2)} % → ${answer}.`,
        params: { reqK, sizeKb, errPct, days, budgetGb },
      };
    }
  },
);

export const tenantFairShare = family(
  { id: 'ai.tenant-fair-share', taskId: 'task:llm-queue', title: 'Сколько токенов в минуту получит клиент', sub: SUB, grade: 'senior', catalogIds: ['ai.llm-api', 'ai.llm-cost'], a: 1.3, b: 1.3, space: 1e10, time: 360 },
  (rng) => {
    for (;;) {
      const names = ['acme', 'bolt', 'cedar', 'delta'];
      const ts = names.map((name) => {
        const guarantee = rng.int(1, 4) * 10;
        return { name, guarantee, demand: guarantee + rng.int(-1, 12) * 10 + rng.int(0, 5), weight: rng.int(1, 4) };
      });
      for (const t of ts) t.demand = Math.max(t.demand, 10);
      const cap = rng.int(10, 25) * 10;
      const alloc = new Map(ts.map((t) => [t.name, Math.min(t.guarantee, t.demand)]));
      let free = cap - sum([...alloc.values()]);
      if (free <= 0) continue;
      for (let guard = 0; guard < 10 && free > 1e-9; guard++) {
        const open = ts.filter((t) => alloc.get(t.name)! < t.demand - 1e-9);
        if (open.length === 0) break;
        const w = sum(open.map((t) => t.weight));
        let used = 0;
        for (const t of open) {
          const give = Math.min((free * t.weight) / w, t.demand - alloc.get(t.name)!);
          alloc.set(t.name, alloc.get(t.name)! + give);
          used += give;
        }
        free -= used;
      }
      const who = ts[rng.int(0, ts.length - 1)]!;
      const v = alloc.get(who.name)!;
      if (Math.abs((v % 1) - 0.5) < 0.05) continue;
      return {
        prompt: `Лимит провайдера - ${cap} тыс. токенов в минуту на всех клиентов шлюза. Правило: сначала каждому отдаётся min(гарантия, спрос); остаток делится между клиентами с неудовлетворённым спросом пропорционально весам, но не больше спроса; недобор перераспределяется повторно тем же способом. Сколько тысяч токенов в минуту получит клиент ${who.name}? Округлите до целого.`,
        code: table(['клиент', 'гарантия', 'спрос', 'вес'], ts.map((t) => [t.name, t.guarantee, t.demand, t.weight])),
        answerHint: 'тыс. токенов/мин, целое',
        answerKey: String(Math.round(v)),
        explanation: `Итоговое распределение: ${ts.map((t) => `${t.name} ${fx(alloc.get(t.name)!, 2)}`).join(', ')}. Гарантии выданы первыми, затем остаток разделён по весам с ограничением спросом.`,
        params: { cap, who: who.name, ts: ts.map((t) => `${t.guarantee}:${t.demand}:${t.weight}`).join(',') },
      };
    }
  },
);

export const degradationMode = family(
  { id: 'ai.degradation-mode', taskId: 'task:provider-routing', title: 'В каком режиме работать в пик', sub: SUB, grade: 'senior', catalogIds: ['ai.llm-fallback', 'ai.llm-cost'], a: 1.2, b: 1.0, space: 1e9, time: 300 },
  (rng) => {
    for (;;) {
      const modes = [
        { m: 'large', q: rng.int(90, 98), cap: rng.int(2, 12) * 5, cost: rng.int(10, 40) },
        { m: 'small', q: rng.int(72, 85), cap: rng.int(8, 30) * 5, cost: rng.int(3, 9) },
        { m: 'cached', q: rng.int(50, 65), cap: rng.int(20, 80) * 5, cost: rng.int(1, 3) },
        { m: 'static', q: rng.int(15, 30), cap: 1000, cost: 0 },
      ];
      const demand = rng.int(2, 30) * 5; // запросов в секунду
      const budget = rng.int(20, 150) * 5; // $ в час
      const feasible = modes.filter((x) => x.cap >= demand && (demand * x.cost * 18) / 5 <= budget);
      const best = [...feasible].sort((a, b) => b.q - a.q)[0]!;
      const ranked = modes.filter((x) => x.cap >= demand).length;
      if (ranked === 4 && best.m === 'large' && rng.next() < 0.7) continue;
      return {
        prompt: `Пиковая нагрузка - ${demand} запросов в секунду, бюджет на LLM - ${budget} $ в час. Режимы работы шлюза: у каждого своя оценка качества, пропускная способность (запросов в секунду) и цена за 1000 запросов. Режим подходит, если его пропускной способности хватает на пик и расходы за час (${demand} × 3600 / 1000 × цена) не больше бюджета. Выберите режим с наилучшим качеством. Какова его оценка качества?`,
        code: table(['режим', 'качество', 'пропускная способность, rps', 'цена за 1000 запросов, $'], modes.map((x) => [x.m, x.q, x.cap, x.cost])),
        answerHint: 'оценка качества режима',
        answerKey: String(best.q),
        explanation: `Расход за час = ${demand} × 3,6 × цена. Подходят по ёмкости и бюджету: ${feasible.map((x) => x.m).join(', ')}. Лучшее качество - у ${best.m}: ${best.q}.`,
        params: { demand, budget, modes: modes.map((x) => `${x.m}:${x.q}:${x.cap}:${x.cost}`).join(',') },
      };
    }
  },
);

export const AI_BANK2_INTEGRATION = [
  logCostSum,
  logErrorRate,
  piiLogLeak,
  traceCriticalPath,
  sloBurnAlert,
  costAttribution,
  fallbackAvailability,
  promptVersionFailures,
  retryStorm,
  logSamplingBudget,
  tenantFairShare,
  degradationMode,
];
