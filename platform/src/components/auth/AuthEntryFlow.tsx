'use client';

import { useState } from 'react';
import { Button, Notice } from '@/components/ui';
import { PersonaStepper, useDemoPersonas } from '@/components/demo/DemoPersonas';
import { safeNext } from '@/server/auth/redirect';
import { ConsentCheck } from './ConsentCheck';
import { EmailAuth } from './EmailAuth';
import { YandexSignIn } from './YandexSignIn';
import styles from './AuthEntry.module.css';

const assign = (path: string) => window.location.assign(path);

export function AuthEntryFlow({ yandexEnabled, fspHint = null, demoEnabled, next, onClose, navigate = assign, error: initialError = null }: {
  /** Чем войти в симулятор ФСП ID (env FSP_OIDC_DEMO_HINT); null - встроенный мок или подсказка не задана. */
  yandexEnabled: boolean; fspHint?: string | null; demoEnabled: boolean; next: string | null; error?: string | null; onClose: () => void; navigate?: (path: string) => void;
}) {
  const [error] = useState<string | null>(initialError ? initialError === 'consent_required'
    ? 'Чтобы войти, отметь согласие на обработку персональных данных.'
    : initialError === 'state' ? 'Сеанс входа устарел. Попробуй ещё раз.'
    : initialError === 'fsp_denied' ? 'Вход через ФСП ID отменён.'
    : initialError === 'fsp_unavailable' ? 'ФСП ID сейчас не отвечает. Войди по почте или попробуй позже.'
    : initialError.startsWith('fsp_') ? 'ФСП ID не подтвердил вход. Попробуй ещё раз.'
    : 'Не удалось завершить вход. Попробуй ещё раз.' : null);
  const [agreed, setAgreed] = useState(false);
  const [emailOpen, setEmailOpen] = useState(initialError !== null);
  const destination = safeNext(next);
  const personas = useDemoPersonas({ next: destination, agreed, navigate, enabled: demoEnabled });
  // Куда вернуть после входа: ссылку кабинета работодателя - только работодателю, остальное - только кандидату (в useDemoPersonas).

  // Роль при входе не спрашиваем (владелец 11.10: «зачем для входа выбирать роль? роль это при регистрации ведь только»):
  // почта и Яндекс узнают аккаунт, а новому аккаунту роль задаёт первый вопрос знакомства в чате («Ты здесь как кто?»).
  return <div>
    <div className={styles.body}>
      <header className={styles.header}>
        <div className={styles.headText}>
          <h2 id="auth-entry-title" className={styles.title}>Вход</h2>
          <p className={styles.lead}>Новый аккаунт? Кто ты - специалист или компания - спросит ИИ-помощник первым вопросом.</p>
        </div>
        <Button className={styles.close} aria-label="Закрыть окно входа" onClick={onClose}>×</Button>
      </header>
      {error && <Notice tone="error">{error}</Notice>}
      {/* Одно согласие над всеми способами входа: почта свёрнута в аккордеон, а ФСП ID, Яндекс и демо без галки не работают. */}
      <ConsentCheck checked={agreed} onChange={setAgreed} />
      <div className={styles.methods}>
        <section className={styles.method} aria-label="Вход на платформу">
          <h3>Войти на платформу</h3>
          <div className={styles.sso}>
            <YandexSignIn enabled={yandexEnabled} next={destination} fsp agreed={agreed} hideWhenOff />
          </div>
          {/* Чем войти в симулятор — под рядом кнопок: внутри ряда подсказка сжимает кнопку ФСП ID до полоски. */}
          {fspHint && <p className={styles.hint}>Вход в симулятор ФСП ID: {fspHint}</p>}
          <p className={styles.hint} title="ФСП ID - вход спортсмена ФСП: аккаунт специалиста. Реестр ФСП на стенде - симулятор с синтетическими участниками. Пароль Яндекса платформе не передаётся.">ФСП ID - достижения сразу в профиле</p>
          <p className={styles.or}>или</p>
          <button type="button" className={styles.accordion} aria-expanded={emailOpen} aria-controls="auth-email" onClick={() => setEmailOpen(!emailOpen)}>
            Войти по почте <span aria-hidden="true" className={styles.chev}>⌄</span>
          </button>
          <div id="auth-email" hidden={!emailOpen}>
            <EmailAuth next={destination} navigate={navigate} agreed={agreed} />
          </div>
        </section>
        {demoEnabled && <section className={`${styles.method} ${styles.demo}`} aria-label="Демо-профиль">
          <h3>Демо-профиль</h3>
          <p className={styles.hint}>Вымышленные данные, вход без пароля. Этапы пути соискателя; компании - с вакансиями и приглашениями.</p>
          <PersonaStepper state={personas} agreed={agreed} />
        </section>}
      </div>
      {personas.pending && <p role="status" className={styles.hint}>Входим…</p>}
    </div>
  </div>;
}
