import { type CallVerdict, OWNERSHIP_LABEL, type DepthMapItem, type DepthStatus, depthStatus, type PublicCallVerdict } from '@/server/call/types';

import { cx } from '../ui';

import styles from './DepthMap.module.css';

const CRITERIA: { key: keyof DepthMapItem['scores']; label: string }[] = [
  { key: 'depth', label: 'глубина' },
  { key: 'why', label: 'почему так' },
  { key: 'boundary', label: 'граница знаний' },
  { key: 'completion', label: 'доведение' },
];

const LEVEL: Record<number, string> = { 1: 'база', 2: 'практика', 3: 'глубина' };

type Item = Pick<DepthMapItem, 'topic' | 'catalogId' | 'claimed' | 'probed' | 'maxLevel' | 'confirmed' | 'scores' | 'total'> & {
  quote?: string;
  status?: DepthStatus;
  extraProbe?: boolean;
};

const STATUS: Record<DepthStatus, string> = {
  confirmed: 'подтверждено',
  not_confirmed: 'не подтверждено',
  inconclusive: 'не определено',
  not_probed: 'не проверено',
};

/**
 * Карта глубины созвона (ADR 0003): тема → заявлено → копнули → подтвердилось. Баллы — медиана прогонов
 * слепого оценщика по рубрике A-02 (0–2 по каждому признаку). «Не определено» — прогоны разошлись даже
 * после дополнительного вопроса; «не проверено» — по теме не спрашивали. Цитата — только для full-доступа.
 */
export function DepthMap({ verdict, dark = false }: { verdict: CallVerdict | PublicCallVerdict; dark?: boolean }) {
  const items = verdict.depthMap as Item[];
  return (
    <div className={cx(styles.map, dark && styles.dark)} data-testid="depth-map">
      <p className={styles.summary}>{verdict.summary}</p>
      {verdict.testOwnership && verdict.testOwnership.status !== 'not_checked' && (
        <p className={styles.note} data-testid="test-ownership">
          Решения теста: {OWNERSHIP_LABEL[verdict.testOwnership.status]}
          {'reason' in verdict.testOwnership && verdict.testOwnership.reason ? ` - ${verdict.testOwnership.reason}` : ''}
        </p>
      )}
      {items.length > 0 && (
        <ul className={styles.list}>
          {items.map((d) => {
            const status = depthStatus(d);
            const skipped = status === 'not_probed';
            return (
              <li key={d.topic} className={cx(styles.item, skipped && styles.skipped)} data-confirmed={d.confirmed} data-status={status}>
                <div className={styles.head}>
                  <b className={styles.topic}>{d.topic}</b>
                  <span className={cx(styles.status, status === 'confirmed' && styles.ok)}>{STATUS[status]}</span>
                </div>
                <div className={styles.meta}>
                  <span>{d.claimed ? 'заявлено в профиле' : 'тема платформы'}</span>
                  {skipped ? (
                    <span>в этом созвоне по теме не спрашивали</span>
                  ) : (
                    <>
                      <span>
                        копнули: {d.probed} {d.probed === 1 ? 'вопрос' : d.probed < 5 ? 'вопроса' : 'вопросов'}, до уровня «{LEVEL[d.maxLevel] ?? d.maxLevel}»
                        {d.extraProbe ? ', с дополнительным' : ''}
                      </span>
                      <span>{d.total} из 8</span>
                    </>
                  )}
                </div>
                {status === 'inconclusive' && (
                  <p className={styles.note}>Прогоны оценщика разошлись и после дополнительного вопроса - тема не засчитана и не поднимает уровень утверждения.</p>
                )}
                {!skipped && (
                  <div className={styles.scores} aria-label="Баллы по рубрике">
                    {CRITERIA.map((c) => (
                      <span key={c.key} className={styles.score} title={`${c.label}: ${d.scores[c.key]} из 2`}>
                        <i className={styles.bar} aria-hidden="true">
                          {[0, 1].map((n) => (
                            <i key={n} className={cx(styles.cell, n < d.scores[c.key] && styles.on)} />
                          ))}
                        </i>
                        {c.label} {d.scores[c.key]}
                      </span>
                    ))}
                  </div>
                )}
                {d.quote && <blockquote className={styles.quote}>«{d.quote}»</blockquote>}
              </li>
            );
          })}
        </ul>
      )}
      {'disclaimer' in verdict && <p className={styles.note}>{verdict.disclaimer}</p>}
    </div>
  );
}
