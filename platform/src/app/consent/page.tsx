import type { Metadata } from 'next';

import { CONSENT_VERSION } from '@/server/auth/consent';
import { CONSENT_IS_DRAFT, CONSENT_PARAGRAPHS } from '@/server/onboarding/consent-text';

import { Container } from '@/components/shell/Container';

import styles from './consent.module.css';

export const metadata: Metadata = { title: 'Согласие на обработку данных - ФСП Карьера' };

/** Текст согласия (R-C-14) — ссылка из шага согласия онбординга. */
export default function ConsentPage() {
  return (
    <main id="main">
      <Container size="text" className={styles.page}>
      <h1>Согласие на обработку персональных данных</h1>
      {CONSENT_IS_DRAFT && <p className={styles.note}>Черновик, не юридический текст. Версия {CONSENT_VERSION}.</p>}
      {CONSENT_PARAGRAPHS.map((p) => (
        <p key={p}>{p}</p>
      ))}
      <p className={styles.note}>
        Реквизиты ФСП: <a href="https://fsp-russia.ru/upload/iblock/2ca/8zl0rvumvllbcmt2gd4udlmt1hfjfwks.pdf" target="_blank" rel="noopener noreferrer">официальное положение об обработке персональных данных</a>.
      </p>
      </Container>
    </main>
  );
}
