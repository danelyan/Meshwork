import { ThreadSkeleton } from '@/components/chat/Thread';
import styles from '@/components/Chat.module.css';

/**
 * Первая загрузка /consultant: только скелет ленты. Старую сцену с головой первой версии здесь не
 * рисуем (решение владельца 11.10): она мелькала до настоящей сцены.
 */
export default function Loading() {
  return (
    <div className={styles.chat}>
      <ThreadSkeleton />
    </div>
  );
}
