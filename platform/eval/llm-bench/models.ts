// Модели замера: общие для run.ts (диалоги § 6.2) и compare.ts (извлечение боевым промптом).
import { createOpenAiChatProvider } from '../../src/server/llm/providers/openai-chat';
import { createStubProvider } from '../../src/server/llm/providers/stub';
import { createYandexResponsesProvider, yandexAuthHeader } from '../../src/server/llm/providers/yandex-responses';
import type { LlmProvider } from '../../src/server/llm/types';

export interface ModelDef {
  id: string;
  title: string;
  /** env, без которых модель пропускается */
  requiredEnv: string[];
  make(planB: boolean): LlmProvider;
  /** $ за 1M токенов вход/выход, null – не известно */
  price: { in: number; out: number } | null;
}
export const env = (k: string) => process.env[k]?.trim() || '';
const envPrice = (prefix: string, def: { in: number; out: number } | null) =>
  env(`${prefix}_PRICE_IN`) && env(`${prefix}_PRICE_OUT`)
    ? {
        in: Number(env(`${prefix}_PRICE_IN`)),
        out: Number(env(`${prefix}_PRICE_OUT`)),
      }
    : def;
const YANDEX_BASE = () =>
  env('YANDEX_BASE_URL') || 'https://ai.api.cloud.yandex.net/v1';

export function makeModels(TIMEOUT_MS: number): Record<string, ModelDef> {
  return {
    // Самопроверка скрипта без сети: заглушка проходит сценарий read_document → propose_claims → ответ.
    stub: {
      id: 'stub',
      title: 'stub (самопроверка метрик, не модель)',
      requiredEnv: [],
      price: null,
      make: (planB) => {
        const p = createStubProvider();
        return { ...p, supportsTools: !planB, complete: p.complete };
      },
    },
    alice: {
      id: 'alice',
      title: 'Alice AI LLM (Yandex Responses API)',
      requiredEnv: ['YANDEX_API_KEY', 'YANDEX_FOLDER_ID'],
      price: envPrice('BENCH_ALICE', { in: 4.1, out: 9.84 }),
      make: (planB) =>
        createYandexResponsesProvider({
          apiKey: env('YANDEX_API_KEY'),
          folderId: env('YANDEX_FOLDER_ID'),
          model: env('BENCH_ALICE_MODEL') || 'aliceai-llm',
          baseUrl: YANDEX_BASE(),
          supportsTools: !planB,
          timeoutMs: TIMEOUT_MS,
        }),
    },
    giga: {
      id: 'giga',
      title: 'GigaChat 3.5 Ultra (Cloud.ru, Chat Completions)',
      requiredEnv: ['CLOUDRU_API_KEY', 'BENCH_GIGA_MODEL'],
      price: envPrice('BENCH_GIGA', null),
      make: (planB) =>
        createOpenAiChatProvider({
          name: 'cloudru',
          baseUrl:
            env('CLOUDRU_BASE_URL') ||
            'https://foundation-models.api.cloud.ru/v1',
          apiKey: env('CLOUDRU_API_KEY'),
          model: env('BENCH_GIGA_MODEL'),
          supportsTools: !planB,
          timeoutMs: TIMEOUT_MS,
        }),
    },
    deepseek: {
      id: 'deepseek',
      title: 'DeepSeek V4 Flash (Yandex, OpenAI-совместимый Chat Completions)',
      requiredEnv: ['YANDEX_API_KEY', 'YANDEX_FOLDER_ID', 'BENCH_DEEPSEEK_MODEL'],
      price: envPrice('BENCH_DEEPSEEK', { in: 2.46, out: 4.1 }),
      make: (planB) => {
        const folder = env('YANDEX_FOLDER_ID');
        const model = env('BENCH_DEEPSEEK_MODEL');
        return createOpenAiChatProvider({
          name: 'yandex-openai',
          baseUrl: YANDEX_BASE(),
          apiKey: env('YANDEX_API_KEY'),
          model: model.startsWith('gpt://') ? model : `gpt://${folder}/${model}`,
          headers: {
            Authorization: yandexAuthHeader(env('YANDEX_API_KEY')),
            'OpenAI-Project': folder,
          },
          supportsTools: !planB,
          timeoutMs: TIMEOUT_MS,
        });
      },
    },
    // Selectel Dedicated Inference (vLLM, OpenAI-совместимый, Bearer; ключ на сервис). Оплата за GPU-час,
    // не за токены – стоимость в таблице 0, считать по времени работы сервиса.
    ...selectelModel('qwen', 'SELECTEL_QWEN', 'qwen3-8-flash-next (Selectel)', TIMEOUT_MS),
    ...selectelModel('qwen2', 'SELECTEL_QWEN2', 'qwen3-8-27b (Selectel)', TIMEOUT_MS),
    ...selectelModel('qwen-big', 'SELECTEL_QWENBIG', 'qwen3-vl-235b-a22b (Selectel)', TIMEOUT_MS),
    ...selectelModel('tpro', 'SELECTEL_TPRO', 't-pro-it-2-1 (Selectel)', TIMEOUT_MS),
    ...selectelModel('gptoss', 'SELECTEL_GPTOSS', 'gpt-oss-120b (Selectel)', TIMEOUT_MS),
    ...selectelModel('qwen-moe', 'SELECTEL_QWENMOE', 'qwen3-6-35b-a3b (Selectel)', TIMEOUT_MS),
  };
}

/** Модель Selectel: env <PREFIX>_BASE_URL, <PREFIX>_API_KEY, <PREFIX>_MODEL. */
function selectelModel(id: string, prefix: string, title: string, timeoutMs: number): Record<string, ModelDef> {
  return {
    [id]: {
      id,
      title,
      requiredEnv: [`${prefix}_BASE_URL`, `${prefix}_API_KEY`, `${prefix}_MODEL`],
      price: envPrice(prefix, { in: 0, out: 0 }),
      make: (planB) =>
        createOpenAiChatProvider({
          name: `selectel-${id}`,
          baseUrl: env(`${prefix}_BASE_URL`),
          apiKey: env(`${prefix}_API_KEY`),
          model: env(`${prefix}_MODEL`),
          supportsTools: !planB,
          extraBody: process.env[`${prefix}_EXTRA_BODY`] ? (JSON.parse(process.env[`${prefix}_EXTRA_BODY`] as string) as Record<string, unknown>) : undefined,
          timeoutMs,
        }),
    },
  };
}
