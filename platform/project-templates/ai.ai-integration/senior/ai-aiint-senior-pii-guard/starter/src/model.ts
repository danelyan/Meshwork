// PLATFORM-OWNED: интерфейс модели (contract.md). Не меняйте: проверка подставляет своих «моделей».
export interface ModelRequest {
  prompt: string;
  maxTokens: number;
}

export interface ModelResponse {
  text: string;
  /** Сколько токенов потрачено на вызов (вход + выход). */
  tokens: number;
}

export type ModelErrorKind = 'timeout' | 'rate_limit' | 'server' | 'bad_request' | 'auth';

export class ModelError extends Error {
  constructor(
    public readonly kind: ModelErrorKind,
    message = kind,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

export interface Model {
  name: string;
  complete(req: ModelRequest): Promise<ModelResponse>;
}
