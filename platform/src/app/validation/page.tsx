import type { Metadata } from 'next';

import { ValidationView } from '@/components/validation/ValidationView';
import { getEnv } from '@/server/env';
import { activeItemLimits } from '@/server/test/limits';
import { GRADE_TEST_COMMANDS, GRADE_TEST_DOC, GRADE_TEST_POLICY, LENGTH_BLOCK, PERSONAS, SYNTHETIC, TARGETS } from '@/server/validation/grade-test-figures';
import { matchingResults } from '@/server/validation/matching-results';

export const metadata: Metadata = { title: 'Валидация - MESHWORK' };

/** Цифры валидации теста и подбора (критерии 1–2). Публичная: жюри смотрит без входа. */
export default function ValidationPage() {
  return (
    <ValidationView
      grade={{ doc: GRADE_TEST_DOC, policy: GRADE_TEST_POLICY, personas: PERSONAS, synthetic: SYNTHETIC, targets: TARGETS, commands: GRADE_TEST_COMMANDS }}
      length={LENGTH_BLOCK}
      itemLimits={activeItemLimits()}
      matching={matchingResults()}
      juryLink={getEnv().DEMO_LOGIN}
    />
  );
}
