import type { Metadata } from 'next';

import { ValidationView } from '@/components/validation/ValidationView';
import { getEnv } from '@/server/env';
import { GRADE_TEST_COMMANDS, GRADE_TEST_DOC, GRADE_TEST_POLICY, PERSONAS, SYNTHETIC, TARGETS } from '@/server/validation/grade-test-figures';
import { matchingResults } from '@/server/validation/matching-results';

export const metadata: Metadata = { title: 'Валидация - ФСП Карьера' };

/** Цифры валидации теста и подбора (критерии 1–2). Публичная: жюри смотрит без входа. */
export default function ValidationPage() {
  return (
    <ValidationView
      grade={{ doc: GRADE_TEST_DOC, policy: GRADE_TEST_POLICY, personas: PERSONAS, synthetic: SYNTHETIC, targets: TARGETS, commands: GRADE_TEST_COMMANDS }}
      matching={matchingResults()}
      juryLink={getEnv().DEMO_LOGIN}
    />
  );
}
