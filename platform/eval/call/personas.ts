// Валидация ступени 1 ADR 0003 — квалифицирующий созвон: персоны-кандидаты (LLM-актёр с заданным
// профилем знаний) проходят созвон через сервисный слой (startCall → submitTurn → finishCall), оценщик
// созвона сам делает 3 прогона и берёт медиану. Метрики: доля подтверждённых тем, совпадение с ожиданием
// по легенде, повторяемость оценщика (между прогонами одного транскрипта и между созвонами), вызовы LLM.
//
// Запуск из platform/ (нужна отдельная БД: EVAL_DATABASE_URL или DATABASE_URL с validation/eval/test в имени):
//   npm run eval:call -- --stub          # детерминированно, без ключей (проверка конвейера)
//   npm run eval:call                    # живая модель из .env; uptime перед запуском, вызовы последовательные
//   npm run eval:call -- --calls 1 --persona A
//
// Честная граница: персоны — симуляция LLM-актёром, не люди; n маленький (3 созвона на персону).
import { STUB } from '../stages/boot';

import { finishCall, startCall, submitTurn } from '../../src/server/call/service';
import type { CallVerdict, TranscriptEntry } from '../../src/server/call/types';
import { callTables, diffMeter, summarizeCallPersona, type CallObs, type CallTopicObs } from '../stages/metrics';
import { argValue, createCandidate, ensureCatalog, personaAnswer, prisma, providers, runTag, snapshot, writeResult, type PersonaProfile } from '../stages/runtime';

type Depth = 'deep' | 'shallow' | 'bluff' | 'weak';

interface TopicSpec {
  catalogId: string;
  /** Утверждение в профиле (как его извлёк бы консультант из резюме). */
  statement: string;
  /** Цитата резюме — интервьюер видит, оценщику она вырезается. */
  quote: string;
  depth: Depth;
  /** Что персонаж знает по теме (для актёра). */
  knows: string;
  /** Ожидание: тема должна подтвердиться. */
  expected: boolean;
}

interface CallPersona {
  id: string;
  title: string;
  grade: 'junior' | 'middle';
  legend: string;
  style: string;
  topics: TopicSpec[];
}

const CALL_PERSONAS: CallPersona[] = [
  {
    id: 'A',
    title: '(a) сильный Junior',
    grade: 'junior',
    legend: 'Backend-разработчик, 1 год стажировки и работы в продуктовой команде (Node.js/Express, PostgreSQL) плюс свой pet-проект — сервис заказов для кофейни.',
    style: 'Отвечает честно и конкретно, с примерами из своего проекта и цифрами, объясняет, почему выбрал так и что было альтернативой. На вопросы за пределами опыта спокойно говорит, где кончается его знание, и как бы проверил.',
    topics: [
      {
        catalogId: 'be.rest-design',
        statement: 'Проектировал REST API сервиса заказов',
        quote: 'спроектировал REST API заказов: ресурсы, коды ошибок, пагинация',
        depth: 'deep',
        expected: true,
        knows: 'Сам проектировал API заказов: ресурсы /orders, /orders/{id}/items; 201 с Location при создании, 404, 409 при конфликте статуса, 422 при ошибке валидации. Пагинацию сделал курсором по (created_at, id), а не offset: offset тормозит на больших страницах и даёт дубли при вставках во время листания; цена — нельзя прыгнуть на произвольную страницу. Версию держит в пути /v1. Публичный API для внешних клиентов не проектировал, HATEOAS не делал.',
      },
      {
        catalogId: 'be.sql-schema',
        statement: 'Проектировал схему БД для заказов',
        quote: 'схема PostgreSQL: заказы, позиции, внешние ключи и ограничения',
        depth: 'deep',
        expected: true,
        knows: 'Схема до 3НФ: orders, order_items, products; внешние ключи с ON DELETE RESTRICT для товаров, CHECK quantity > 0, UNIQUE (order_id, product_id). Цену товара копирует в позицию заказа намеренно — цена товара меняется, а заказ должен помнить цену на момент покупки. Денормализовал счётчик позиций в orders ради списка заказов, цена — риск рассинхрона, держит его в той же транзакции. Партиционирование таблиц не делал и честно этого не знает.',
      },
      {
        catalogId: 'be.authz',
        statement: 'Проверял права доступа к заказам',
        quote: 'проверка владельца заказа и ролей, защита от IDOR',
        depth: 'deep',
        expected: true,
        knows: 'Проверка владельца в сервисном слое одной функцией canAccessOrder(user, order), а не в каждом роуте; для чужого заказа возвращает 404, а не 403, чтобы не раскрывать, что такой id существует. Роли: покупатель и бариста. Интеграционный тест на IDOR: пользователь B запрашивает заказ A — 404. ABAC и политики во внешнем сервисе не делал.',
      },
      {
        catalogId: 'be.integration-tests',
        statement: 'Писал интеграционные тесты API с реальной БД',
        quote: 'интеграционные тесты с PostgreSQL в контейнере',
        depth: 'deep',
        expected: true,
        knows: 'Testcontainers с PostgreSQL, миграции прогоняются перед набором, между тестами TRUNCATE ... RESTART IDENTITY. Откат транзакции не подошёл, потому что код сервиса сам открывает транзакции. Набор идёт около 40 секунд; распараллеливать по отдельным базам не пробовал — знает, что так делают, но сам не настраивал.',
      },
    ],
  },
  {
    id: 'B',
    title: '(b) новичок',
    grade: 'junior',
    legend: 'Выпускник трёхмесячных курсов backend-разработки, кроме учебного todo-приложения по видеоуроку ничего не делал.',
    style: 'Старается ответить, но знает только выученные определения из конспекта. На вопросы «почему так», «что выбрал бы», «что сломается» повторяет определение или говорит общими словами; своих решений и цифр привести не может, потому что их не было. Не врёт про продакшен-опыт.',
    topics: [
      {
        catalogId: 'be.rest-design',
        statement: 'Делал REST API',
        quote: 'REST API для todo-приложения на курсе',
        depth: 'shallow',
        expected: false,
        knows: 'Определение: REST — архитектурный стиль, ресурсы, методы GET/POST/PUT/DELETE, коды 200, 404, 500. В учебном todo роуты были по уроку. Про пагинацию, версионирование, 409/422 не знает.',
      },
      {
        catalogId: 'be.sql-schema',
        statement: 'Проектировал схему базы данных',
        quote: 'база данных PostgreSQL, таблицы и связи',
        depth: 'shallow',
        expected: false,
        knows: 'Определения: первичный ключ, внешний ключ, нормальные формы — «чтобы не было дублирования». В todo была одна таблица tasks. Ограничения CHECK/UNIQUE, денормализацию, индексы на практике не применял.',
      },
      {
        catalogId: 'be.cache',
        statement: 'Использовал кэширование',
        quote: 'кэширование с Redis',
        depth: 'shallow',
        expected: false,
        knows: 'Определение: кэш — хранение данных в быстрой памяти, Redis — хранилище ключ-значение, TTL — время жизни. На курсе был один урок про Redis, в проекте не использовал. Инвалидацию и «лавину промахов» не знает.',
      },
    ],
  },
  {
    id: 'C',
    title: '(c) резюме с чужими проектами',
    grade: 'middle',
    legend: 'Заявляет 3 года backend в финтехе: платёжный шлюз на Kafka с outbox и сагами. На деле резюме переписано с проекта коллеги, сам делал CRUD-админку и правил вёрстку писем; архитектуру шлюза знает по докладам и созвонам команды.',
    style: 'Уверенно и бегло говорит термины и общую картину («у нас был outbox, Kafka, идемпотентность»). Когда просят конкретику — почему так, какие были альтернативы, что именно делал сам, цифры, что сломается — плывёт: «так решил архитектор», «так было принято», уходит в общие слова, путает детали (например, гарантии доставки), меняет тему. Не признаётся, что проект чужой.',
    topics: [
      {
        catalogId: 'be.message-queue',
        statement: 'Обрабатывал сообщения из Kafka в платёжном шлюзе',
        quote: 'консьюмеры Kafka для платёжных событий',
        depth: 'bluff',
        expected: false,
        knows: 'Слышал: топики, партиции, консьюмер-группы, «commit offset». Не знает, когда коммитить offset относительно обработки, как устроена повторная доставка, DLQ, порядок внутри партиции. Путает at-least-once и exactly-once.',
      },
      {
        catalogId: 'be.idempotency',
        statement: 'Делал идемпотентную обработку платежей',
        quote: 'ключи идемпотентности для платежей',
        depth: 'bluff',
        expected: false,
        knows: 'Знает слова «ключ идемпотентности», «чтобы не списать дважды». Где ключ хранится, как ведёт себя повтор при незавершённой первой попытке, уникальное ограничение — не знает.',
      },
      {
        catalogId: 'be.distributed-consistency',
        statement: 'Согласовывал данные между сервисами через outbox и саги',
        quote: 'transactional outbox и саги с компенсациями',
        depth: 'bluff',
        expected: false,
        knows: 'Знает определения: outbox — таблица исходящих событий, сага — цепочка шагов с компенсациями. Почему outbox, а не отправка в Kafka в транзакции, кто читает таблицу и что при дублях — не знает.',
      },
      {
        catalogId: 'be.cache',
        statement: 'Кэшировал данные в Redis',
        quote: 'кэш курсов валют в Redis',
        depth: 'bluff',
        expected: false,
        knows: 'Знает, что «курсы валют кэшировали в Redis с TTL». Стратегию инвалидации и защиту от лавины промахов не знает.',
      },
    ],
  },
  {
    id: 'D',
    title: '(d) Middle с одной слабой темой',
    grade: 'middle',
    legend: 'Backend-разработчик, 4 года Java/Spring и PostgreSQL в сервисе бронирований. Очереди сообщений трогал мало: подключал RabbitMQ через готовую обёртку другой команды.',
    style: 'По своим темам отвечает глубоко: механизм, альтернативы, цена решения, замеры, границы применимости. По очередям честно говорит, что глубоко не разбирался, и рассказывает только то, что видел сам.',
    topics: [
      {
        catalogId: 'be.sql-indexes',
        statement: 'Подбирал индексы и читал планы запросов',
        quote: 'оптимизировал запросы бронирований индексами и EXPLAIN ANALYZE',
        depth: 'deep',
        expected: true,
        knows: 'Составной индекс (hotel_id, check_in) под поиск свободных номеров: равенство первым, диапазон вторым. Читает EXPLAIN (ANALYZE, BUFFERS): seq scan из-за низкой селективности, index-only scan с INCLUDE. Частичный индекс WHERE status = active уменьшил индекс в 5 раз. Цена индексов — запись медленнее, bloat; лишние индексы находил по pg_stat_user_indexes. Запрос поиска ускорил с 1,8 с до 30 мс.',
      },
      {
        catalogId: 'be.transactions',
        statement: 'Работал с транзакциями и уровнями изоляции',
        quote: 'устранил двойное бронирование номера на уровне транзакций',
        depth: 'deep',
        expected: true,
        knows: 'Двойное бронирование — lost update / write skew на READ COMMITTED. Рассматривал SERIALIZABLE (ретраи при ошибке сериализации 40001, рост отказов под нагрузкой) и SELECT ... FOR UPDATE по строке номера; выбрал FOR UPDATE плюс exclusion constraint по диапазону дат как страховку. Знает аномалии: грязное, неповторяющееся чтение, фантомы; в PostgreSQL REPEATABLE READ — снимок, фантомов нет, но write skew возможен.',
      },
      {
        catalogId: 'be.idempotency',
        statement: 'Делал идемпотентную обработку платежей за бронь',
        quote: 'идемпотентные запросы оплаты брони',
        depth: 'deep',
        expected: true,
        knows: 'Ключ идемпотентности от клиента в заголовке, таблица idempotency_keys с UNIQUE(key), статус in_progress/done, сохранённый ответ; повтор с тем же ключом при in_progress — 409, при done — сохранённый ответ; ключи живут 24 часа. Почему не Redis: при рестарте потеря ключей дала бы двойное списание. Тело запроса с тем же ключом, но другим содержимым — 422.',
      },
      {
        catalogId: 'be.message-queue',
        statement: 'Работал с RabbitMQ',
        quote: 'отправка уведомлений через RabbitMQ',
        depth: 'weak',
        expected: false,
        knows: 'Подключал RabbitMQ через готовую библиотеку-обёртку другой команды: вызывал publish и писал обработчик. Слышал про ack, но когда подтверждать, что будет при падении обработчика, повторная доставка, DLQ, порядок — не знает и честно это говорит.',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Детерминированный актёр для --stub (без LLM): ответ по глубине знания темы и уровню вопроса.
// ---------------------------------------------------------------------------
function stubAnswer(p: CallPersona, catalogId: string | null, level: number): string {
  const t = p.topics.find((x) => x.catalogId === catalogId) ?? p.topics[0]!;
  switch (t.depth) {
    case 'deep':
      return `На практике делал это сам. ${t.knows.split('. ').slice(0, 2).join('. ')}. Выбрал так, потому что альтернатива была дороже в поддержке. Не уверен, как это поведёт себя при росте нагрузки в десять раз, проверил бы нагрузочным тестом. В итоге решение работает в проде.`;
    case 'shallow':
      return level >= 2 ? 'Ну, это нужно, чтобы всё работало правильно, так принято делать.' : `Это когда ${t.knows.split('. ')[0]!.toLowerCase()}.`;
    case 'bluff':
      return level >= 2 ? 'Так решил архитектор, у нас так было принято в команде, все так делают.' : `У нас в проекте это было: ${t.knows.split('. ')[0]!.toLowerCase()}, всё как положено, стандартная схема.`;
    case 'weak':
      return 'Не знаю, глубоко не разбирался.';
  }
}

function profileFor(p: CallPersona): PersonaProfile {
  return {
    id: p.id,
    legend: `${p.legend} Заявленный грейд: ${p.grade === 'middle' ? 'Middle' : 'Junior'}.`,
    style: p.style,
    knowledge: p.topics.map((t) => `- ${t.statement} (${t.catalogId}): ${t.knows}`).join('\n'),
  };
}

async function seedCandidate(p: CallPersona, id: string): Promise<void> {
  await createCandidate(id, { grade: p.grade });
  await prisma.claim.createMany({
    data: p.topics.map((t, i) => ({
      id: `${id}-cl${i + 1}`,
      candidateId: id,
      catalogId: t.catalogId,
      statement: t.statement,
      level: 'self_reported' as const,
      quote: t.quote,
      sourceRef: `cv#${i + 1}`,
      sourceKind: 'resume' as const,
      limits: '',
      suggestedProof: [],
      status: 'confirmed' as const,
    })),
  });
}

const MAX_TURNS = 8;

async function runCall(p: CallPersona, n: number, tag: string, llm: ReturnType<typeof providers>): Promise<CallObs> {
  const id = `eval-${tag}-${p.id}${n}`;
  const before = { platform: snapshot(llm.platform.meter), persona: snapshot(llm.persona.meter) };
  const base = { persona: p.id, call: n, sessionId: '', questions: 0, fallbackQuestions: 0, validRuns: 0, topics: [] as CallTopicObs[] };
  try {
    await seedCandidate(p, id);
    const profile = profileFor(p);
    const started = await startCall(id, { kind: 'qualifying' }, llm.platform);
    const sessionId = started.sessionId;
    let transcript: TranscriptEntry[] = started.call.transcript ?? [];
    const history: { q: string; a: string | null }[] = [];
    let current = transcript[transcript.length - 1];
    for (let turn = 0; turn < MAX_TURNS && current?.role === 'ai' && current.meta; turn++) {
      history.push({ q: current.text, a: null });
      const answer = STUB ? stubAnswer(p, current.meta.catalogId, current.meta.level) : await personaAnswer(llm.persona, profile, history);
      history[history.length - 1]!.a = answer;
      const res = await submitTurn(id, sessionId, { text: answer.slice(0, 3900) }, llm.platform);
      transcript = [...transcript, res.candidate, ...(res.ai ? [res.ai] : [])];
      current = res.done ? undefined : (res.ai ?? undefined);
    }
    const view = await finishCall(id, sessionId, llm.platform);
    const verdict = view.verdict as CallVerdict | null;
    const expected = new Map(p.topics.map((t) => [t.catalogId, t.expected]));
    const asked = transcript.filter((e) => e.role === 'ai' && e.meta);
    return {
      ...base,
      sessionId,
      questions: asked.length,
      fallbackQuestions: asked.filter((e) => e.meta?.fallback).length,
      validRuns: verdict?.validRuns ?? 0,
      topics: (verdict?.depthMap ?? []).map((d) => ({
        topic: d.topic,
        catalogId: d.catalogId,
        expected: d.catalogId && expected.has(d.catalogId) ? expected.get(d.catalogId)! : null,
        confirmed: d.confirmed,
        total: d.total,
        probed: d.probed,
        maxLevel: d.maxLevel,
        runs: d.runs,
      })),
      platform: diffMeter(llm.platform.meter, before.platform),
      persona_llm: diffMeter(llm.persona.meter, before.persona),
      ...(view.status !== 'finished' ? { error: `созвон в статусе ${view.status}` } : {}),
    };
  } catch (err) {
    return {
      ...base,
      platform: diffMeter(llm.platform.meter, before.platform),
      persona_llm: diffMeter(llm.persona.meter, before.persona),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  const calls = Number(argValue('calls') ?? 3);
  const only = argValue('persona');
  const personas = CALL_PERSONAS.filter((p) => !only || only.split(',').includes(p.id));
  const tag = `${STUB ? 's' : 'l'}${runTag()}`;
  await ensureCatalog();
  const llm = providers();
  console.log(`eval:call — провайдер ${llm.platform.name}/${llm.platform.model}, персон ${personas.length}, созвонов на персону ${calls}`);
  const obs: CallObs[] = [];
  for (const p of personas) {
    for (let n = 1; n <= calls; n++) {
      const t0 = Date.now();
      const o = await runCall(p, n, tag, llm);
      obs.push(o);
      const conf = o.topics.map((t) => `${t.catalogId}:${t.confirmed ? '✓' : '✗'}${t.total}`).join(' ');
      console.log(`  ${p.id}${n}: ${o.error ? `ОШИБКА ${o.error}` : conf} · вопросов ${o.questions} · LLM ${o.platform.calls}+${o.persona_llm.calls} · ${Math.round((Date.now() - t0) / 1000)} с`);
    }
  }
  const summaries = personas.map((p) =>
    summarizeCallPersona(
      p.id,
      Object.fromEntries(p.topics.map((t) => [t.catalogId, t.expected])),
      obs.filter((o) => o.persona === p.id),
    ),
  );
  const legends = Object.fromEntries(personas.map((p) => [p.id, p.title]));
  const md = callTables(summaries, legends);
  const file = writeResult(`call-${STUB ? 'stub' : 'live'}.json`, {
    stage: 1,
    provider: `${llm.platform.name}/${llm.platform.model}`,
    stub: STUB,
    runAt: new Date().toISOString(),
    calls,
    summaries,
    observations: obs,
    totals: { platform: llm.platform.meter, persona: llm.persona.meter },
  });
  console.log(`\n${md}\n\nВсего вызовов LLM: платформа ${llm.platform.meter.calls} (ошибок ${llm.platform.meter.failures}), персоны ${llm.persona.meter.calls}; токены платформы ${llm.platform.meter.inputTokens} вх / ${llm.platform.meter.outputTokens} вых.`);
  console.log(`Результат: ${file}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
