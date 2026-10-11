import type { Metadata } from 'next';

import { CONSENT_IS_DRAFT, CONSENT_TEXTS } from '@/server/consent/texts';

import { LegalLinksNav } from '@/components/legal/LegalDocument';
import { Container } from '@/components/shell/Container';

import styles from './consent.module.css';

export const metadata: Metadata = { title: 'Согласие на обработку данных - MESHWORK' };

/** Текст согласия (R-C-14) — ссылка из шага согласия онбординга. */
export default function ConsentPage() {
  const { version, paragraphs } = CONSENT_TEXTS.pd_processing;
  return (
    <main id="main">
      <Container size="text" className={styles.page}>
      <LegalLinksNav />
      <h1>Согласие на обработку персональных данных</h1>
      {CONSENT_IS_DRAFT && <p className={styles.note}>Черновик, не юридический текст. Версия {version}.</p>}
      {paragraphs.map((p) => (
        <p key={p}>{p}</p>
      ))}
      <p className={styles.note}>
        Реквизиты ФСП: <a href="https://fsp-russia.ru/upload/iblock/2ca/8zl0rvumvllbcmt2gd4udlmt1hfjfwks.pdf" target="_blank" rel="noopener noreferrer">официальное положение об обработке персональных данных</a>.
      </p>
      </Container>
    </main>
  );
}
