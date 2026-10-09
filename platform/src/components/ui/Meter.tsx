import styles from '../ui.module.css';

import { cx } from './cx';

export type MeterProps = {
  /** Закрыто сегментов. */
  value: number;
  /** Всего сегментов. */
  max: number;
  /** Текстовая подпись для скринридера; по умолчанию «value из max». Число рядом показывать тоже. */
  label?: string;
  className?: string;
};

/** Сегментная полоса покрытия. Значение дублируется в aria-label: не только цвет. */
export function Meter({ value, max, label, className }: MeterProps) {
  const total = Math.max(0, Math.floor(max));
  const on = Math.min(total, Math.max(0, Math.floor(value)));
  return (
    <div role="img" aria-label={label ?? `${on} из ${total}`} className={cx(styles.meter, className)}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < on ? styles.meterOn : undefined} data-on={i < on ? 'true' : 'false'} />
      ))}
    </div>
  );
}
