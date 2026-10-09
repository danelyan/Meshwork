import styles from '../ui.module.css';

/** Индикатор загрузки. Декоративный: смысл несёт соседний текст «Загружаю…». */
export function Spinner() {
  return <span className={styles.spinner} aria-hidden="true" data-testid="spinner" />;
}
