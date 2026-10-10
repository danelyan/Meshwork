import Link from 'next/link';

import { Container } from '@/components/shell/Container';
import { DRAFT_NOTICE, LEGAL_LINKS, type LegalDoc } from '@/lib/legal/types';

import styles from './legal.module.css';

/** Правовой документ: плашка черновика, оглавление, якоря, дата и версия. Серверный компонент. */
export function LegalDocument({ doc }: { doc: LegalDoc }) {
  const date = new Date(doc.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <main id="main">
      <Container size="text" className={styles.page}>
        <p className={styles.draft} role="note">
          {DRAFT_NOTICE}
        </p>
        <h1>{doc.title}</h1>
        <p className={styles.meta}>
          Редакция от {date} · версия {doc.version}
        </p>
        <p className={styles.lead}>{doc.lead}</p>
        <nav aria-label="Оглавление" className={styles.toc}>
          <ol>
            {doc.sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ol>
        </nav>
        {doc.sections.map((s) => (
          <section key={s.id} id={s.id} className={styles.section}>
            <h2>{s.title}</h2>
            {s.paragraphs?.map((p) => (
              <p key={p}>{p}</p>
            ))}
            {s.items && (
              <ul>
                {s.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
        <LegalLinksNav />
      </Container>
    </main>
  );
}

/** Ссылки на остальные документы. */
export function LegalLinksNav({ className }: { className?: string }) {
  return (
    <nav aria-label="Правовые документы" className={className ?? styles.links}>
      {LEGAL_LINKS.map((l) => (
        <Link key={l.href} href={l.href}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
