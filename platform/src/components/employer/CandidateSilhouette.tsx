import styles from './Employer.module.css';

/** Anonymous until an invitation is accepted; never invent a candidate portrait. */
export function CandidateSilhouette({ className = '' }: { className?: string }) {
  return <span className={`${styles.silhouette} ${className}`} aria-hidden="true"><svg viewBox="0 0 64 64" fill="currentColor"><circle cx="32" cy="23" r="10" /><path d="M13 55v-6c0-10 8-17 19-17s19 7 19 17v6z" /></svg></span>;
}
