// Клиент API доставки по контракту (contract.md).
import { DeliveryError } from './errors';

export { DeliveryError };

export interface DeliveryClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function createDeliveryClient(options: DeliveryClientOptions) {
  void options;
  return {
    async quote(req: { fromCity: string; toCity: string; weightKg: number }): Promise<{ priceKop: number; etaDays: { min: number; max: number } }> {
      void req;
      throw new Error('not implemented');
    },
    async createShipment(req: { quoteId: string; recipient: string }, idempotencyKey: string): Promise<{ shipmentId: string; status: 'created' | 'pending' }> {
      void req;
      void idempotencyKey;
      throw new Error('not implemented');
    },
  };
}
