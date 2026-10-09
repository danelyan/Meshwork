import type { ReactNode } from 'react';

import { Kicker } from '../ui';

import styles from './shell.module.css';

/** Заголовок страницы: кикер, h1 и необязательный лид. Один на странице. */
export function PageTitle({ kicker, title, lead }: { kicker?: ReactNode; title: ReactNode; lead?: ReactNode }) {
  return (
    <div className={styles.pageTitle}>
      {kicker && <Kicker>{kicker}</Kicker>}
      <h1>{title}</h1>
      {lead && <p>{lead}</p>}
    </div>
  );
}
