import type { Metadata } from 'next';

import { MethodScreen } from '@/components/method/MethodScreen';
import { getEnv } from '@/server/env';
import { bankInformation, methodPolicy, simulatedCandidates } from '@/server/validation/method';
import { simulatorSubcategories } from '@/server/validation/simulator';

export const metadata: Metadata = { title: 'Как устроена проверка - ФСП Карьера' };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * «Как устроена проверка» для жюри: этапы теста, информация банка, смоделированные кандидаты, формула подбора.
 * Публичная, без БД и LLM. Подкатегория — `?sub=` (GET-форма); неизвестная — первая из списка. Прогоны кэшируются
 * по подкатегории в памяти процесса (simulatedCandidates), первый расчёт — около 0,3 с.
 */
export default async function MethodPage({ searchParams }: { searchParams: Search }) {
  const subcategories = simulatorSubcategories();
  const raw = (await searchParams).sub;
  const wanted = Array.isArray(raw) ? raw[0] : raw;
  const selected = subcategories.find((s) => s.id === wanted) ?? subcategories[0] ?? null;
  return (
    <MethodScreen
      policy={methodPolicy()}
      subcategories={subcategories}
      selected={selected}
      info={selected ? bankInformation(selected.id) : null}
      personas={selected ? simulatedCandidates(selected.id) : null}
      juryLink={getEnv().DEMO_LOGIN}
    />
  );
}
