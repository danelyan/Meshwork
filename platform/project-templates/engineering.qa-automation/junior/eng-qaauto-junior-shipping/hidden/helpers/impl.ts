// PLATFORM-OWNED: эталон и мутанты скрытых тестов платформы; кандидату не выдаются
import type { Order } from '../../src/types';

export type Defect =
  | 'w1-strict'
  | 'max-strict'
  | 'zero-weight'
  | 'nan-weight'
  | 'region-coef'
  | 'express-50'
  | 'free-strict'
  | 'free-express'
  | 'express-country'
  | 'negative-subtotal'
  | 'unknown-zone'
  | 'express-on-base';

export type ShippingFn = (order: Order) => number;

export function makeShipping(defect?: Defect): ShippingFn {
  const d = (x: Defect) => defect === x;
  const fail = (code: string): never => {
    throw new Error(code);
  };
  return (o) => {
    const w = o.weightKg;
    const badWeight = d('nan-weight') ? w <= 0 : d('zero-weight') ? !Number.isFinite(w) || w < 0 : !Number.isFinite(w) || w <= 0;
    if (badWeight) fail('invalid_weight');
    if (d('max-strict') ? w >= 20 : w > 20) fail('too_heavy');
    const badSubtotal = d('negative-subtotal') ? !Number.isFinite(o.subtotal) : !Number.isFinite(o.subtotal) || o.subtotal < 0;
    if (badSubtotal) fail('invalid_subtotal');
    let coef = ({ city: 10, region: d('region-coef') ? 20 : 15, country: 25 } as Record<string, number | undefined>)[o.zone];
    if (coef === undefined) {
      if (d('unknown-zone')) coef = 10;
      else fail('invalid_zone');
    }
    if (o.express && o.zone === 'country' && !d('express-country')) fail('express_unavailable');
    const free = d('free-strict') ? o.subtotal > 5000 : o.subtotal >= 5000;
    if (free && (!o.express || d('free-express'))) return 0;
    const base = (d('w1-strict') ? w < 1 : w <= 1) ? 300 : w <= 5 ? 500 : 900;
    const cost = (base * coef!) / 10;
    if (!o.express) return cost;
    if (d('express-50')) return (cost * 15) / 10;
    if (d('express-on-base')) return cost + (base * 4) / 10;
    return (cost * 14) / 10;
  };
}

/** Независимо написанный эталон (таблицы вместо ветвлений): ведёт себя так же. */
export const shippingAlt: ShippingFn = (o) => {
  const bands: [number, number][] = [[1, 300], [5, 500], [20, 900]];
  const mult: Record<string, number> = { city: 1, region: 1.5, country: 2.5 };
  const w = o.weightKg;
  if (typeof w !== 'number' || Number.isNaN(w) || w === Infinity || w === -Infinity || w <= 0) throw new Error('invalid_weight');
  const band = bands.find(([max]) => w <= max);
  if (!band) throw new Error('too_heavy');
  if (typeof o.subtotal !== 'number' || !(o.subtotal >= 0) || o.subtotal === Infinity) throw new Error('invalid_subtotal');
  if (!Object.prototype.hasOwnProperty.call(mult, o.zone)) throw new Error('invalid_zone');
  if (o.express && o.zone === 'country') throw new Error('express_unavailable');
  if (o.subtotal >= 5000 && !o.express) return 0;
  const zoned = Math.round(band[1] * mult[o.zone]!);
  return o.express ? Math.round(zoned * 1.4) : zoned;
};
