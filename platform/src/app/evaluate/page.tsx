import type { Metadata } from 'next';

import { EvaluateModes } from '@/components/evaluate/EvaluateModes';
import { EvaluateScreen } from '@/components/validation/EvaluateScreen';
import { getEnv } from '@/server/env';
import { EVAL_LIMITS, evalCatalog } from '@/server/validation/evaluate';
import { sampleDataset } from '@/server/validation/sample';

export const metadata: Metadata = { title: 'Проверить подбор - ФСП Карьера' };

/** Прогон нашего ранжирования на наборе пользователя (POST /api/evaluate). Публичная, без записи в БД. */
export default function EvaluatePage() {
  const catalog = [...evalCatalog().values()].map((e) => ({ id: e.id, statement: e.statement, specialization: e.specialization }));
  return (
    <EvaluateModes>
      <EvaluateScreen sample={sampleDataset()} catalog={catalog} limits={EVAL_LIMITS} juryLink={getEnv().DEMO_LOGIN} />
    </EvaluateModes>
  );
}
