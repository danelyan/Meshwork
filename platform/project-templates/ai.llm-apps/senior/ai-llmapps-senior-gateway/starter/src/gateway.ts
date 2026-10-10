// Шлюз по контракту (contract.md).
import type { Provider } from './provider';

export interface Field {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
}

export interface ExtractRequest {
  instruction: string;
  text: string;
  fields: Field[];
}

export type Value = string | number | boolean | null;

export interface ExtractResult {
  data: Record<string, Value>;
  provider: string;
  cached: boolean;
  repaired: boolean;
  tokens: number;
}

export type GatewayErrorCode = 'bad_request' | 'budget_exceeded' | 'provider_rejected' | 'all_providers_failed' | 'invalid_output';

export class GatewayError extends Error {
  constructor(
    public readonly code: GatewayErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export interface Gateway {
  extract(req: ExtractRequest): Promise<ExtractResult>;
  spent(): number;
}

export function createGateway(options: { providers: Provider[]; budgetTokens: number; maxTokens?: number }): Gateway {
  void options;
  throw new Error('not implemented');
}
