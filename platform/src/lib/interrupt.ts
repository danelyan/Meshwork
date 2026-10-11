import { isBackchannel, isHardInterrupt } from './sentences';

/** Что делает Кира в момент фразы кандидата: молчит, думает (ход отправлен), грузит озвучку, звучит. */
export type AiStatus = 'idle' | 'thinking' | 'loading' | 'speaking';

/**
 * Решение по распознанной фразе кандидата в свободном разговоре (семантический фильтр перебивания):
 * - ignore — шум или поддакивание поверх Киры: не перебивать, не отправлять, вернуть громкость;
 * - hard — команда «стоп/подождите…»: замолчать всегда (даже пока думает/грузит), ходом не отправлять;
 * - interrupt — осмысленная речь поверх звучащей Киры: замолчать и отправить ходом;
 * - queue — осмысленная речь, пока Кира думает/грузит озвучку: не рвать, фраза уходит следующим ходом;
 * - turn — Кира молчит: обычный ход (поддакивание тоже — это ответ).
 */
export type InterruptDecision = 'ignore' | 'hard' | 'interrupt' | 'queue' | 'turn';

export function decideInterrupt({ text, aiStatus }: { text: string; aiStatus: AiStatus }): InterruptDecision {
  if (!text.trim()) return 'ignore';
  if (aiStatus === 'idle') return 'turn';
  if (isHardInterrupt(text)) return 'hard';
  if (isBackchannel(text)) return 'ignore';
  return aiStatus === 'speaking' ? 'interrupt' : 'queue';
}
