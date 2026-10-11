// Тексты согласий переехали в server/consent/texts.ts (ADR 0005) – здесь реэкспорт старых имён
// для существующих импортов (галка регистрации, онбординг, созвон, страница /consent).
export {
  CALL_RECORDING_CONSENT_PARAGRAPHS,
  CALL_RECORDING_CONSENT_VERSION,
  CONSENT_IS_DRAFT,
  CONSENT_PARAGRAPHS,
  CONSENT_VERSION,
} from '@/server/consent/texts';
