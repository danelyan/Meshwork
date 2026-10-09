import { normalizeRecommendation } from '@/lib/claims-view';

import styles from './Recommendations.module.css';
import ui from './ui.module.css';

const KIND_LABEL = { task: 'задание', target: 'цель', test: 'тест', gap: 'пробел', other: 'совет' } as const;

export function Recommendations({ items }: { items: unknown[] }) {
  const recs = items.map(normalizeRecommendation).filter((r) => r !== null);
  if (recs.length === 0) return <p className={ui.muted}>Пока нет рекомендаций.</p>;
  return (
    <ul className={styles.recs} aria-label="Рекомендации">
      {recs.map((r) => (
        <li key={r.key} className={`${ui.panel} ${styles.rec}`}>
          <span className={`${ui.tag} ${ui.outline}`}>{KIND_LABEL[r.kind]}</span>
          <h3 className={styles.recTitle} style={{ fontSize: 'var(--fs-md)' }}>{r.title}</h3>
          {r.meta && <span className={styles.recMeta}>{r.meta}</span>}
          {r.reason && <p className={styles.recReason}>{r.reason}</p>}
          {r.missing && r.missing.length > 0 && (
            <ul className={styles.missing} aria-label="Чего не хватает">
              {r.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
