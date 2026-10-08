import type { LlmProvider } from '../types';

/** OpenAI-совместимый Chat Completions (Cloud.ru, vLLM, Yandex OpenAI-compat). Реализует лейн llm. */
export interface OpenAiChatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function createOpenAiChatProvider(cfg: OpenAiChatConfig): LlmProvider {
  void cfg;
  throw new Error('not implemented: llm (openai-chat)');
}
