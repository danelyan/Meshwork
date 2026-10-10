'use client';

import { HeadView } from '@/components/avatar/HeadView';
import { MuteToggle, StateChip, StopButton } from '@/components/avatar/Speaking';
import styles from './ConsultantScene.module.css';

/** Selected weave-six portrait with live neck and facial animation. */
export function ConsultantHead() {
  return <>
    <HeadView style="weave6" />
    <div className={styles.portraitLabel}><span>Консультант</span><StateChip /></div>
    <div className={styles.caption}><MuteToggle /><StopButton /></div>
  </>;
}
