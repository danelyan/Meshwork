import type { RedFlag } from '@/server/employer/antifraud';

import { Notice } from '../ui';

/**
 * Предупреждение работодателю (R-X-01): красные флаги текста и вилки до сохранения или отправки.
 * Не блокирует действие: флаги – подсказка, а не вердикт.
 */
export function RedFlagNotice({ flags }: { flags: readonly RedFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <Notice aria-label="Проверка текста на признаки фиктивного предложения">
      Проверьте текст: он похож на недобросовестное предложение, кандидаты увидят пометку.
      <ul>
        {flags.map((f) => (
          <li key={f.code}>{f.reason}</li>
        ))}
      </ul>
    </Notice>
  );
}
