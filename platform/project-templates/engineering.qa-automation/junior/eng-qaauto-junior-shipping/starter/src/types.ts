// Типы контракта (contract.md). Менять не нужно.
export type Zone = 'city' | 'region' | 'country';
export interface Order {
  weightKg: number;
  zone: Zone;
  express: boolean;
  subtotal: number;
}
export type ErrorCode = 'invalid_weight' | 'too_heavy' | 'invalid_subtotal' | 'invalid_zone' | 'express_unavailable';

/** Кейс: ровно одно из expected / throws. */
export interface Case {
  name: string;
  input: Order;
  expected?: number;
  throws?: ErrorCode;
}
