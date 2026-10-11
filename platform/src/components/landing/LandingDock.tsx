'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import styles from './LandingDock.module.css';

export function LandingDock({ signedIn }: { signedIn: boolean }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const update = () => setVisible(window.scrollY > window.innerHeight * .8 && window.scrollY < document.documentElement.scrollHeight - window.innerHeight - 500);
    update(); window.addEventListener('scroll', update, { passive: true }); window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);
  if (!visible) return null;
  return <aside className={styles.dock} aria-label="Начать работу"><span>Профиль с доказательствами</span><Link href={signedIn ? '/consultant' : '/auth?next=%2Fconsultant'}>Приступим →</Link></aside>;
}
