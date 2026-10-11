// Задержка созвона «конец речи → первый звук ответа» по шагам (лейн call-speed, 11.10). Один квалифицирующий
// созвон через сервисный слой, как персоны (startCall → addAudio → submitTurn), N ходов на живых сервисах:
//   STT  — addAudio с WAV-фразой (SpeechKit v1, синхронный REST), Server-Timing `stt` в проде;
//   LLM  — submitTurn: до первого предложения (CALL_STREAMING=true) и до конца;
//   TTS  — synthesizeYandex: вся реплика одним запросом (как панель консультанта до 11.10) и первое предложение.
// «Первый звук» на сервере = STT + LLM (до конца или до первого предложения) + TTS (всей реплики или первой части).
// Сеть до браузера и decodeAudioData сюда не входят — их видно только в браузере (window.__fspCallLatency).
//
// Запуск из platform/ (отдельная БД, как у персон; uptime перед запуском, вызовы последовательные):
//   CALL_STREAMING=false npx tsx eval/call/latency.ts --out before   # ответ модели целиком
//   CALL_STREAMING=true  npx tsx eval/call/latency.ts --out stream   # поток + синтез по предложениям
//   ... --turns 5
// Ответы кандидата — заготовленные тексты (смысл для интервьюера), WAV одной фразы — только для замера STT
// (фраза синтезирована SpeechKit, lpcm 16 кГц: не живой голос, распознаётся легче).
import { STUB } from '../stages/boot';

import { addAudio, startCall, submitTurn } from '../../src/server/call/service';
import type { TurnTiming } from '../../src/server/call/service';
import type { TranscriptEntry } from '../../src/server/call/types';
import { getEnv } from '../../src/server/env';
import { yandexAuthHeader } from '../../src/server/llm/providers/yandex-responses';
import { synthesizeYandex, TTS_URL } from '../../src/server/tts';
import { cleanForSpeech } from '../../src/lib/speech-text';
import { splitSentences } from '../../src/lib/sentences';
import { argValue, createCandidate, ensureCatalog, prisma, providers, runTag, writeResult } from '../stages/runtime';

const PHRASE = 'Я бы начал с индекса по полю заказа и проверил план запроса через explain analyze, потом посмотрел бы на блокировки.';

const ANSWERS = [
  'Проектировал API заказов: ресурсы orders и items, при создании отдаю 201 и Location, при конфликте статуса 409, при ошибке валидации 422. Пагинацию сделал курсором по created_at и id, потому что offset тормозит и даёт дубли.',
  'Схема в третьей нормальной форме: orders, order_items, products, внешние ключи с restrict, check на количество больше нуля. Цену копирую в позицию заказа, потому что цена товара меняется, а заказ должен помнить цену покупки.',
  'Права проверяю в сервисном слое одной функцией: владелец заказа или бариста. Для чужого заказа возвращаю 404, а не 403, чтобы не раскрывать, что такой id есть. Есть интеграционный тест на IDOR.',
  'Интеграционные тесты гоняю с PostgreSQL в контейнере: перед каждым тестом транзакция и откат, фикстуры фабриками. Проверяю коды ответов и состояние базы после запроса.',
  'Не знаю точно, как это устроено внутри, но я бы начал с замера: включил бы логирование медленных запросов и посмотрел план выполнения, потом решал бы про индекс.',
  'Для очереди уведомлений взял бы отдельную таблицу outbox и воркер: запись события в той же транзакции, что и заказ, а отправка асинхронно с повтором и идемпотентным ключом.',
];

const TOPICS = [
  { catalogId: 'be.rest-design', statement: 'Проектировал REST API сервиса заказов', quote: 'спроектировал REST API заказов: ресурсы, коды ошибок, пагинация' },
  { catalogId: 'be.sql-schema', statement: 'Проектировал схему БД для заказов', quote: 'схема PostgreSQL: заказы, позиции, внешние ключи и ограничения' },
  { catalogId: 'be.authz', statement: 'Проверял права доступа к заказам', quote: 'проверка владельца заказа и ролей, защита от IDOR' },
  { catalogId: 'be.integration-tests', statement: 'Писал интеграционные тесты API с реальной БД', quote: 'интеграционные тесты с PostgreSQL в контейнере' },
];

/** Фраза → LPCM 16 кГц через SpeechKit v1 (format=lpcm): «WAV-фраза» без файла в репозитории. */
async function phrasePcm(): Promise<Uint8Array> {
  const env = getEnv();
  const form = new URLSearchParams({ text: PHRASE, lang: 'ru-RU', voice: 'filipp', format: 'lpcm', sampleRateHertz: '16000' });
  const res = await fetch(TTS_URL, { method: 'POST', headers: { Authorization: yandexAuthHeader(env.YANDEX_API_KEY as string), 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  if (!res.ok) throw new Error(`TTS lpcm: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Время синтеза, мс; сбой SpeechKit — NaN (в таблицу не идёт, ход считается дальше). */
async function tts(text: string): Promise<number> {
  const env = getEnv();
  const t0 = Date.now();
  try {
    await synthesizeYandex(cleanForSpeech(text), { apiKey: env.YANDEX_API_KEY as string, folderId: env.YANDEX_FOLDER_ID, voice: env.TTS_VOICE, emotion: env.TTS_EMOTION || undefined, speed: env.TTS_SPEED, format: env.TTS_FORMAT });
  } catch (err) {
    console.warn('  TTS сбой:', err instanceof Error ? err.message : err);
    return NaN;
  }
  return Date.now() - t0;
}

export interface TurnSample {
  turn: number;
  sttMs: number;
  llmMs: number;
  firstSentenceMs: number | null;
  sentences: number;
  ttsFullMs: number;
  ttsFirstMs: number;
  replyChars: number;
  firstChars: number;
  fallback: boolean;
  streamCut: boolean;
  /** Первый звук на сервере: целиком (панель до 11.10), по предложениям без потока, поток + предложения. */
  firstSoundFull: number;
  firstSoundSentence: number;
  firstSoundStream: number | null;
}

export function percentile(xs: readonly number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i]!;
}

async function main(): Promise<void> {
  if (STUB) throw new Error('latency: только живые сервисы (без --stub)');
  const turns = Number(argValue('turns') ?? 5);
  const streaming = getEnv().CALL_STREAMING;
  await ensureCatalog();
  const llm = providers();
  const id = `eval-lat-${runTag()}`;
  await createCandidate(id, { grade: 'junior' });
  await prisma.claim.createMany({
    data: TOPICS.map((t, i) => ({ id: `${id}-cl${i + 1}`, candidateId: id, catalogId: t.catalogId, statement: t.statement, level: 'self_reported' as const, quote: t.quote, sourceRef: `cv#${i + 1}`, sourceKind: 'resume' as const, limits: '', suggestedProof: [], status: 'confirmed' as const })),
  });
  // SpeechKit недоступен — секунда тишины: STT тогда вернёт сбой (NaN), остальные шаги меряются.
  const pcm = await phrasePcm().catch((err: unknown) => {
    console.warn('  фраза не синтезирована:', err instanceof Error ? err.message : err);
    return new Uint8Array(32000);
  });
  console.log(`latency — ${llm.platform.name}/${llm.platform.model}, CALL_STREAMING=${streaming}, ходов ${turns}, фраза ${(pcm.byteLength / 32000).toFixed(1)} с`);
  const started = await startCall(id, { kind: 'qualifying' }, llm.platform);
  const sessionId = started.sessionId;
  let current: TranscriptEntry | undefined = started.call.transcript?.at(-1);
  const samples: TurnSample[] = [];
  for (let n = 0; n < turns && current?.role === 'ai' && current.meta; n++) {
    const sttObs: { sttMs?: number } = {};
    const audio = await addAudio(id, sessionId, pcm, sttObs);
    const obs: { timing?: TurnTiming } = {};
    const res = await submitTurn(id, sessionId, { text: ANSWERS[n % ANSWERS.length]!, audioRef: audio.audioRef }, llm.platform, obs);
    const reply = res.ai?.text ?? '';
    const first = splitSentences(reply)[0] ?? reply;
    const ttsFullMs = await tts(reply);
    const ttsFirstMs = await tts(first);
    const t = obs.timing!;
    const sttMs = sttObs.sttMs ?? NaN;
    const s: TurnSample = {
      turn: n + 1,
      sttMs,
      llmMs: t.llmMs,
      firstSentenceMs: t.firstSentenceMs,
      sentences: t.sentences,
      ttsFullMs,
      ttsFirstMs,
      replyChars: reply.length,
      firstChars: first.length,
      fallback: Boolean(res.ai?.meta?.fallback),
      streamCut: Boolean((res.ai?.meta as { streamCut?: boolean } | undefined)?.streamCut),
      firstSoundFull: sttMs + t.llmMs + ttsFullMs,
      firstSoundSentence: sttMs + t.llmMs + ttsFirstMs,
      firstSoundStream: t.firstSentenceMs !== null ? sttMs + t.firstSentenceMs + ttsFirstMs : null,
    };
    samples.push(s);
    console.log(`  ход ${s.turn}: STT ${s.sttMs} · LLM ${s.llmMs} (1-е предл. ${s.firstSentenceMs ?? '—'}) · TTS всё ${s.ttsFullMs} / 1-е ${s.ttsFirstMs} · ${s.replyChars} зн.${s.fallback ? ' · шаблон' : ''}${s.streamCut ? ' · обрезано' : ''}`);
    current = res.done ? undefined : (res.ai ?? undefined);
  }
  const col = (k: keyof TurnSample) => samples.map((x) => x[k]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const keys: (keyof TurnSample)[] = ['sttMs', 'firstSentenceMs', 'llmMs', 'ttsFirstMs', 'ttsFullMs', 'firstSoundFull', 'firstSoundSentence', 'firstSoundStream'];
  const table = Object.fromEntries(keys.map((k) => [k, { p50: percentile(col(k), 50), p90: percentile(col(k), 90), n: col(k).length }]));
  console.log('\n| шаг | p50, мс | p90, мс | n |\n|---|---|---|---|');
  for (const k of keys) console.log(`| ${k} | ${table[k]!.p50} | ${table[k]!.p90} | ${table[k]!.n} |`);
  const file = writeResult(`call-latency-${argValue('out') ?? (streaming ? 'stream' : 'nostream')}-${new Date().toISOString().slice(0, 10)}.json`, {
    provider: `${llm.platform.name}/${llm.platform.model}`,
    streaming,
    runAt: new Date().toISOString(),
    turns: samples.length,
    table,
    samples,
  });
  console.log(`Результат: ${file}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
