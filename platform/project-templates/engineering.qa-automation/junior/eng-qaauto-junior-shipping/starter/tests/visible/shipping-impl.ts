// PLATFORM-OWNED: образец проверяемой реализации и два заведомо сломанных варианта (мутанта)
import type { Order } from '../../src/types';

export type VisibleDefect = 'max-strict' | 'free-strict';

/** Эталонная реализация расчёта доставки; defect включает один известный баг. */
export function makeShipping(defect?: VisibleDefect): (order: Order) => number {
  const fail = (code: string): never => {
    throw new Error(code);
  };
  return (o) => {
    const w = o.weightKg;
    if (!Number.isFinite(w) || w <= 0) fail('invalid_weight');
    if (defect === 'max-strict' ? w >= 20 : w > 20) fail('too_heavy');
    if (!Number.isFinite(o.subtotal) || o.subtotal < 0) fail('invalid_subtotal');
    const coef = ({ city: 10, region: 15, country: 25 } as Record<string, number | undefined>)[o.zone];
    if (coef === undefined) fail('invalid_zone');
    if (o.express && o.zone === 'country') fail('express_unavailable');
    if (!o.express && (defect === 'free-strict' ? o.subtotal > 5000 : o.subtotal >= 5000)) return 0;
    const base = w <= 1 ? 300 : w <= 5 ? 500 : 900;
    const cost = (base * coef!) / 10;
    return o.express ? (cost * 14) / 10 : cost;
  };
}
