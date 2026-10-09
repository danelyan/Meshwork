import type { ReactNode } from 'react';
import Image from 'next/image';
import { ConsultantHead } from './ConsultantHead';
import styles from './ConsultantScene.module.css';

export function ConsultantScene({ children, pending = false }: { children: ReactNode; pending?: boolean }) {
  return <div className={styles.scene}>
    <div className={styles.conversation}>{children}</div>
    {pending ? <div className={styles.portrait} aria-hidden="true"><div className={styles.fallback}><Image src="/models/head-reference.png" alt="" width={332} height={313} unoptimized /></div></div> : <ConsultantHead />}
  </div>;
}
