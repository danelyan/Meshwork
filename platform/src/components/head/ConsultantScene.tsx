import type { ReactNode } from 'react';
import { ConsultantHead } from './ConsultantHead';
import styles from './ConsultantScene.module.css';

export function ConsultantScene({ children, pending = false }: { children: ReactNode; pending?: boolean }) {
  return <div className={styles.scene}>
    <div className={styles.conversation}>{children}</div>
    <div className={styles.portrait}>{!pending && <ConsultantHead />}</div>
  </div>;
}
