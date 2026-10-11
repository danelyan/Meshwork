import { registerExtractorDemoStub } from '../../claims/stub-demo';
import type { Env } from '../../env';
import type { LlmProvider } from '../types';
import { createOpenAiChatProvider } from './openai-chat';
import { createStubProvider } from './stub';
import { createYandexResponsesProvider, yandexAuthHeader, yandexModelUri } from './yandex-responses';

/** Провайдер по env LLM_PROVIDER. Обязательные ключи уже проверены в env.ts. */
export function createProvider(env: Env): LlmProvider {
  switch (env.LLM_PROVIDER) {
    case 'stub':
      if (env.LLM_STUB_DEMO) registerExtractorDemoStub();
      return createStubProvider();
    case 'yandex':
      return createYandexResponsesProvider({
        apiKey: env.YANDEX_API_KEY as string,
        folderId: env.YANDEX_FOLDER_ID as string,
        model: env.YANDEX_MODEL as string,
        baseUrl: env.YANDEX_BASE_URL,
        supportsTools: env.YANDEX_SUPPORTS_TOOLS,
      });
    case 'openai-chat': {
      const baseUrl = env.OPENAI_CHAT_BASE_URL as string;
      const apiKey = env.OPENAI_CHAT_API_KEY as string;
      let model = env.OPENAI_CHAT_MODEL as string;
      let headers: Record<string, string> | undefined;
      // OpenAI-совместимый эндпоинт Yandex AI Studio (DeepSeek, Qwen): Api-Key вместо
      // Bearer, каталог в OpenAI-Project, модель – URI gpt://<folder>/<model>.
      if (isYandexHost(baseUrl) && env.YANDEX_FOLDER_ID) {
        model = yandexModelUri(env.YANDEX_FOLDER_ID, model);
        headers = { Authorization: yandexAuthHeader(apiKey), 'OpenAI-Project': env.YANDEX_FOLDER_ID };
      }
      return createOpenAiChatProvider({
        baseUrl,
        apiKey,
        model,
        name: env.OPENAI_CHAT_NAME,
        supportsTools: env.OPENAI_CHAT_SUPPORTS_TOOLS,
        supportsJsonSchema: env.OPENAI_CHAT_SUPPORTS_JSON_SCHEMA,
        stream: env.OPENAI_CHAT_STREAM,
        extraBody: env.OPENAI_CHAT_EXTRA_BODY,
        headers,
      });
    }
  }
}

/**
 * Запасная модель (LLM_FALLBACK_*): OpenAI-совместимый Chat Completions, получает запрос, если основная не ответила
 * (client.ts). Для Yandex AI Studio каталог – LLM_FALLBACK_FOLDER_ID (облако модели может быть другим, чем у голоса и
 * поиска), иначе YANDEX_FOLDER_ID. Без LLM_FALLBACK_BASE_URL запасной нет; при LLM_PROVIDER=stub не включается.
 */
export function createFallbackProvider(env: Env): LlmProvider | undefined {
  if (env.LLM_PROVIDER === 'stub') return undefined;
  return createSecondaryProvider(
    { baseUrl: env.LLM_FALLBACK_BASE_URL, apiKey: env.LLM_FALLBACK_API_KEY, model: env.LLM_FALLBACK_MODEL, folderId: env.LLM_FALLBACK_FOLDER_ID, name: env.LLM_FALLBACK_NAME, extraBody: env.LLM_FALLBACK_EXTRA_BODY },
    'fallback',
    env,
  );
}

/**
 * Модель для созвонов (LLM_CALL_*): та же схема, что у запасной. Без LLM_CALL_BASE_URL/API_KEY/MODEL – undefined
 * (созвоны идут на основной); при LLM_PROVIDER=stub не включается.
 */
export function createCallProvider(env: Env): LlmProvider | undefined {
  if (env.LLM_PROVIDER === 'stub') return undefined;
  return createSecondaryProvider(
    { baseUrl: env.LLM_CALL_BASE_URL, apiKey: env.LLM_CALL_API_KEY, model: env.LLM_CALL_MODEL, folderId: env.LLM_CALL_FOLDER_ID, name: env.LLM_CALL_NAME, extraBody: env.LLM_CALL_EXTRA_BODY },
    'call',
    env,
  );
}

interface SecondaryProviderConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  folderId?: string;
  name?: string;
  extraBody?: Env['LLM_FALLBACK_EXTRA_BODY'];
}

/** OpenAI-совместимый провайдер из тройки BASE_URL/API_KEY/MODEL; на хосте Yandex – Api-Key, URI модели и каталог. */
function createSecondaryProvider(cfg: SecondaryProviderConfig, defaultName: string, env: Env): LlmProvider | undefined {
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) return undefined;
  const { baseUrl, apiKey } = cfg;
  let model = cfg.model;
  let headers: Record<string, string> | undefined;
  const folderId = cfg.folderId ?? env.YANDEX_FOLDER_ID;
  if (isYandexHost(baseUrl) && folderId) {
    model = yandexModelUri(folderId, model);
    headers = { Authorization: yandexAuthHeader(apiKey), 'OpenAI-Project': folderId };
  }
  return createOpenAiChatProvider({
    baseUrl,
    apiKey,
    model,
    name: cfg.name ?? defaultName,
    stream: env.OPENAI_CHAT_STREAM,
    extraBody: cfg.extraBody,
    headers,
  });
}

function isYandexHost(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.yandex.net');
  } catch {
    return false;
  }
}

export { createStubProvider, registerStubResponse, clearStubResponses, minimalFromSchema } from './stub';
