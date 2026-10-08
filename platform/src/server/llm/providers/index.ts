import type { Env } from '../../env';
import type { LlmProvider } from '../types';
import { createOpenAiChatProvider } from './openai-chat';
import { createStubProvider } from './stub';
import { createYandexResponsesProvider } from './yandex-responses';

/** Провайдер по env LLM_PROVIDER. Обязательные ключи уже проверены в env.ts. */
export function createProvider(env: Env): LlmProvider {
  switch (env.LLM_PROVIDER) {
    case 'stub':
      return createStubProvider();
    case 'yandex':
      return createYandexResponsesProvider({
        apiKey: env.YANDEX_API_KEY as string,
        folderId: env.YANDEX_FOLDER_ID as string,
        model: env.YANDEX_MODEL as string,
        baseUrl: env.YANDEX_BASE_URL,
      });
    case 'openai-chat':
      return createOpenAiChatProvider({
        baseUrl: env.OPENAI_CHAT_BASE_URL as string,
        apiKey: env.OPENAI_CHAT_API_KEY as string,
        model: env.OPENAI_CHAT_MODEL as string,
      });
  }
}

export { createStubProvider, registerStubResponse, clearStubResponses, minimalFromSchema } from './stub';
