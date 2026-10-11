'use client';

// lane live-slots (ADR 0008, «Назначение живой защиты: слоты»): блок живой защиты в карточке приглашения.
// Работодатель предлагает 2–5 слотов по МСК, кандидат выбирает один (с согласием на запись) или пишет «ни один не подходит».
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { cancelLiveDefenseCandidateApi, cancelLiveDefenseEmployerApi, chooseLiveSlotApi, noneFitLiveSlotsApi, proposeLiveSlotsApi } from '@/lib/employer-api';
import { formatMsk, isoToMskLocal, mskLocalToIso } from '@/lib/msk';
import { CONSENT_TEXTS } from '@/server/consent/texts';
import type { LiveDefenseView } from '@/server/live-defense/service';

import { Button } from '../ui';
import styles from './LiveDefense.module.css';

export const LIVE_SUB_STATUS_LABEL: Record<LiveDefenseView['status'], string> = {
  slots_proposed: 'Слоты предложены',
  scheduled: 'Защита назначена',
  done: 'Защита прошла',
  cancelled: 'Защита отменена',
  no_show: 'Неявка',
};

const WHO = { candidate: 'кандидат', employer: 'компания' } as const;

export function LiveSubStatus({ live }: { live: LiveDefenseView | null | undefined }) {
  if (!live) return null;
  return <span className={styles.sub} data-status={live.status} data-testid="live-substatus">{LIVE_SUB_STATUS_LABEL[live.status]}</span>;
}

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

function Summary({ live, role }: { live: LiveDefenseView; role: 'candidate' | 'employer' }) {
  return <>
    {live.scheduled && <p className={styles.meta}>
      {formatMsk(live.scheduled.startsAt)}, {live.durationMin} мин.{' '}
      {live.scheduled.roomOpen ? 'Комната открыта.' : `Комната откроется ${formatMsk(live.scheduled.roomOpensAt)}.`}
    </p>}
    {live.scheduled && (live.scheduled.roomHref
      ? <div className={styles.row}>{live.scheduled.roomOpen ? <Button size="sm" variant="primary" href={live.scheduled.roomHref}>{role === 'employer' ? 'Войти в комнату' : 'Перейти к защите'}</Button> : <Button size="sm" disabled>Комната ещё закрыта</Button>}</div>
      : <p className={styles.fine}>{role === 'employer'
        ? 'У кандидата нет сданного проекта: вопросы по коду не подготовлены, комната появится после сдачи.'
        : 'Проект ещё не сдан: сдайте его в разделе «Проекты», тогда к защите подготовятся вопросы по коду и появится комната.'}</p>)}
    {live.noShow.length > 0 && <p className={styles.error}>Неявка: {live.noShow.map((a) => WHO[a]).join(' и ')} (опоздание больше 15 минут).</p>}
    {live.cancelled && <p className={styles.meta}>Отменил{live.cancelled.by === 'employer' ? 'а компания' : ' кандидат'}: {live.cancelled.reason}</p>}
    {live.noneFit && live.status === 'slots_proposed' && <p className={styles.meta}>Кандидату не подошли слоты: «{live.noneFit.comment}»</p>}
  </>;
}

function CancelForm({ onCancel, busy }: { onCancel: (reason: string) => Promise<void>; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) return <Button size="sm" onClick={() => setOpen(true)}>Отменить защиту</Button>;
  return <div className={styles.row}>
    <input className={styles.input} aria-label="Причина отмены" placeholder="Причина отмены" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
    <Button size="sm" loading={busy} disabled={reason.trim().length < 3} onClick={() => void onCancel(reason)}>Отменить</Button>
    <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Не отменять</Button>
  </div>;
}

// ---------------------------------------------------------------------------
// Работодатель
// ---------------------------------------------------------------------------

function defaultSlots(): string[] {
  // Завтра 11:00 и 15:00 по МСК — удобная заготовка, всегда позже чем через 2 часа.
  const tomorrow = isoToMskLocal(new Date(Date.now() + 24 * 60 * 60 * 1000)).slice(0, 10);
  return [`${tomorrow}T11:00`, `${tomorrow}T15:00`];
}

export function EmployerLiveDefense({ invitationId, live: initial, projectReady = true }: { invitationId: string; live: LiveDefenseView | null | undefined; projectReady?: boolean }) {
  const router = useRouter();
  const [live, setLive] = useState(initial ?? null);
  const [formOpen, setFormOpen] = useState(false);
  const [slots, setSlots] = useState<string[]>(defaultSlots);
  const [duration, setDuration] = useState<30 | 45>(45);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const iso = slots.map(mskLocalToIso);
    if (iso.some((s) => !s)) return setError('Заполните дату и время каждого слота');
    setBusy(true);
    setError(null);
    try {
      setLive(await proposeLiveSlotsApi(invitationId, { slots: iso as string[], durationMin: duration, ...(comment.trim() ? { comment: comment.trim() } : {}) }));
      setFormOpen(false);
      router.refresh();
    } catch (e) { setError(errText(e, 'Не удалось предложить слоты')); }
    finally { setBusy(false); }
  }

  async function cancel(reason: string) {
    setBusy(true);
    setError(null);
    try { setLive(await cancelLiveDefenseEmployerApi(invitationId, reason)); router.refresh(); }
    catch (e) { setError(errText(e, 'Не удалось отменить')); }
    finally { setBusy(false); }
  }

  const canPropose = (!live || live.status !== 'scheduled') && projectReady;
  const waitingProject = !projectReady && (!live || live.status !== 'scheduled');
  return <div className={styles.box} data-testid="live-defense-employer">
    <div className={styles.head}><h3>Живая защита с компанией</h3><LiveSubStatus live={live} /></div>
    {live && <Summary live={live} role="employer" />}
    {live?.status === 'slots_proposed' && <ul className={styles.slots}>{live.slots.map((s) => <li key={s.id} className={styles.slot} data-available={s.available}>{formatMsk(s.startsAt)}{!s.available && ' · занято'}</li>)}</ul>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {waitingProject && <p className={styles.fine} data-testid="live-project-missing">Кандидат ещё не сдал проект — назначить защиту можно после сдачи.</p>}
    {formOpen && projectReady ? <div className={styles.box}>
      <p className={styles.fine}>От 2 до 5 слотов по МСК, не раньше чем через 2 часа и не позже 14 дней. Одно активное предложение: новое заменит старое.</p>
      <ul className={styles.slots}>{slots.map((v, i) => <li key={i} className={styles.slot}>
        <input type="datetime-local" className={styles.input} aria-label={`Слот ${i + 1}, МСК`} value={v} onChange={(e) => setSlots((all) => all.map((x, j) => (j === i ? e.target.value : x)))} />
        <span className={styles.fine}>МСК</span>
        {slots.length > 2 && <Button size="sm" variant="ghost" onClick={() => setSlots((all) => all.filter((_, j) => j !== i))}>Убрать</Button>}
      </li>)}</ul>
      <div className={styles.row}>
        {slots.length < 5 && <Button size="sm" onClick={() => setSlots((all) => [...all, all[all.length - 1] ?? ''])}>+ слот</Button>}
        <label className={styles.fine}>Длительность{' '}
          <select className={styles.input} value={duration} onChange={(e) => setDuration(Number(e.target.value) === 30 ? 30 : 45)}><option value={30}>30 мин</option><option value={45}>45 мин</option></select>
        </label>
      </div>
      <textarea className={styles.textarea} aria-label="Комментарий кандидату" placeholder="Комментарий (необязательно, до 300 знаков)" maxLength={300} value={comment} onChange={(e) => setComment(e.target.value)} />
      <div className={styles.row}><Button size="sm" variant="primary" loading={busy} onClick={() => void submit()}>Предложить слоты</Button><Button size="sm" variant="ghost" onClick={() => setFormOpen(false)}>Закрыть</Button></div>
    </div> : <div className={styles.row}>
      {canPropose && <Button size="sm" variant={live ? undefined : 'primary'} onClick={() => setFormOpen(true)} data-testid="live-propose">{live ? 'Предложить другие слоты' : 'Назначить защиту'}</Button>}
      {live?.canCancel && <CancelForm onCancel={cancel} busy={busy} />}
    </div>}
    <p className={styles.fine}>Защита записывается: кандидат подтверждает согласие на запись при выборе времени.</p>
  </div>;
}

// ---------------------------------------------------------------------------
// Кандидат
// ---------------------------------------------------------------------------

export function CandidateLiveDefense({ invitationId, live: initial, hasRecordingConsent, accepted = false, projectReady = true }: { invitationId: string; live: LiveDefenseView | null | undefined; hasRecordingConsent: boolean; accepted?: boolean; projectReady?: boolean }) {
  const router = useRouter();
  const [live, setLive] = useState(initial ?? null);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [noneFit, setNoneFit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = CONSENT_TEXTS.call_recording;
  if (!live) {
    // Приглашение принято, проекта нет: компания не сможет назначить защиту, пока его не сдать.
    return accepted && !projectReady
      ? <p className={styles.fine} data-testid="live-project-hint">Чтобы компания смогла назначить живую защиту, сдайте проект в разделе <a href="/projects">«Проекты»</a>.</p>
      : null;
  }

  async function run(fn: () => Promise<LiveDefenseView>, fallback: string) {
    setBusy(true);
    setError(null);
    try { setLive(await fn()); router.refresh(); }
    catch (e) { setError(errText(e, fallback)); }
    finally { setBusy(false); }
  }

  const choosing = live.status === 'slots_proposed';
  return <div className={styles.box} data-testid="live-defense-candidate">
    <div className={styles.head}><h3>Живая защита с компанией</h3><LiveSubStatus live={live} /></div>
    <Summary live={live} role="candidate" />
    {choosing && <>
      {live.comment && <p className={styles.meta}>Комментарий компании: {live.comment}</p>}
      <p className={styles.fine}>Выберите удобное время ({live.durationMin} мин, время по МСК).</p>
      <ul className={styles.slots}>{live.slots.map((s) => <li key={s.id} className={styles.slot} data-available={s.available}>
        <label><input type="radio" name={`slot-${invitationId}`} disabled={!s.available} checked={slotId === s.id} onChange={() => setSlotId(s.id)} />{formatMsk(s.startsAt)}{!s.available && ' · занято'}</label>
      </li>)}</ul>
      {!hasRecordingConsent && <label className={styles.fine}><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> {text.label}. {text.paragraphs.join(' ')}</label>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.row}>
        <Button size="sm" variant="primary" loading={busy} disabled={!slotId || (!hasRecordingConsent && !consent)} onClick={() => void run(() => chooseLiveSlotApi(invitationId, slotId!, hasRecordingConsent ? undefined : text.version), 'Не удалось выбрать слот')} data-testid="live-choose">Выбрать время</Button>
        {noneFit === null && <Button size="sm" onClick={() => setNoneFit('')}>Ни один не подходит</Button>}
      </div>
      {noneFit !== null && <div className={styles.row}>
        <textarea className={styles.textarea} aria-label="Когда вам удобно" placeholder="Когда вам удобно? Компания предложит новые слоты" maxLength={300} value={noneFit} onChange={(e) => setNoneFit(e.target.value)} />
        <Button size="sm" loading={busy} disabled={noneFit.trim().length < 3} onClick={() => void run(() => noneFitLiveSlotsApi(invitationId, noneFit), 'Не удалось отправить')}>Отправить компании</Button>
      </div>}
      <p className={styles.fine}>Защита записывается (обе стороны). Без согласия на запись время не подтверждается.</p>
    </>}
    {!choosing && error && <p className={styles.error} role="alert">{error}</p>}
    {live.status === 'scheduled' && live.canCancel && <CancelForm busy={busy} onCancel={(reason) => run(() => cancelLiveDefenseCandidateApi(invitationId, reason), 'Не удалось отменить')} />}
    {live.status === 'scheduled' && <p className={styles.fine}>Отменить можно не позднее чем за 1 час до начала, с причиной.</p>}
  </div>;
}
