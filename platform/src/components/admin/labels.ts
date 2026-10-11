/** Подписи значений для обзорных страниц админки (E-08, фаза 1). */

export const SPEC_LABEL: Record<string, string> = { backend: 'Backend', frontend: 'Frontend', ai: 'AI', engineering: 'Инженерия' };
export const GRADE_LABEL: Record<string, string> = { junior: 'Junior', middle: 'Middle', senior: 'Senior' };
export const FSP_LABEL: Record<string, string> = { not_linked: 'не привязан', no_achievements: 'без достижений', unavailable: 'недоступен', linked: 'привязан' };
export const USER_ROLE_LABEL: Record<string, string> = { pending: 'без роли', candidate: 'кандидат', employer: 'работодатель' };
export const INVITATION_STATUS_LABEL: Record<string, string> = {
  sent: 'отправлено',
  viewed: 'просмотрено',
  accepted: 'принято',
  declined: 'отклонено',
  hired: 'нанят',
  withdrawn: 'отозвано',
  closed_hired: 'закрыто наймом',
};
export const APPLICATION_STATUS_LABEL: Record<string, string> = { sent: 'отправлен', viewed: 'просмотрен', accepted: 'принят', declined: 'отклонён', closed: 'закрыт' };
export const COMPLAINT_STATUS_LABEL: Record<string, string> = { open: 'открыта', upheld: 'подтверждена', dismissed: 'отклонена' };
export const COMPLAINT_REASON_LABEL: Record<string, string> = { spam: 'спам', salary_mismatch: 'вилка не совпала', offensive: 'оскорбления', fake_company: 'ненастоящая компания', other: 'другое' };
export const ATTEMPT_STATUS_LABEL: Record<string, string> = {
  active: 'идёт',
  passed: 'пройден',
  not_confirmed: 'не подтверждён',
  abandoned: 'брошен',
  needs_confirmation: 'нужен подтверждающий',
};
export const CLAIM_STATUS_LABEL: Record<string, string> = { proposed: 'предложено', confirmed: 'подтверждено', edited: 'правлено', rejected: 'отклонено' };
export const EVIDENCE_LABEL: Record<string, string> = { self_reported: 'со слов', artifact: 'артефакт', platform: 'платформа', third_party: 'третья сторона' };
export const CONSENT_LABEL: Record<string, string> = {
  pd_processing: 'Обработка ПДн',
  call_recording: 'Запись созвона',
  ai_assessment: 'Оценка ИИ',
  employer_visibility: 'Показ работодателям',
  research: 'Исследования',
  marketing: 'Рассылки',
  identity_disclosure: 'Раскрытие имени',
  employer_offer: 'Оферта работодателя',
  employer_data_obligation: 'Обязательство по данным',
};
export const OBJECTION_SUBJECT_LABEL: Record<string, string> = { grade_test: 'тест на грейд', call: 'созвон', defense: 'защита' };
export const CALL_KIND_LABEL: Record<string, string> = { qualifying: 'квалифицирующий', defense: 'защита проекта', interview: 'ИИнтервью' };

const dt = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' });
const d = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeZone: 'Europe/Moscow' });

export function fmtDateTime(v: Date | string | null | undefined): string {
  return v ? dt.format(new Date(v)) : '–';
}
export function fmtDate(v: Date | string | null | undefined): string {
  return v ? d.format(new Date(v)) : '–';
}
export function fmtMoney(from: number, to: number): string {
  return `${from.toLocaleString('ru-RU')}–${to.toLocaleString('ru-RU')} ₽`;
}
export function pct(share: number | null | undefined): string {
  return share === null || share === undefined ? '–' : `${Math.round(share * 100)}%`;
}
