import { ThreadSkeleton } from '@/components/chat/Thread';
import { ConsultantScene } from '@/components/head/ConsultantScene';
import styles from '@/components/Chat.module.css';

/** Первая загрузка /consultant: скелет ленты вместо пустого экрана. */
export default function Loading() {
  return (
    <ConsultantScene pending><div className={styles.chat}>
      <ThreadSkeleton />
    </div></ConsultantScene>
  );
}
