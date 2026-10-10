import type { ReactNode } from 'react';
import { ConsultantHead } from './ConsultantHead';
import { CompanionVoiceProvider } from '@/components/avatar/voice';
import styles from './ConsultantScene.module.css';

export function ConsultantScene({ children, pending = false }: { children: ReactNode; pending?: boolean }) {
  return <CompanionVoiceProvider autoEnable><div className={styles.scene}>
    <div className={styles.conversation}>{children}</div>
    <div className={styles.portrait}>{!pending && <ConsultantHead />}</div>
  </div></CompanionVoiceProvider>;
}
