/** Тексты «мгновенной реакции» Киры (ack): единый источник для генератора банка (scripts/gen-ack.mts) и отладки. Гендерно-нейтральные. */
export type AckKind = 'think' | 'listen' | 'soft';

export const ACK_TEXTS: Record<AckKind, string[]> = {
  think: ['Та-ак…', 'Так, сейчас…', 'Хм-м… сейчас…', 'Так, секундочку…'],
  listen: ['Угу…', 'Ага…', 'Так…', 'Угу, хорошо…', 'Ага, сейчас…'],
  soft: ['Секундочку…', 'М-м…', 'Ещё секундочку…', 'Одну секунду…'],
};

export type AckManifest = Record<AckKind, string[]>;
