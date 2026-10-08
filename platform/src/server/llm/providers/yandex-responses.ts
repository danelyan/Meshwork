import type { LlmProvider } from '../types';

/** Yandex AI Studio Responses API (`https://ai.api.cloud.yandex.net/v1`). Реализует лейн llm. */
export interface YandexResponsesConfig {
  apiKey: string;
  folderId: string;
  /** Имя модели; провайдер сам собирает URI вида gpt://<folder>/<model>, если нужно. */
  model: string;
  baseUrl: string;
}

export function createYandexResponsesProvider(cfg: YandexResponsesConfig): LlmProvider {
  void cfg;
  throw new Error('not implemented: llm (yandex-responses)');
}
