import type { Metadata } from 'next';

import { MechanicsView } from '@/components/mechanics/MechanicsView';
import { buildMechanicsData } from '@/server/mechanics/page-data';

export const metadata: Metadata = { title: 'Механика - ФСП Карьера' };

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Лаборатория вариантов заданий (публичная): состояние в адресе, генерация на сервере по seed. */
export default async function MechanicsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  return <MechanicsView data={buildMechanicsData({ spec: one(sp.spec), sub: one(sp.sub), family: one(sp.family), seed: one(sp.seed) })} />;
}
