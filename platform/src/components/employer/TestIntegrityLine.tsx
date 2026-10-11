import { integrityLabel, type PublicTestIntegrity } from '@/server/employer/test-integrity-label';

import styles from './Employer.module.css';

const OWNERSHIP_TEXT = { explained: 'объяснил сам', partial: 'объяснил частично', failed: 'не смог объяснить' } as const;

export const integrityText = integrityLabel;

/** «Тест: проверка честности - …» + сигнал созвона «решения теста», если он есть. При high без подтверждения категория не учитывается в ранжировании (TEST_INTEGRITY_RANKING). */
export function TestIntegrityLine({ integrity, ownership }: { integrity: PublicTestIntegrity | null | undefined; ownership?: keyof typeof OWNERSHIP_TEXT | 'not_checked' }) {
  const text = integrityText(integrity);
  if (!text) return null;
  return (
    <p className={styles.meta} data-testid="test-integrity" data-level={integrity!.level}>
      Тест: проверка честности - {text}.
      {ownership && ownership !== 'not_checked' && ` На созвоне решения теста: ${OWNERSHIP_TEXT[ownership]}.`}{integrity!.level === 'high' && !integrity!.confirmedAgain && ownership !== 'explained' ? ' Пока не подтверждено, категория из теста в выдаче не учитывается.' : ' Сигнал, в оценку не входит.'}
    </p>
  );
}
