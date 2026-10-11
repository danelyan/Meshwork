// Чистые типы и текст метки проверки честности теста для работодателя (без БД: импортируется и из клиентских компонентов).
export type PublicIntegrityGroup = 'time' | 'fit' | 'browser';

export interface PublicTestIntegrity {
  level: 'low' | 'medium' | 'high';
  /** Группы замечаний: время / рисунок ответов / браузер. Ловушка наружу не называется. */
  groups: PublicIntegrityGroup[];
  /** Были замечания, категорию выдал подтверждающий тест. */
  confirmedAgain: boolean;
}

const GROUP_LABEL: Record<PublicIntegrityGroup, string> = { time: 'время', fit: 'рисунок ответов', browser: 'браузер' };

/**
 * Текст метки проверки честности теста для работодателя; null - проверки не было, метку не показываем.
 * high отделён от medium (решение владельца 11.10): «тест под сомнением» против «есть замечания».
 */
export function integrityLabel(i: PublicTestIntegrity | null | undefined): string | null {
  if (!i) return null;
  if (i.level === 'low') return 'без замечаний';
  const groups = i.groups.length > 0 ? ` (${i.groups.map((g) => GROUP_LABEL[g]).join(', ')})` : '';
  if (i.confirmedAgain) return `были замечания${groups}, подтверждён повторно`;
  if (i.level === 'high') return `тест под сомнением${groups} - проверьте на созвоне`;
  return `есть замечания${groups}`;
}

