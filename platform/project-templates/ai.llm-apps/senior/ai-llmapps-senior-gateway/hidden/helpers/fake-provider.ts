// PLATFORM-OWNED: управляемые провайдеры для скрытых тестов
import { ProviderError, type Provider, type ProviderRequest, type ProviderResponse } from '../../src/provider';

export type Reply = string | ProviderError | ProviderResponse | (() => Promise<ProviderResponse>);

/** Провайдер по сценарию: ответы по очереди; строка – текст с 100/20 токенами. Пишет все запросы. */
export function fake(name: string, replies: Reply[] = []) {
  const requests: ProviderRequest[] = [];
  const provider: Provider = {
    name,
    async complete(req) {
      requests.push(req);
      const r = replies.shift();
      if (r === undefined) throw new Error(`${name}: ответов больше нет`);
      if (r instanceof ProviderError) throw r;
      if (typeof r === 'function') return r();
      if (typeof r === 'string') return { text: r, inputTokens: 100, outputTokens: 20 };
      return r;
    },
  };
  return { provider, requests };
}

export { ProviderError };
