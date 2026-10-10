// PLATFORM-OWNED: интерфейс провайдера модели (contract.md). Не меняйте: проверка подставляет своих провайдеров.
export interface ProviderRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export interface ProviderResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export type ProviderErrorKind = 'timeout' | 'rate_limit' | 'server' | 'bad_request' | 'auth';

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    message = kind,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface Provider {
  name: string;
  complete(req: ProviderRequest): Promise<ProviderResponse>;
}
