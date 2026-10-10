import type { PublicIntegrityGroup, PublicTestIntegrity } from '@/server/employer/test-integrity';

import styles from './Employer.module.css';

const GROUP_LABEL: Record<PublicIntegrityGroup, string> = { time: 'время', fit: 'рисунок ответов', browser: 'браузер' };
const OWNERSHIP_TEXT = { explained: 'объяснил сам', partial: 'объяснил частично', failed: 'не смог объяснить' } as const;

/** Текст метки проверки честности теста; null - проверки не было, метку не показываем. */
export function integrityText(i: PublicTestIntegrity | null | undefined): string | null {
  if (!i) return null;
  if (i.level === 'low') return 'без замечаний';
  const groups = i.groups.length > 0 ? ` (${i.groups.map((g) => GROUP_LABEL[g]).join(', ')})` : '';
  return `${i.confirmedAgain ? 'были замечания' : 'есть замечания'}${groups}${i.confirmedAgain ? ', подтверждён повторно' : ''}`;
}

/** «Тест: проверка честности - …» + сигнал созвона «решения теста», если он есть. Сигнал, в ранжирование не входит. */
export function TestIntegrityLine({ integrity, ownership }: { integrity: PublicTestIntegrity | null | undefined; ownership?: keyof typeof OWNERSHIP_TEXT | 'not_checked' }) {
  const text = integrityText(integrity);
  if (!text) return null;
  return (
    <p className={styles.meta} data-testid="test-integrity" data-level={integrity!.level}>
      Тест: проверка честности - {text}.
      {ownership && ownership !== 'not_checked' && ` На созвоне решения теста: ${OWNERSHIP_TEXT[ownership]}.`} Сигнал, в оценку не входит.
    </p>
  );
}
