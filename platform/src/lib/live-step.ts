// Шаг «Живая защита» в правой колонке консультанта: текст карточки, нота в пути и кнопка по подстатусу
// (live-defense/rules.ts: slots_proposed | scheduled | done | cancelled | no_show; нет предложения – 'none').
// Модуль без серверных импортов: его читает и колонка (клиент), и сервер (нота шага в пути). Время – МСК.
import { formatMsk } from './msk';

export type LiveStepStatus = 'none' | 'slots_proposed' | 'scheduled' | 'done' | 'cancelled' | 'no_show';

export interface LiveStepInfo {
  status: LiveStepStatus;
  /** scheduled: начало защиты (ISO, UTC). */
  scheduledAt?: string;
  company?: string;
  /** scheduled: ссылка на комнату, когда она открыта. */
  roomHref?: string;
}

export interface LiveStepCopy {
  text: string;
  note: string;
  cta?: { href: string; label: string };
}

const INVITES = '/invitations';

export function liveStepCopy(live: LiveStepInfo | undefined): LiveStepCopy {
  switch (live?.status ?? 'none') {
    case 'slots_proposed':
      return { text: 'Компания предложила слоты – выбери время.', note: 'выбери слот', cta: { href: INVITES, label: 'Выбрать слот' } };
    case 'scheduled': {
      const at = formatMsk(live?.scheduledAt);
      return {
        text: `Защита назначена на ${at}.`,
        note: `назначена: ${at}`,
        cta: live?.roomHref ? { href: live.roomHref, label: 'Открыть комнату' } : { href: INVITES, label: 'Открыть приглашения' },
      };
    }
    case 'done':
      return { text: 'Защита прошла – ждём решение компании.', note: 'прошла, ждём решение компании' };
    case 'no_show':
      return { text: 'Защита не состоялась – компания может назначить новую.', note: 'не состоялась', cta: { href: INVITES, label: 'Открыть приглашения' } };
    case 'cancelled':
      return { text: 'Защита отменена – компания может предложить новое время.', note: 'отменена', cta: { href: INVITES, label: 'Открыть приглашения' } };
    default:
      return { text: 'Компания предложит время; ты выберешь слот. Защита идёт с записью.', note: 'компания предложит время', cta: { href: INVITES, label: 'Открыть приглашения' } };
  }
}

/** Из нескольких принятых приглашений – самое «живое»: назначенная, затем выбор слота, затем ожидание предложения. */
const PRIORITY: LiveStepStatus[] = ['scheduled', 'slots_proposed', 'none', 'no_show', 'cancelled', 'done'];
export function pickLive(items: readonly LiveStepInfo[]): LiveStepInfo | undefined {
  return [...items].sort((a, b) => PRIORITY.indexOf(a.status) - PRIORITY.indexOf(b.status))[0];
}
