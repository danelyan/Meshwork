import type { Metadata } from 'next';
import { Oswald, PT_Serif, Playfair_Display } from 'next/font/google';

import styles from './fonts.module.css';

// Dev-страница выбора заголовочного шрифта (не в навигации). Три варианта на одном hero-блоке.
const playfair = Playfair_Display({ subsets: ['latin', 'cyrillic'], weight: ['700', '800'], display: 'swap' });
const oswald = Oswald({ subsets: ['latin', 'cyrillic'], weight: ['500', '600', '700'], display: 'swap' });
const ptserif = PT_Serif({ subsets: ['latin', 'cyrillic'], weight: ['400', '700'], display: 'swap' });

export const metadata: Metadata = { title: 'Шрифты заголовков - превью', robots: { index: false } };

const VARIANTS = {
  mono: { label: 'JetBrains Mono', note: 'текущий выбор', font: null, weight: 700, tracking: '-0.045em' },
  playfair: { label: 'Playfair Display', note: 'газетная антиква, контрастная', font: playfair, weight: 800, tracking: '-0.01em' },
  oswald: { label: 'Oswald', note: 'узкая гротескная, плакатная', font: oswald, weight: 600, tracking: '0.005em' },
  ptserif: { label: 'PT Serif', note: 'спокойная книжная антиква', font: ptserif, weight: 700, tracking: '-0.005em' },
} as const;
type Key = keyof typeof VARIANTS;

export default async function FontsPreview({ searchParams }: { searchParams: Promise<{ display?: string }> }) {
  const { display } = await searchParams;
  const active: Key | null = display && display in VARIANTS ? (display as Key) : null;
  const keys = (Object.keys(VARIANTS) as Key[]).filter((k) => !active || k === active);
  return (
    <main className={styles.page}>
      <p className={styles.kicker}>Превью · шрифт заголовков</p>
      <nav className={styles.nav} aria-label="Вариант шрифта">
        <a href="/design/fonts" aria-current={active ? undefined : 'page'}>Все три</a>
        {(Object.keys(VARIANTS) as Key[]).map((k) => (
          <a key={k} href={`/design/fonts?display=${k}`} aria-current={active === k ? 'page' : undefined}>
            {VARIANTS[k].label}
          </a>
        ))}
      </nav>
      <div className={styles.grid}>
        {keys.map((k) => {
          const v = VARIANTS[k];
          return (
            <section key={k} className={styles.card} aria-label={v.label}>
              <p className={styles.caption}>
                <b>{v.label}</b> · {v.note}
              </p>
              <p className={styles.eyebrow}>ИТ-подбор с обратной механикой</p>
              <h1 className={v.font ? v.font.className : styles.monoHead} style={{ fontWeight: v.weight, letterSpacing: v.tracking }}>
                Твой код.
                <br />
                Твоя карьера.
              </h1>
              <h2 className={v.font ? v.font.className : styles.monoHead} style={{ fontWeight: v.weight }}>
                Сейчас нанимают
              </h2>
              <p className={styles.slogan}>Покажи навыки и достижения - получай предложения от ИТ-компаний с открытой зарплатной вилкой.</p>
            </section>
          );
        })}
      </div>
    </main>
  );
}
