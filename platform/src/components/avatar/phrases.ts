import { speechText } from '@/lib/speech-text';

/**
 * Фразы звучащей реплики для субтитров. Текст берём тот же, что уходит в синтез (`speechText`), и
 * режем по концу предложения. SpeechKit не отдаёт тайминги слов, поэтому активную фразу оцениваем по
 * доле символов: прогресс воспроизведения 0…1 → фраза, на которую он попадает.
 */
export function splitPhrases(raw: string): string[] {
  const text = speechText(raw);
  if (!text) return [];
  const parts = text.match(/[^.!?…]+(?:[.!?…]+|$)/g) ?? [text];
  const out: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    // Обрывок без букв («1.», «?») приклеиваем к предыдущей фразе.
    if (out.length && !/[\p{L}\p{N}]/u.test(t)) out[out.length - 1] += ` ${t}`;
    else out.push(t);
  }
  return out;
}

/** Индекс фразы по прогрессу воспроизведения; пауза между фразами не учитывается (оценка). */
export function phraseAt(phrases: readonly string[], progress: number): number {
  if (phrases.length === 0) return -1;
  const total = phrases.reduce((n, p) => n + p.length, 0);
  const at = Math.min(Math.max(progress, 0), 0.9999) * total;
  let acc = 0;
  for (let i = 0; i < phrases.length; i++) {
    acc += phrases[i]!.length;
    if (at < acc) return i;
  }
  return phrases.length - 1;
}
