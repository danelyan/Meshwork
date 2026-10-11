import type { Metadata } from 'next';

import { SimulatorScreen } from '@/components/simulator/SimulatorScreen';
import { CONFIRM_PROB, GRADE_CUT } from '@/server/test/policy';
import { SIM_LIMITS, simulate, simulatorSubcategories } from '@/server/validation/simulator';

export const metadata: Metadata = { title: 'Симулятор теста - MESHWORK' };

/** Симулятор адаптивного теста для жюри (POST /api/simulator). Публичная, без БД и LLM. */
export default function SimulatorPage() {
  const subcategories = simulatorSubcategories();
  const first = subcategories[0];
  const initial = first ? simulate({ subcategoryId: first.id, claimed: 'middle', theta: 0.3, mode: 'ideal', seed: 1 }) : null;
  return <SimulatorScreen subcategories={subcategories} cuts={{ ...GRADE_CUT }} initial={initial} limits={SIM_LIMITS} confirmProb={CONFIRM_PROB} />;
}
