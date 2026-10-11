// Охранный шлюз по контракту (contract.md).
import type { Model } from './model';

export type PiiType = 'EMAIL' | 'PHONE' | 'CARD';

export interface AskRequest {
  userId: string;
  prompt: string;
}

export interface Answer {
  text: string;
  model: string;
  cached: boolean;
  tokens: number;
  /** Сколько разных значений ПДн замаскировано в запросе. */
  masked: number;
}

export type GuardErrorCode = 'bad_request' | 'budget_exceeded' | 'model_rejected' | 'unavailable';

export class GuardError extends Error {
  constructor(
    public readonly code: GuardErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'GuardError';
  }
}

export interface Usage {
  used: number;
  limit: number;
  resetsAt: number;
}

export interface AuditEntry {
  userId: string;
  at: number;
  outcome: 'ok' | 'cached' | Exclude<GuardErrorCode, 'bad_request'>;
  model: string | null;
  tokens: number;
  pii: Partial<Record<PiiType, number>>;
}

export interface Guard {
  ask(req: AskRequest): Promise<Answer>;
  usage(userId: string): Usage;
  audit(): AuditEntry[];
}

export interface GuardOptions {
  primary: Model;
  fallback?: Model;
  now: () => number;
  budget: { tokens: number; periodMs: number };
  maxTokens?: number;
  cacheTtlMs?: number;
}

export function createGuard(options: GuardOptions): Guard {
  void options;
  throw new Error('not implemented');
}
