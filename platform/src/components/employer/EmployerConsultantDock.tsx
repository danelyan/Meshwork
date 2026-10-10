import Image from 'next/image';
import Link from 'next/link';
import styles from './Employer.module.css';

/** Opens the actual employer consultant, keeping every draft behind human confirmation. */
export function EmployerConsultantDock() {
  return <Link href="/employer/assistant" className={styles.consultantDock} aria-label="Спросить консультанта про подборку"><div className={styles.dockPortrait}><Image src="/models/head-reference.png" alt="" fill sizes="210px" /></div><span>Спросить про подборку <b aria-hidden="true">↗</b></span></Link>;
}
