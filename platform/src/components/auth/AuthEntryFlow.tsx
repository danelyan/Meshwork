'use client';

import { useState } from 'react';
import { Button, Kicker, Notice } from '@/components/ui';
import { PersonaGroups, useDemoPersonas } from '@/components/demo/DemoPersonas';
import { safeNext } from '@/server/auth/redirect';
import { ConsentCheck } from './ConsentCheck';
import { EmailAuth } from './EmailAuth';
import { YandexSignIn } from './YandexSignIn';
import styles from './AuthEntry.module.css';

const assign = (path: string) => window.location.assign(path);

export function AuthEntryFlow({ yandexEnabled, demoEnabled, next, onClose, navigate = assign, error: initialError = null }: {
  yandexEnabled: boolean; demoEnabled: boolean; next: string | null; error?: string | null; onClose: () => void; navigate?: (path: string) => void;
}) {
  const [error, setError] = useState<string | null>(initialError ? initialError === 'consent_required'
    ? 'Чтобы войти, отметь согласие на обработку персональных данных.'
    : initialError === 'state' ? 'Сеанс входа устарел. Попробуй ещё раз.'
    : initialError === 'fsp_denied' ? 'Вход через ФСП ID отменён.'
    : initialError === 'fsp_unavailable' ? 'ФСП ID сейчас не отвечает. Войди по почте или попробуй позже.'
    : initialError.startsWith('fsp_') ? 'ФСП ID не подтвердил вход. Попробуй ещё раз.'
    : 'Не удалось завершить вход. Попробуй ещё раз.' : null);
  const [agreed, setAgreed] = useState(false);
  const destination = safeNext(next);
  const personas = useDemoPersonas({ next: destination, agreed, navigate, enabled: demoEnabled });
  // Куда вернуть после входа: ссылку кабинета работодателя - только работодателю, остальное - только кандидату (в useDemoPersonas).

  // Роль при входе не спрашиваем (владелец 11.10: «зачем для входа выбирать роль? роль это при регистрации ведь только»):
  // почта и Яндекс узнают аккаунт, а новому аккаунту роль задаёт первый вопрос знакомства в чате («Ты здесь как кто?»).
  return <div>
    <header className={styles.header}>
      <Kicker>ФСП Карьера · вход</Kicker>
      <Button className={styles.close} aria-label="Закрыть окно входа" onClick={onClose}>×</Button>
    </header>
    <div className={styles.body}>
      <h2 id="auth-entry-title" className={styles.title}>Вход</h2>
      <p className={styles.lead}>Новый аккаунт? Кто ты - специалист или компания - спросит ИИ-помощник первым вопросом.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <ConsentCheck checked={agreed} onChange={setAgreed} />
      <div className={styles.methods}>
        <section className={styles.method} aria-label="Вход на платформу">
          <h3>Войти на платформу</h3>
          <EmailAuth next={destination} navigate={navigate} agreed={agreed} />
          <p className={styles.or}>или</p>
          <YandexSignIn enabled={yandexEnabled} next={destination} fsp agreed={agreed} />
          {!yandexEnabled && <p id="yandex-off" className={styles.hint}>Вход через Яндекс не настроен на этом стенде.</p>}
          <p className={styles.hint}>ФСП ID - вход спортсмена ФСП: аккаунт специалиста, достижения сразу попадут в профиль. Реестр ФСП на стенде - симулятор с синтетическими участниками.</p>
        </section>
        {demoEnabled && <section className={`${styles.method} ${styles.demo}`} aria-label="Демо-профиль">
          <h3>Демо-профиль</h3>
          <p className={styles.hint}>Вымышленные данные, вход без пароля. Профили идут по этапам пути соискателя; для компании - с вакансиями и с приглашениями.</p>
          <PersonaGroups state={personas} agreed={agreed} columns />
        </section>}
      </div>
      {personas.pending && <p role="status" className={styles.hint}>Входим…</p>}
    </div>
  </div>;
}
