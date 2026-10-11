'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { OvalHead } from '@/components/avatar/OvalHead';
import { useBareShell } from '@/components/shell/ShellFrame';
import { Button } from '@/components/ui';

import styles from './NotFoundScene.module.css';

export function NotFoundScene() {
  useBareShell(true);
  // Пока предпочтение не прочитано, первый кадр неподвижен.
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return (
    <main id="main" className={styles.scene} data-not-found>
      <Link href="/" className={styles.brand} aria-label="MESHWORK — на главную">MESHWORK</Link>
      <div className={styles.code} aria-hidden="true">404</div>
      <div className={styles.head}>
        <OvalHead reducedMotion={reduced} avoidPointer />
      </div>
      <section className={styles.copy} aria-labelledby="not-found-title">
        <p className={styles.eyebrow}>Ошибка 404</p>
        <h1 id="not-found-title">Даже он<br /> не знает,<br /> где эта страница.</h1>
        <p className={styles.description}>Кажется, вы свернули не туда.<br />Вернёмся к вашей карьере?</p>
        <Button href="/" className={styles.home}>На главную <span aria-hidden="true">↗</span></Button>
      </section>
      <p className={styles.hint}>Не принимайте на свой счёт. Он от всех отворачивается.</p>
    </main>
  );
}
